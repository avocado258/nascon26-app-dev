# NaSCon Live — Android shell

Native Android app (`com.nascon.live`, minSdk 29) that hosts the Guest Web Player in a WebView.

- `nascon://entity/{id}` → `/web/matches/{id}/live` (players → `/web/players/{id}`, clubs → `/web/clubs/{id}`, `cs-session-*` → `/web/costream/{id}`); `nascon://stream/{id}` → `/web/costream/{id}`. No login screen on deep links.
- **Scan QR** (ZXing): `nascon://…` links route natively; `http://…/q/{code}` posters resolve through the configured server.
- **Server**: backend address, saved on the device. Emulator `http://10.0.2.2:8080`; phone `http://<laptop LAN IP>:8080`, or `adb reverse tcp:8080 tcp:8080` with `http://localhost:8080`. It can also be set at launch: `adb shell am start -n com.nascon.live/.MainActivity --es base_url http://<host>:8080`.
- The loaded route is shown in the top bar (`com.nascon.live:id/route`, used by `tests/appium`).

```bash
cd mobile && ./gradlew assembleRelease && cp app/build/outputs/apk/release/app-release.apk release/
adb install -r release/app-release.apk
adb shell am start -W -a android.intent.action.VIEW -d "nascon://entity/match-m1"
```
