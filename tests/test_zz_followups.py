"""Follow graph (FR-3.1), guest follow block, inventory probe, tie_break repeats, /api/v1 rate limit.

Named test_zz_* so the rate-limit burst runs last and waits out its window before other suites run.
"""
import concurrent.futures as cf
import json
import time

import pytest
import requests

BASE = "http://localhost:8080"


def post(path, body=None, headers=None):
    return requests.post(BASE + path, json=body or {}, headers=headers or {}, timeout=10)


@pytest.fixture(autouse=True)
def reset():
    assert post("/audit/v1/reset").status_code == 200


def member(email="manager@nascon.test"):
    return {"Authorization": "Bearer " + post("/api/v1/auth/login", {"email": email, "password": "Nascon@26"}).json()["token"]}


def test_guest_cannot_follow():
    r = post("/api/v1/athletes/player-alpha-1/follow", headers={"Authorization": "Bearer guest_anon_tok_7721"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "GUEST_WRITE_FORBIDDEN"


def test_follow_idempotent_and_drift_free_under_concurrency():
    users = [member(e) for e in ["manager@nascon.test", "organizer@nascon.test", "viewer@nascon.test"]]
    with cf.ThreadPoolExecutor(12) as ex:
        list(ex.map(lambda i: post("/api/v1/athletes/player-alpha-1/follow", headers=users[i % 3]), range(12)))
    assert requests.get(BASE + "/api/v1/players/player-alpha-1", timeout=5).json()["follower_count"] == 3
    r = requests.delete(BASE + "/api/v1/athletes/player-alpha-1/follow", headers=users[0], timeout=5)
    assert r.json() == {"athlete_id": "player-alpha-1", "follower_id": "user-manager", "following": False, "follower_count": 2}
    assert requests.delete(BASE + "/api/v1/athletes/player-alpha-1/follow", headers=users[0], timeout=5).json()["follower_count"] == 2
    assert post("/api/v1/athletes/ghost/follow", headers=users[1]).status_code == 404


def test_athlete_profile_aggregates_event_logs():
    p = requests.get(BASE + "/api/v1/players/player-alpha-1", timeout=5).json()
    assert p["live_matches"][0]["match_id"] == "match-m1" and p["career"]["played"] == 0
    post("/audit/v1/events", {"event_id": "pf-1", "match_id": "match-m1", "type": "match_end", "payload": {}})
    p = requests.get(BASE + "/api/v1/players/player-alpha-1", timeout=5).json()
    assert p["career"] == {"played": 1, "won": 1, "drawn": 0, "lost": 0, "scored": 1, "conceded": 0}
    assert p["vod_archive"][0]["route"] == "/web/matches/match-m1/vod"
    q = requests.get(BASE + "/api/v1/players/player-alpha-2", timeout=5).json()
    assert q["career"]["lost"] == 1


def test_inventory_probe():
    r = requests.get(BASE + "/audit/v1/inventory/var-jersey-001-M", timeout=5)
    assert r.status_code == 200 and r.json() == {"variant_id": "var-jersey-001-M", "stock": 1, "reserved": 0}
    r = requests.get(BASE + "/audit/v1/inventory/var-nope", timeout=5)
    assert r.status_code == 404 and r.json()["error"]["code"] == "VARIANT_NOT_FOUND"


def test_tie_break_order_repeats_rejected():
    body = {"sport_id": "kabaddi", "name": "Kabaddi", "scoring_model": "event", "periods": {"count": 2, "duration_minutes": 20},
            "scoring_events": {"raid_point": {"points": 1}}, "draw_allowed": False, "overtime": {"policy": "none"},
            "roster": {"min_squad_size": 7, "max_squad_size": 12}, "tie_break_order": ["h2h_points", "h2h_points"]}
    r = post("/audit/v1/sports", body)
    assert r.status_code == 400 and "tie_break_order" in r.json()["error"]["details"]["fields"]


def test_costream_invite_push_and_dlq():
    websocket = pytest.importorskip("websocket")
    post("/audit/v1/costream/session", {"session_id": "cs-session-101", "host_player_id": "player-alpha-1",
                                        "participants": ["player-alpha-1", "player-alpha-2"], "layout": "grid_2"})
    host = member("player@nascon.test")
    # Offline invitee: 3 delivery attempts, then dead-lettered.
    r = post("/api/v1/costream/cs-session-101/invite", {"player_id": "player-beta-2"}, host)
    assert r.status_code == 201, r.text
    b = r.json()
    assert (b["delivered"], b["attempts"], b["dlq_depth"]) == (False, 3, 1)
    # Online invitee receives the signed invite on its notify channel.
    ws = websocket.create_connection("ws://localhost:8080/ws/notify/player-beta-1", timeout=5)
    r = post("/api/v1/costream/cs-session-101/invite", {"player_id": "player-beta-1"}, host).json()
    msg = json.loads(ws.recv())
    ws.close()
    assert r["delivered"] is True and msg["type"] == "costream.invite" and msg["invite_token"] == r["invite_token"]
    # Boundaries: guest 403 guest-block, non-host 403 FORBIDDEN, unknown session 404.
    g = post("/api/v1/costream/cs-session-101/invite", {"player_id": "player-beta-1"}, {"Authorization": "Bearer guest_anon_tok_7721"})
    assert g.json()["error"]["code"] == "GUEST_WRITE_FORBIDDEN"
    assert post("/api/v1/costream/cs-session-101/invite", {"player_id": "player-beta-1"}, member()).json()["error"]["code"] == "FORBIDDEN"
    assert post("/api/v1/costream/nope/invite", {"player_id": "player-beta-1"}, host).json()["error"]["code"] == "STREAM_NOT_FOUND"


def test_zz_api_rate_limit_then_recovers():
    first = requests.get(BASE + "/api/v1/ping", timeout=5)
    assert first.status_code == 200 and first.json() == {"pong": True}
    with cf.ThreadPoolExecutor(20) as ex:
        results = list(ex.map(lambda _: requests.get(BASE + "/api/v1/ping", timeout=5), range(150)))
    limited = [r for r in results if r.status_code == 429]
    assert len(limited) >= 40
    assert limited[0].json()["error"]["code"] == "RATE_LIMITED" and int(limited[0].headers["Retry-After"]) >= 1
    assert requests.get(BASE + "/health", timeout=5).status_code == 200  # never limited
    assert post("/audit/v1/reset").status_code == 200                   # /audit exempt
    time.sleep(11)
    assert requests.get(BASE + "/api/v1/ping", timeout=5).status_code == 200
