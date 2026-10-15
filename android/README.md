# Bubble Chat for Android

A floating chat bubble over other apps. Tapping it opens a panel that loads the
web app's `/overlay` page in a WebView. Kotlin, Views (no Compose), minSdk 26,
targetSdk 35, package `com.bubblechat.app`.

| File | Role |
|---|---|
| `MainActivity.kt` | Setup screen: permissions, start/stop, `bubble://link` deep link |
| `OverlayService.kt` | Foreground service; owns the bubble + panel windows and the one WebView |
| `BubbleView.kt` | Draggable 56 dp bubble (tap → expand, release → snap to edge) |
| `ChatPanelView.kt` | Rounded panel hosting the WebView; outside tap / Back collapses; shrinks above the keyboard |
| `JsBridge.kt` | `window.Android` methods; must match `web/lib/bridge.ts` |
| `Prefs.kt` | Link token, bubble position, "bubble on" flag |
| `BootReceiver.kt` | Restarts the bubble after reboot/app update if it was on |

## Build and run on your phone

1. Install [Android Studio](https://developer.android.com/studio) and open the `android/` folder.
   Let it finish syncing (it downloads the SDK and Gradle dependencies).
2. Copy the `bubble.*` lines from `local.properties.example` into `android/local.properties`.
   For a phone, point `bubble.debugBaseUrl` at your ngrok URL while `npm run dev` runs.
3. On the phone: Settings → About phone → tap **Build number** 7 times → Developer options →
   turn on **USB debugging**. Connect by USB and accept the prompt.
4. Press **Run** in Android Studio (or `gradlew installDebug`).
5. In the app: allow **Display over other apps** and **Notifications**, then **Start bubble**.
6. Link your account: in the phone's browser, open the web app → sidebar → **Link bubble app** →
   **Create link** → **Open in Bubble app**.

Debug builds allow `chrome://inspect` on the PC to debug the overlay page inside the WebView.
