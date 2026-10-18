"""Appium 2 deep-link + cross-surface suite (D2 6.3).

Run on the mobile QA laptop (Appium 2 + uiautomator2 on :4723, phone or emulator via adb):
    pytest tests/appium/ --junitxml=tests/reports/appium-report.xml
Skips (with a reason) when no Appium server is reachable, e.g. on the cloud runner.
"""
import json
import os
import time

import pytest
import requests

APPIUM = os.environ.get("APPIUM_URL", "http://localhost:4723")
API_BASE = os.environ.get("API_BASE", "http://localhost:8080")
GRID = os.environ.get("GRID_URL", "http://localhost:4444/wd/hub")
WEB_BASE = os.environ.get("WEB_BASE", "http://backend:8080")
APP_PACKAGE = os.environ.get("APP_PACKAGE", "com.nascon.live")


def appium_ready():
    try:
        r = requests.get(APPIUM + "/status", timeout=3)
        return r.status_code == 200 and r.json().get("value", {}).get("ready") is True
    except requests.RequestException:
        return False


pytestmark = pytest.mark.skipif(not appium_ready(), reason=f"Appium 2 not reachable at {APPIUM}/status")


@pytest.fixture(scope="module")
def driver():
    webdriver = pytest.importorskip("appium.webdriver")
    options_mod = pytest.importorskip("appium.options.android")
    opts = options_mod.UiAutomator2Options()
    opts.platform_name = "Android"
    opts.automation_name = "UiAutomator2"
    opts.app_package = APP_PACKAGE
    opts.app_activity = ".MainActivity"
    opts.no_reset = True
    d = webdriver.Remote(APPIUM, options=opts)
    yield d
    d.quit()


def test_appium_status_ready():
    assert requests.get(APPIUM + "/status", timeout=3).json()["value"]["ready"] is True


@pytest.mark.parametrize("url,expect", [
    ("nascon://entity/match-m1", "/web/matches/match-m1/live"),
    ("nascon://stream/cs-session-101", "/web/costream/cs-session-101"),
])
def test_deep_link_opens_screen_without_login(driver, url, expect):
    t0 = time.time()
    driver.execute_script("mobile: deepLink", {"url": url, "package": APP_PACKAGE})
    deadline = t0 + 2.0
    while time.time() < deadline and driver.current_package != APP_PACKAGE:
        time.sleep(0.1)
    assert driver.current_package == APP_PACKAGE
    assert time.time() - t0 < 2.5
    # The shell app exposes the loaded route as the WebView content description.
    route = driver.find_element("id", f"{APP_PACKAGE}:id/route").text
    assert route.endswith(expect) and "login" not in route.lower()


def test_cross_surface_costream_chat_sync(driver):
    """Mobile joins cs-session-101 while a Grid browser watches /web/costream/cs-session-101; chat arrives < 3 s."""
    selenium = pytest.importorskip("selenium.webdriver")
    requests.post(API_BASE + "/audit/v1/costream/session", json={
        "session_id": "cs-session-101", "host_player_id": "player-alpha-1",
        "participants": ["player-alpha-1", "player-alpha-2", "player-beta-1", "player-beta-2"], "layout": "grid_4"}, timeout=5)
    driver.execute_script("mobile: deepLink", {"url": "nascon://stream/cs-session-101", "package": APP_PACKAGE})

    opts = selenium.ChromeOptions()
    opts.add_argument("--headless")
    browser = selenium.Remote(command_executor=GRID, options=opts)
    try:
        browser.get(WEB_BASE + "/web/costream/cs-session-101")
        token = requests.post(API_BASE + "/api/v1/auth/login", json={"email": "manager@nascon.test", "password": "Nascon@26"}, timeout=5).json()["token"]
        text = f"cross-surface {time.time_ns()}"
        t0 = time.time()
        r = requests.post(API_BASE + "/api/v1/chat", json={"chat_room_id": "chat-cs-session-101", "text": text},
                          headers={"Authorization": f"Bearer {token}"}, timeout=5)
        assert r.status_code == 201, r.text
        while time.time() - t0 < 3.0 and text not in browser.find_element("css selector", '[data-testid="chat-message-list"]').text:
            time.sleep(0.05)
        assert text in browser.find_element("css selector", '[data-testid="chat-message-list"]').text
        assert time.time() - t0 < 3.0
    finally:
        browser.quit()
