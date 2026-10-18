"""Day 2 Tier 1 contract tests (D2 5.4-5.9 + edge cases 1-4). Signatures are recomputed with the spec's
Python reference when DAY2_SALT is exported in the test environment."""
import concurrent.futures as cf
import hashlib
import hmac
import json
import os
import threading
import time

import pytest
import requests

BASE = "http://localhost:8080"
GUEST = "guest_anon_tok_7721"


def canonical(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def check_sig(entity_id, payload, sig):
    assert isinstance(sig, str) and len(sig) == 64 and sig == sig.lower()
    salt = os.environ.get("DAY2_SALT")
    if salt:
        assert sig == hmac.new(salt.encode(), (entity_id + "|" + canonical(payload)).encode(), hashlib.sha256).hexdigest()


def post(path, body, headers=None):
    return requests.post(BASE + path, json=body, headers=headers or {}, timeout=10)


def err(r, status, code):
    assert r.status_code == status, r.text
    assert r.json()["error"]["code"] == code
    assert isinstance(r.json()["error"]["details"], dict)


@pytest.fixture(autouse=True)
def reset():
    assert post("/audit/v1/reset", {}).status_code == 200


# ---------------- 5.4 stream keys ----------------

def test_stream_key_rotate_spec_example():
    r = post("/audit/v1/stream/key", {"action": "rotate", "player_id": "player-alpha-1", "label": "OBS-Main-Desk",
                                      "stream_key_override": "sk_live_9f83a1b2c3d4e5f6"})
    assert r.status_code == 200
    b = r.json()
    k = "sk_live_9f83a1b2c3d4e5f6"
    assert b == {**b, "player_id": "player-alpha-1", "label": "OBS-Main-Desk", "stream_key": k, "status": "active",
                 "ingest_endpoints": {"rtmp": f"rtmp://localhost:1935/live/{k}", "webrtc": f"http://localhost:8889/live/{k}/whip"},
                 "playback_url": f"http://localhost:8888/live/{k}/index.m3u8"}
    check_sig(k, {"action": "rotate", "player_id": "player-alpha-1", "status": "active", "stream_key": k}, b["signature"])


def test_stream_key_generate_then_revoke():
    g = post("/audit/v1/stream/key", {"action": "generate", "player_id": "player-beta-2"})
    assert g.status_code == 201
    k = g.json()["stream_key"]
    assert __import__("re").fullmatch(r"sk_live_[a-f0-9]{16}", k) and g.json()["label"] == "default"
    r = post("/audit/v1/stream/key", {"action": "revoke", "player_id": "player-beta-2"})
    assert r.status_code == 200
    b = r.json()
    assert (b["stream_key"], b["status"], b["ingest_endpoints"], b["playback_url"]) == (k, "revoked", None, None)
    check_sig(k, {"action": "revoke", "player_id": "player-beta-2", "status": "revoked", "stream_key": k}, b["signature"])


def test_revoked_key_is_refused_by_media_auth_hook():
    k = post("/audit/v1/stream/key", {"action": "generate", "player_id": "player-alpha-2"}).json()["stream_key"]
    assert post("/internal/media/auth", {"action": "publish", "path": f"live/{k}"}).status_code == 200
    post("/audit/v1/stream/key", {"action": "rotate", "player_id": "player-alpha-2"})
    err(post("/internal/media/auth", {"action": "publish", "path": f"live/{k}"}), 409, "KEY_REVOKED")


def test_stream_key_errors():
    err(post("/audit/v1/stream/key", {"action": "explode", "player_id": "player-alpha-1"}), 400, "VALIDATION_ERROR")
    err(post("/audit/v1/stream/key", {"action": "generate"}), 400, "VALIDATION_ERROR")
    err(post("/audit/v1/stream/key", {"action": "generate", "player_id": "ghost"}), 404, "PLAYER_NOT_FOUND")
    err(post("/audit/v1/stream/key", {"action": "revoke", "player_id": "player-beta-1"}), 404, "STREAM_NOT_FOUND")


# ---------------- 5.5 co-stream ----------------

FOUR = ["player-alpha-1", "player-alpha-2", "player-beta-1", "player-beta-2"]


def costream(**kw):
    body = {"session_id": "cs-session-101", "host_player_id": "player-alpha-1", "participants": FOUR, "layout": "grid_4"}
    body.update(kw)
    return post("/audit/v1/costream/session", body)


def test_costream_host_drop_spec_example_and_replay():
    r = costream(simulate_host_drop=True)
    assert r.status_code == 201
    b = r.json()
    assert {k: b[k] for k in ["session_id", "status", "active_host", "handoff_occurred", "participant_count", "active_participants",
                              "layout", "composite_playback_url", "chat_room_id"]} == {
        "session_id": "cs-session-101", "status": "active", "active_host": "player-alpha-2", "handoff_occurred": True,
        "participant_count": 3, "active_participants": FOUR[1:], "layout": "grid_4",
        "composite_playback_url": "http://localhost:8888/costream/cs-session-101/index.m3u8", "chat_room_id": "chat-cs-session-101"}
    check_sig("cs-session-101", {"active_host": "player-alpha-2", "handoff_occurred": True, "layout": "grid_4",
                                 "participant_count": 3, "session_id": "cs-session-101", "status": "active"}, b["signature"])
    again = costream(simulate_host_drop=True)
    assert again.status_code == 200 and again.json() == b


def test_costream_no_drop_and_sole_host_terminates():
    b = costream().json()
    assert (b["active_host"], b["handoff_occurred"], b["participant_count"], b["status"]) == ("player-alpha-1", False, 4, "active")
    t = costream(session_id="cs-session-solo", participants=["player-alpha-1"], layout="solo", simulate_host_drop=True).json()
    assert (t["active_host"], t["handoff_occurred"], t["participant_count"], t["status"], t["active_participants"]) == (None, False, 0, "terminated", [])


def test_costream_errors_in_order():
    err(costream(participants=[]), 400, "VALIDATION_ERROR")
    err(costream(layout="mosaic"), 400, "VALIDATION_ERROR")
    err(costream(participants=["player-alpha-1", "ghost"]), 404, "PLAYER_NOT_FOUND")
    err(costream(host_player_id="player-beta-2", participants=["player-alpha-1"]), 400, "VALIDATION_ERROR")
    err(costream(layout="grid_2"), 400, "UNSUPPORTED_LAYOUT")
    err(costream(layout="solo", participants=FOUR[:2], simulate_host_drop=False), 400, "UNSUPPORTED_LAYOUT")
    assert costream(layout="grid_2", participants=FOUR[:3], simulate_host_drop=True).status_code == 201


def test_costream_full():
    body = {"session_id": "s-full", "host_player_id": "player-alpha-1", "participants": FOUR + ["player-gamma-9"]}
    r = post("/audit/v1/costream/session", body)
    err(r, 409, "COSTREAM_SESSION_FULL")


# ---------------- 5.6 QR ----------------

def test_qr_match_m1_spec_example():
    r = requests.get(BASE + "/audit/v1/qr/match-m1", timeout=5)
    b = r.json()
    assert r.status_code == 200
    assert {k: b[k] for k in ["entity_id", "entity_type", "entity_status", "short_url", "target_route", "deep_link_uri", "scan_count"]} == {
        "entity_id": "match-m1", "entity_type": "match", "entity_status": "in_progress", "short_url": "http://localhost:8080/q/m1-live",
        "target_route": "/web/matches/match-m1/live", "deep_link_uri": "nascon://entity/match-m1", "scan_count": 1}
    assert b["export_formats"] == {f: f"http://localhost:8080/audit/v1/qr/match-m1/export.{f}" for f in ("svg", "png", "pdf")}
    check_sig("match-m1", {"entity_id": "match-m1", "short_url": b["short_url"], "target_route": b["target_route"]}, b["signature"])


def test_qr_inspect_does_not_count():
    for _ in range(3):
        requests.get(BASE + "/audit/v1/qr/match-m1?inspect=true", timeout=5)
    assert requests.get(BASE + "/audit/v1/qr/match-m1?inspect=true", timeout=5).json()["scan_count"] == 0


@pytest.mark.parametrize("event,route", [
    ({"type": "match_end", "payload": {}}, "/web/matches/match-m1/vod"),
    ({"type": "match_status", "payload": {"status": "postponed"}}, "/web/matches/match-m1/notice?state=postponed"),
])
def test_qr_target_mutation_after_print(event, route):
    before = requests.get(BASE + "/audit/v1/qr/match-m1", timeout=5).json()
    assert post("/audit/v1/events", {"event_id": "qr-mut", "match_id": "match-m1", **event}).status_code == 201
    after = requests.get(BASE + "/audit/v1/qr/match-m1", timeout=5).json()
    assert after["short_url"] == before["short_url"]
    assert after["target_route"] == route and after["signature"] != before["signature"]
    check_sig("match-m1", {"entity_id": "match-m1", "short_url": after["short_url"], "target_route": route}, after["signature"])
    r = requests.get(BASE + "/q/m1-live", allow_redirects=False, timeout=5)
    assert r.status_code == 302 and r.headers["Location"].endswith(route)


@pytest.mark.parametrize("entity,route,code", [
    ("player-alpha-1", "/web/players/player-alpha-1", "p-alpha-1"),
    ("club-alpha-1", "/web/clubs/club-alpha-1", "c-alpha-1"),
])
def test_qr_seeded_player_and_club(entity, route, code):
    b = requests.get(BASE + f"/audit/v1/qr/{entity}", timeout=5).json()
    assert b["short_url"] == f"http://localhost:8080/q/{code}" and b["target_route"] == route


def test_qr_lazy_mapping_for_costream_and_unknown():
    costream()
    b = requests.get(BASE + "/audit/v1/qr/cs-session-101", timeout=5).json()
    assert b["entity_type"] == "costream" and b["target_route"] == "/web/costream/cs-session-101"
    assert requests.get(BASE + "/audit/v1/qr/cs-session-101", timeout=5).json()["short_url"] == b["short_url"]
    err(requests.get(BASE + "/audit/v1/qr/match-nope", timeout=5), 404, "QR_NOT_FOUND")
    err(requests.get(BASE + "/q/nope", allow_redirects=False, timeout=5), 404, "QR_NOT_FOUND")


def test_qr_exports():
    svg = requests.get(BASE + "/audit/v1/qr/match-m1/export.svg", timeout=5)
    assert svg.status_code == 200 and svg.headers["Content-Type"].startswith("image/svg+xml") and svg.text.lstrip().startswith(("<svg", "<?xml"))
    png = requests.get(BASE + "/audit/v1/qr/match-m1/export.png", timeout=5)
    assert png.headers["Content-Type"] == "image/png" and png.content[:8] == b"\x89PNG\r\n\x1a\n"
    pdf = requests.get(BASE + "/audit/v1/qr/match-m1/export.pdf", timeout=5)
    assert pdf.headers["Content-Type"] == "application/pdf" and pdf.content.startswith(b"%PDF-")


# ---------------- 5.7 guest boundary + cart merge ----------------

MERGE = {"guest_token": GUEST, "registered_user_id": "player-alpha-1",
         "guest_cart": [{"variant_id": "var-jersey-001-L", "quantity": 1}], "test_write_block": True}


def test_cart_merge_spec_example_and_network_migration_replay():
    r = post("/audit/v1/guest/cart-merge", MERGE)
    assert r.status_code == 200
    b = r.json()
    assert {k: b[k] for k in ["guest_token", "write_block_verified", "write_rejection_code", "cart_merged", "active_cart"]} == {
        "guest_token": GUEST, "write_block_verified": True, "write_rejection_code": 403, "cart_merged": True,
        "active_cart": {"user_id": "player-alpha-1", "currency": "PKR", "total_items": 1, "subtotal_minor": 450000,
                        "items": [{"variant_id": "var-jersey-001-L", "quantity": 1, "unit_price_minor": 450000}]}}
    check_sig(GUEST, {"cart_merged": True, "guest_token": GUEST, "registered_user_id": "player-alpha-1", "total_items": 1,
                      "write_rejection_code": 403}, b["signature"])
    again = post("/audit/v1/guest/cart-merge", MERGE)
    assert again.status_code == 200 and again.json()["active_cart"]["total_items"] == 1 and again.json() == b
    stock = 5
    assert requests.get(BASE + "/api/v1/products/pinned", timeout=5).json()["stock"] == stock  # nothing reserved


def test_cart_merge_concurrent_replays():
    barrier = threading.Barrier(8)

    def go():
        barrier.wait()
        return post("/audit/v1/guest/cart-merge", MERGE)
    with cf.ThreadPoolExecutor(8) as ex:
        results = list(ex.map(lambda _: go(), range(8)))
    assert all(r.status_code == 200 for r in results)
    assert {r.json()["active_cart"]["total_items"] for r in results} == {1}


def test_cart_merge_conflicts_and_errors():
    post("/audit/v1/guest/cart-merge", MERGE)
    err(post("/audit/v1/guest/cart-merge", {**MERGE, "registered_user_id": "player-alpha-2"}), 409, "GUEST_TOKEN_ALREADY_MERGED")
    err(post("/audit/v1/guest/cart-merge", {**MERGE, "guest_token": "tok_123"}), 400, "VALIDATION_ERROR")
    err(post("/audit/v1/guest/cart-merge", {**MERGE, "guest_cart": []}), 400, "VALIDATION_ERROR")
    err(post("/audit/v1/guest/cart-merge", {**MERGE, "guest_token": "guest_x", "registered_user_id": "ghost"}), 404, "PLAYER_NOT_FOUND")
    err(post("/audit/v1/guest/cart-merge", {**MERGE, "guest_token": "guest_x", "guest_cart": [{"variant_id": "var-nope", "quantity": 1}]}), 404, "VARIANT_NOT_FOUND")
    r = post("/audit/v1/guest/cart-merge", {**MERGE, "guest_token": "guest_y", "guest_cart": [{"variant_id": "var-jersey-001-M", "quantity": 2}]})
    err(r, 409, "OUT_OF_STOCK")
    assert r.json()["error"]["details"]["variant_id"] == "var-jersey-001-M"


def test_cart_merge_sums_existing_quantities():
    post("/audit/v1/guest/cart-merge", MERGE)
    b = post("/audit/v1/guest/cart-merge", {**MERGE, "guest_token": "guest_second", "guest_cart": [{"variant_id": "var-jersey-001-L", "quantity": 2}]}).json()
    assert b["active_cart"]["items"] == [{"variant_id": "var-jersey-001-L", "quantity": 3, "unit_price_minor": 450000}]
    assert b["active_cart"]["total_items"] == 3 and b["active_cart"]["subtotal_minor"] == 1350000


@pytest.mark.parametrize("path", ["/api/v1/chat", "/audit/v1/checkout", "/audit/v1/events"])
def test_direct_guest_writes_are_403(path):
    r = post(path, {"chat_room_id": "chat-cs-session-101", "text": "hi"}, {"Authorization": f"Bearer {GUEST}"})
    err(r, 403, "GUEST_WRITE_FORBIDDEN")
    assert r.json()["error"]["details"] == {"guest_token": GUEST}


def test_member_chat_requires_login_then_is_moderated_and_sequenced():
    err(post("/api/v1/chat", {"chat_room_id": "chat-x", "text": "hi"}), 401, "UNAUTHENTICATED")
    tok = post("/api/v1/auth/login", {"email": "organizer@nascon.test", "password": "Nascon@26"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    a = post("/api/v1/chat", {"chat_room_id": "chat-x", "text": "nice b@d_w0rd"}, h).json()
    b = post("/api/v1/chat", {"chat_room_id": "chat-x", "text": "great pass"}, h).json()
    assert (a["seq"], a["text"], a["flagged"], b["seq"]) == (1, "nice ***", True, 2)


# ---------------- 5.8 moderation + DLQ ----------------

PROBE = {"chat_room_id": "chat-cs-session-101", "incoming_messages": [
    {"message_id": "msg-1", "sender": "user-guest-1", "text": "Clean sports commentary"},
    {"message_id": "msg-2", "sender": "user-spammer", "text": "Watch this illegal stream b@d_w0rd now!"},
    {"message_id": "msg-3", "sender": "user-flooder", "text": "GOAL! AAAA!!!"}], "check_dlq": True, "simulate_failed_notifications": 0}


def test_moderation_spec_example():
    b = post("/audit/v1/moderation/test", PROBE).json()
    assert b["filtered_messages"] == [
        {"message_id": "msg-1", "sender": "user-guest-1", "text": "Clean sports commentary", "flagged": False, "reason": None},
        {"message_id": "msg-2", "sender": "user-spammer", "text": "Watch this illegal stream *** now!", "flagged": True, "reason": "profanity_leetspeak"}]
    assert (b["kicked_users"], b["muted_users"], b["dlq_status"]) == (["user-spammer"], ["user-flooder"], {"queue_depth": 0, "undelivered_events": []})
    check_sig("chat-cs-session-101", {"chat_room_id": "chat-cs-session-101", "flagged_count": 1, "kicked_users": ["user-spammer"], "queue_depth": 0}, b["signature"])


@pytest.mark.parametrize("text,masked", [
    ("p.0.r.n", "***"), ("s!c@m alert", "*** alert"), ("f*u*c*k", "***"), ("a$$h0le", "***"), ("bad_word!", "***!"),
    ("idiot_spam", "***"), ("sh!t", "***"), ("bitch", "***"), ("scampi classic", "scampi classic")])
def test_moderation_leetspeak(text, masked):
    b = post("/audit/v1/moderation/test", {"chat_room_id": "r", "incoming_messages": [{"message_id": "m", "sender": "u", "text": text}]}).json()
    assert b["filtered_messages"][0]["text"] == masked


@pytest.mark.parametrize("text", ["AAAA", "noooooo", "what???", "wow!!!", "GOAL! AAAA!!!"])
def test_moderation_flood_dropped_and_muted(text):
    b = post("/audit/v1/moderation/test", {"chat_room_id": "r", "incoming_messages": [{"message_id": "m", "sender": "u", "text": text}]}).json()
    assert b["filtered_messages"] == [] and b["muted_users"] == ["u"] and b["kicked_users"] == []


def test_moderation_dlq_and_concurrent_kicks():
    with cf.ThreadPoolExecutor(10) as ex:
        results = list(ex.map(lambda _: post("/audit/v1/moderation/test", PROBE), range(10)))
    assert all(r.status_code == 200 and r.json()["kicked_users"] == ["user-spammer"] for r in results)
    b = post("/audit/v1/moderation/test", {**PROBE, "simulate_failed_notifications": 3}).json()
    assert b["dlq_status"]["queue_depth"] == 3 and len(b["dlq_status"]["undelivered_events"]) == 3
    assert all(e["attempts"] == 3 for e in b["dlq_status"]["undelivered_events"])
    assert "nascon_dlq_depth 3" in requests.get(BASE + "/metrics", timeout=5).text
    post("/audit/v1/reset", {})
    assert post("/audit/v1/moderation/test", PROBE).json()["dlq_status"]["queue_depth"] == 0


def test_moderation_validation():
    err(post("/audit/v1/moderation/test", {"incoming_messages": []}), 400, "VALIDATION_ERROR")


# ---------------- 5.9 metrics + privacy ----------------

def test_metrics_exposition():
    r = requests.get(BASE + "/metrics", timeout=5)
    assert r.status_code == 200 and r.headers["Content-Type"] == "text/plain; version=0.0.4"
    for name in ["nascon_active_ws_connections", "nascon_active_streams_total", "nascon_stream_bitrate_kbps", "nascon_dlq_depth", "nascon_qr_scans_total"]:
        assert f"# TYPE {name} " in r.text and any(line.startswith(name + " ") for line in r.text.splitlines())


def test_privacy_erasure_revokes_tokens():
    tok = post("/api/v1/auth/login", {"email": "player@nascon.test", "password": "Nascon@26"}).json()["token"]
    post("/audit/v1/guest/cart-merge", MERGE)
    time.sleep(1.1)  # iat has 1 s resolution
    t0 = time.time()
    r = requests.delete(BASE + "/audit/v1/privacy/user/player-alpha-1", timeout=5)
    assert time.time() - t0 < 1.0
    assert r.status_code == 200 and r.json() == {"user_id": "player-alpha-1", "status": "anonymized", "pii_retained": False, "tokens_wiped": True}
    err(requests.get(BASE + "/api/v1/cart", headers={"Authorization": f"Bearer {tok}"}, timeout=5), 401, "UNAUTHENTICATED")
    err(post("/api/v1/auth/login", {"email": "player@nascon.test", "password": "Nascon@26"}), 401, "UNAUTHENTICATED")
    err(requests.delete(BASE + "/audit/v1/privacy/user/ghost", timeout=5), 404, "PLAYER_NOT_FOUND")


# ---------------- NFR-1 realtime ----------------

def test_score_broadcast_reaches_25_ws_clients_fast():
    websocket = pytest.importorskip("websocket")
    clients = [websocket.create_connection("ws://localhost:8080/ws/matches/match-m1", timeout=5) for _ in range(25)]
    for c in clients:
        assert json.loads(c.recv())["banner"] == "1 - 0"
    t0 = time.perf_counter()
    assert post("/audit/v1/events", {"event_id": "ws-1", "match_id": "match-m1", "type": "score",
                                     "payload": {"team_id": "club-alpha-2", "event_type": "goal"}}).status_code == 201
    latencies = []
    for c in clients:
        msg = json.loads(c.recv())
        latencies.append(time.perf_counter() - t0)
        assert msg["banner"] == "1 - 1"
        c.close()
    latencies.sort()
    assert latencies[int(len(latencies) * 0.95) - 1] < 0.5
