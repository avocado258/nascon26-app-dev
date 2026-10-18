"""5-role RBAC negative matrix (D1 5.13 table, D2 App. B FORBIDDEN/UNAUTHENTICATED)."""
import base64
import json

import pytest
import requests

BASE = "http://localhost:8080"
ROLES = ["super_admin", "league_organizer", "club_manager", "player", "viewer"]


@pytest.fixture(scope="module")
def m():
    assert requests.post(BASE + "/audit/v1/reset", json={}, timeout=10).status_code == 200
    r = requests.post(BASE + "/audit/v1/rbac-matrix", timeout=10)
    assert r.status_code == 200
    return r.json()


def call(method, path, token):
    return requests.request(method, BASE + "/audit/v1/rbac" + path, json={} if method != "GET" else None,
                            headers={"Authorization": f"Bearer {token}"}, timeout=5)


# (method, path template, context key, expected A/D per role in ROLES order) — straight from the spec table.
MATRIX = [
    ("POST", "/tenants", None, "ADDDD"),
    ("POST", "/leagues/{}/fixtures", "own_league_id", "AADDD"),
    ("POST", "/leagues/{}/fixtures", "other_league_id", "ADDDD"),
    ("POST", "/leagues/{}/fixtures", "foreign_league_id", "ADDDD"),
    ("POST", "/clubs/{}/roster", "own_club_id", "ADADD"),
    ("POST", "/clubs/{}/roster", "other_club_id", "ADDDD"),
    ("POST", "/clubs/{}/roster", "foreign_club_id", "ADDDD"),
    ("POST", "/clubs/{}/products", "own_club_id", "ADADD"),
    ("POST", "/clubs/{}/products", "other_club_id", "ADDDD"),
    ("POST", "/clubs/{}/products", "foreign_club_id", "ADDDD"),
    ("PATCH", "/players/{}", "own_player_id", "ADAAD"),
    ("PATCH", "/players/{}", "other_player_id", "ADDDD"),
    ("PATCH", "/players/{}", "foreign_player_id", "ADDDD"),
    ("GET", "/clubs/{}", "own_club_id", "AAAAA"),
    ("GET", "/clubs/{}", "other_club_id", "AAAAA"),
    ("GET", "/clubs/{}", "foreign_club_id", "ADDDD"),
    ("GET", "/platform/config", None, "ADDDD"),
]


@pytest.mark.parametrize("method,path,key,expected", MATRIX)
def test_matrix_row(m, method, path, key, expected):
    url = path.format(m["context"][key]) if key else path
    for role, exp in zip(ROLES, expected):
        r = call(method, url, m["tokens"][role])
        if exp == "A":
            assert (r.status_code, r.json()) == (200, {"authorized": True}), (role, url, r.text)
        else:
            assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN", (role, url, r.text)


def test_context_ids(m):
    assert m["context"] == {
        "tenant_id": "tenant-alpha", "foreign_tenant_id": "tenant-beta",
        "own_league_id": "league-alpha-1", "other_league_id": "league-alpha-2", "foreign_league_id": "league-beta-1",
        "own_club_id": "club-alpha-1", "other_club_id": "club-alpha-2", "foreign_club_id": "club-beta-1",
        "own_player_id": "player-alpha-1", "other_player_id": "player-alpha-2", "foreign_player_id": "player-beta-1"}
    assert set(m["tokens"]) == set(ROLES)


def test_unauthenticated_cases(m):
    r = requests.get(BASE + "/audit/v1/rbac/platform/config", timeout=5)
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"
    tok = m["tokens"]["super_admin"]
    head, body, sig = tok.split(".")
    tampered = f"{head}.{body}.{sig[:-2]}{'AA' if sig[-2:] != 'AA' else 'BB'}"
    assert call("GET", "/platform/config", tampered).status_code == 401
    none_head = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).decode().rstrip("=")
    assert call("GET", "/platform/config", f"{none_head}.{body}.").status_code == 401
    assert call("GET", "/platform/config", "garbage").status_code == 401


def test_unknown_ids_are_404_not_403(m):
    r = call("GET", "/clubs/club-nope", m["tokens"]["viewer"])
    assert r.status_code == 404
