"""Day 2 Tier 0 contract tests: baseline seed, guest write guard, event engine over HTTP."""
import hashlib
import hmac
import json
import os

import pytest
import requests

BASE = "http://localhost:8080"
GUEST = {"Authorization": "Bearer guest_anon_tok_7721"}


def post(path, body, headers=None):
    return requests.post(BASE + path, json=body, headers=headers or {}, timeout=10)


@pytest.fixture(autouse=True)
def reset():
    r = post("/audit/v1/reset", {"seed": 42})
    assert r.status_code == 200


def test_health_checks_all_dependencies():
    r = requests.get(BASE + "/health", timeout=5)
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_reset_keeps_day1_contract():
    r = post("/audit/v1/reset", {})
    assert r.json() == {
        "status": "reset_complete", "seed": 42,
        "sports": ["football", "basketball", "cricket", "esports"],
        "tenants": ["tenant-alpha", "tenant-beta"],
        "stock": {"var-jersey-001-M": 1, "var-jersey-001-L": 5},
    }


@pytest.mark.parametrize("body", [{"seed": "x"}, {"stock": {"var-jersey-001-M": -1}}, {"stock": [1]}])
def test_reset_rejects_bad_body(body):
    r = post("/audit/v1/reset", body)
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_match_m1_seeded_in_progress_one_nil():
    s = requests.get(BASE + "/audit/v1/score/match-m1", timeout=5).json()
    assert s["status"] == "in_progress" and s["sport_id"] == "football" and s["league_id"] == "league-alpha-1"
    assert (s["home"]["team_id"], s["home"]["score"], s["away"]["team_id"], s["away"]["score"]) == ("club-alpha-1", 1, "club-alpha-2", 0)


def test_reset_restores_match_m1_after_changes():
    post("/audit/v1/events", {"event_id": "t-end", "match_id": "match-m1", "type": "match_end", "payload": {}})
    post("/audit/v1/reset", {})
    assert requests.get(BASE + "/audit/v1/score/match-m1", timeout=5).json()["status"] == "in_progress"


@pytest.mark.parametrize("path,body", [
    ("/audit/v1/events", {"event_id": "g1", "match_id": "match-m1", "type": "score", "payload": {"team_id": "club-alpha-1", "event_type": "goal"}}),
    ("/audit/v1/events", {}),
])
def test_guest_bearer_write_is_403(path, body):
    r = post(path, body, GUEST)
    assert r.status_code == 403
    assert r.json()["error"] == {
        "code": "GUEST_WRITE_FORBIDDEN",
        "message": "Anonymous guest tokens cannot perform write mutations.",
        "details": {"guest_token": "guest_anon_tok_7721"},
    }
    # Nothing was appended.
    assert requests.get(BASE + "/audit/v1/score/match-m1", timeout=5).json()["version"] == 3


def test_score_event_signature_and_projection():
    payload = {"team_id": "club-alpha-2", "event_type": "goal"}
    r = post("/audit/v1/events", {"event_id": "evt-x", "match_id": "match-m1", "type": "score", "payload": payload})
    assert r.status_code == 201
    body = r.json()
    assert (body["sequence"], body["match_version"]) == (4, 4)
    salt = os.environ.get("DAY1_SALT")
    if salt:
        msg = ("evt-x|" + json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)).encode()
        assert body["signature"] == hmac.new(salt.encode(), msg, hashlib.sha256).hexdigest()
    assert post("/audit/v1/events", {"event_id": "evt-x", "match_id": "match-m1", "type": "score", "payload": payload}).status_code == 200
    s = requests.get(BASE + "/audit/v1/score/match-m1", timeout=5).json()
    assert (s["home"]["score"], s["away"]["score"]) == (1, 1)


@pytest.mark.parametrize("event,status", [
    ({"type": "match_end", "payload": {}}, "completed"),
    ({"type": "match_status", "payload": {"status": "postponed"}}, "postponed"),
    ({"type": "match_postpone", "payload": {}}, "postponed"),
    ({"type": "match_abandon", "payload": {}}, "abandoned"),
])
def test_match_m1_state_transitions(event, status):
    r = post("/audit/v1/events", {"event_id": "st-1", "match_id": "match-m1", **event})
    assert r.status_code == 201, r.text
    assert requests.get(BASE + "/audit/v1/score/match-m1", timeout=5).json()["status"] == status


def test_unknown_match_is_404():
    r = requests.get(BASE + "/audit/v1/score/nope", timeout=5)
    assert r.status_code == 404 and r.json()["error"]["code"] == "MATCH_NOT_FOUND"
