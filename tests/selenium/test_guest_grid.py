"""Selenium Grid 4 Guest Web Player suite (D2 6.2.3). Run: pytest -n 3 tests/selenium/ --junitxml=tests/reports/selenium-report.xml

Browsers run inside the grid's Docker network, so they reach the backend by service name (WEB_BASE);
the test process itself talks to the API on API_BASE.
"""
import os
import time

import pytest
import requests
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

GRID = os.environ.get("GRID_URL", "http://localhost:4444/wd/hub")
WEB_BASE = os.environ.get("WEB_BASE", "http://backend:8080")
API_BASE = os.environ.get("API_BASE", "http://localhost:8080")


def tid(name):
    return (By.CSS_SELECTOR, f'[data-testid="{name}"]')


@pytest.fixture(params=["chrome", "firefox"])
def driver(request):
    if requests.get(GRID.replace("/wd/hub", "") + "/status", timeout=5).json()["value"]["ready"] is not True:
        pytest.skip("Selenium Grid not ready")
    opts = webdriver.ChromeOptions() if request.param == "chrome" else webdriver.FirefoxOptions()
    opts.add_argument("--headless")
    d = webdriver.Remote(command_executor=GRID, options=opts)
    d.set_page_load_timeout(15)
    yield d
    d.quit()


def api_banner(match_id):
    s = requests.get(f"{API_BASE}/audit/v1/score/{match_id}", timeout=5).json()
    return f"{s['home']['score']} - {s['away']['score']}"


def fresh_live_match(tag):
    """Each parallel test scores its own match so workers never race on shared state."""
    match_id = f"match-sel-{tag}-{time.time_ns()}"
    for i, (etype, payload) in enumerate([
        ("match_init", {"sport_id": "football", "home_team_id": "club-alpha-1", "away_team_id": "club-alpha-2"}),
        ("match_start", {}),
    ]):
        r = requests.post(API_BASE + "/audit/v1/events", json={"event_id": f"{match_id}-{i}", "match_id": match_id, "type": etype, "payload": payload}, timeout=5)
        assert r.status_code == 201, r.text
    return match_id


def test_1_qr_resolution_zero_friction_load(driver):
    t0 = time.time()
    driver.get(WEB_BASE + "/q/m1-live")
    wait = WebDriverWait(driver, 3)
    wait.until(EC.visibility_of_element_located(tid("guest-video-player")))
    wait.until(lambda d: d.find_element(*tid("live-score-banner")).text.strip() == api_banner("match-m1"))
    assert time.time() - t0 < 3.5
    assert driver.current_url.endswith("/web/matches/match-m1/live")
    assert not driver.find_element(*tid("progressive-auth-modal")).is_displayed()
    for name in ["pinned-merch-card", "add-to-guest-cart-btn", "guest-cart-count", "chat-message-list", "chat-input-field", "chat-send-btn"]:
        assert driver.find_element(*tid(name)).is_displayed(), name


def test_2_guest_write_block_opens_progressive_modal(driver):
    driver.get(WEB_BASE + "/web/matches/match-m1/live")
    wait = WebDriverWait(driver, 5)
    field = wait.until(EC.element_to_be_clickable(tid("chat-input-field")))
    field.send_keys("Hello from a guest")
    driver.find_element(*tid("chat-send-btn")).click()
    wait.until(EC.visibility_of_element_located(tid("progressive-auth-modal")))
    assert "Hello from a guest" not in driver.find_element(*tid("chat-message-list")).text


def test_3_guest_cart_staging_and_realtime_score(driver):
    match_id = fresh_live_match(driver.capabilities["browserName"])
    driver.get(f"{WEB_BASE}/web/matches/{match_id}/live")
    wait = WebDriverWait(driver, 5)
    wait.until(lambda d: d.find_element(*tid("live-score-banner")).text.strip() == "0 - 0")
    assert driver.find_element(*tid("guest-cart-count")).text.strip() == "0"
    driver.find_element(*tid("add-to-guest-cart-btn")).click()
    wait.until(lambda d: d.find_element(*tid("guest-cart-count")).text.strip() == "1")
    time.sleep(0.5)  # let the WebSocket subscription settle before timing the push
    t0 = time.perf_counter()
    r = requests.post(API_BASE + "/audit/v1/events", json={"event_id": f"sel-{driver.capabilities['browserName']}-{time.time_ns()}",
                                                         "match_id": match_id, "type": "score",
                                                         "payload": {"team_id": "club-alpha-1", "event_type": "goal"}}, timeout=5)
    assert r.status_code == 201
    WebDriverWait(driver, 0.5, poll_frequency=0.02).until(lambda d: d.find_element(*tid("live-score-banner")).text.strip() == "1 - 0")
    assert time.perf_counter() - t0 < 0.5
