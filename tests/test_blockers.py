"""Black-box regression tests for the Day 1 blockers and round-robin bugs (docs/STATUS.md).

Runs against the live stack on :8080, the same way the grader does.
"""
import itertools
import json

import pytest
import requests

BASE = "http://localhost:8080"


def post(path, body=None, raw=None):
    data = raw if raw is not None else json.dumps(body)
    return requests.post(BASE + path, data=data, headers={"Content-Type": "application/json"}, timeout=10)


def rr(teams, params=None):
    return post("/audit/v1/fixtures", {"format": "round_robin", "teams": teams, "params": params or {}})


def teams_of(n):
    return [f"t{i}" for i in range(1, n + 1)]


def assert_error(r, status, code):
    assert r.status_code == status, r.text
    body = r.json()
    assert body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str)
    assert isinstance(body["error"]["details"], dict)


# --- Blocker 2: readiness without a prior /reset (fresh-boot proof lives in the proof script) ---

def test_health_ok():
    r = requests.get(BASE + "/health", timeout=5)
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_reset_contract():
    r = post("/audit/v1/reset", {"seed": 42})
    assert r.status_code == 200
    assert r.json() == {
        "status": "reset_complete",
        "seed": 42,
        "sports": ["football", "basketball", "cricket", "esports"],
        "tenants": ["tenant-alpha", "tenant-beta"],
        "stock": {"var-jersey-001-M": 1, "var-jersey-001-L": 5},
    }


# --- Blocker 1: errors util resolves (any ApiError path proves the module loads) ---

def test_api_error_path_works():
    post("/audit/v1/reset", {})
    football = {
        "sport_id": "football", "name": "F", "scoring_model": "event",
        "periods": {"count": 2, "duration_minutes": 45}, "scoring_events": {"goal": {"points": 1}},
        "draw_allowed": True, "overtime": {"policy": "none"},
        "roster": {"min_squad_size": 1, "max_squad_size": 2},
    }
    assert_error(post("/audit/v1/sports", football), 409, "SPORT_EXISTS")


# --- Blocker 5: JSON bodies for parser failures ---

def test_malformed_json_is_400_validation_error():
    r = post("/audit/v1/sports", raw='{"sport_id": ')
    assert_error(r, 400, "VALIDATION_ERROR")
    assert isinstance(r.json()["error"]["details"]["fields"], list)


@pytest.mark.parametrize("path", ["/audit/v1/sports", "/audit/v1/fixtures", "/audit/v1/reset"])
def test_body_over_1mb_is_413(path):
    r = post(path, raw=json.dumps({"x": "a" * (1024 * 1024 + 10)}))
    assert_error(r, 413, "PAYLOAD_TOO_LARGE")


def test_body_just_under_1mb_is_not_413():
    r = post("/audit/v1/fixtures", raw=json.dumps({"format": "round_robin", "teams": ["a", "b"], "pad": "a" * 1000000}))
    assert r.status_code == 200


# --- Round-robin bugs 1-4, plus leg-2 ordered pairs, checked over HTTP ---

@pytest.mark.parametrize("n,legs", [(n, legs) for n in range(2, 41) for legs in (1, 2)])
def test_round_robin_properties(n, legs):
    r = rr(teams_of(n), {"legs": legs})
    assert r.status_code == 200
    body = r.json()
    per_leg = n if n % 2 else n - 1
    assert body["round_count"] == per_leg * legs == len(body["rounds"])
    unordered, ordered, balance = {}, {}, {}
    for k, rd in enumerate(body["rounds"], start=1):
        assert rd["round"] == k
        assert len(rd["byes"]) == n % 2
        assert len(rd["matches"]) == n // 2
        seen = set(rd["byes"])
        for j, m in enumerate(rd["matches"], start=1):
            # Bug 1 (index skipped bye slot) and bug 2 (leg-local round in id).
            assert m["match_id"] == f"RR-L{m['leg']}-R{k}-M{j}"
            assert {m["home"], m["away"]}.isdisjoint(seen)
            seen |= {m["home"], m["away"]}
            pair = frozenset((m["home"], m["away"]))
            unordered[pair] = unordered.get(pair, 0) + 1
            ordered[(m["home"], m["away"])] = ordered.get((m["home"], m["away"]), 0) + 1
            b = balance.setdefault(m["leg"], {})
            b[m["home"]] = b.get(m["home"], 0) + 1
            b[m["away"]] = b.get(m["away"], 0) - 1
        assert len(seen) == n
    assert len(unordered) == n * (n - 1) // 2 and set(unordered.values()) == {legs}
    if legs == 2:
        assert len(ordered) == n * (n - 1) and set(ordered.values()) == {1}
    for leg in balance.values():
        assert all(abs(d) <= 1 for d in leg.values())


def test_spec_example_forfeit_remaining():
    body = rr(teams_of(5), {"legs": 1, "withdrawals": [{"team_id": "t3", "after_round": 2}],
                            "withdrawal_policy": "forfeit_remaining"}).json()
    assert body["summary"] == {"total": 10, "scheduled": 8, "forfeit": 2, "voided": 0}
    for rd in body["rounds"]:
        for m in rd["matches"]:
            if "t3" in (m["home"], m["away"]):
                if rd["round"] > 2:
                    assert m["status"] == "forfeit"
                    assert m["awarded_to"] == (m["away"] if m["home"] == "t3" else m["home"])
                else:
                    assert m["status"] == "scheduled" and m["awarded_to"] is None


@pytest.mark.parametrize("after", [-1, 4, 99, "2", None])
def test_after_round_out_of_range_is_400(after):
    # Bug 3: n=3 has round_count 3, so the valid range is 0..3.
    assert_error(rr(teams_of(3), {"withdrawals": [{"team_id": "t1", "after_round": after}]}), 400, "VALIDATION_ERROR")


@pytest.mark.parametrize("after", [0, 3])
def test_after_round_bounds_accepted(after):
    assert rr(teams_of(3), {"withdrawals": [{"team_id": "t1", "after_round": after}]}).status_code == 200


@pytest.mark.parametrize("policy", ["forfeit_remaining", "void_all"])
def test_both_teams_withdrawn_is_voided(policy):
    # Bug 4: previously a forfeit awarded to one withdrawn team.
    body = rr(teams_of(4), {"withdrawal_policy": policy, "withdrawals": [
        {"team_id": "t1", "after_round": 0}, {"team_id": "t2", "after_round": 0}]}).json()
    m = next(m for rd in body["rounds"] for m in rd["matches"] if {m["home"], m["away"]} == {"t1", "t2"})
    assert m["status"] == "voided" and m["awarded_to"] is None


def test_void_all_keeps_fixtures_and_byes():
    body = rr(teams_of(5), {"withdrawal_policy": "void_all", "withdrawals": [{"team_id": "t2", "after_round": 3}]}).json()
    involved = [m for rd in body["rounds"] for m in rd["matches"] if "t2" in (m["home"], m["away"])]
    assert len(involved) == 4 and all(m["status"] == "voided" and m["awarded_to"] is None for m in involved)
    assert body["summary"]["total"] == 10
    assert sorted(itertools.chain.from_iterable(rd["byes"] for rd in body["rounds"])) == teams_of(5)


@pytest.mark.parametrize("params", [{"legs": 3}, {"withdrawal_policy": "nope"},
                                    {"withdrawals": [{"team_id": "zz", "after_round": 1}]}])
def test_bad_params_are_400(params):
    assert_error(rr(teams_of(4), params), 400, "VALIDATION_ERROR")
