# Floating Chat Bubble — Implementation Plan for Claude Code

Oct 14, 2026 · @Network

## Overview

Build a chatbot that floats as a bubble over other Android apps, for about 10 allowlisted friends, at zero cost. The chat UI and backend are a Next.js PWA; a small Kotlin app draws the bubble and loads that PWA in a WebView.

```
 Browser / PWA ─┐                         ┌─► Firebase Auth + Firestore
                ├─► Next.js on Vercel ────┤
 Android bubble ┘   (/api/chat, ...)      └─► LLM (Gemini, auto-fallback Groq)
 (WebView → /overlay)
 Both clients also talk to Firebase directly (login + live history reads).
```

Both clients also use the Firebase web SDK directly for login and live history; the server verifies tokens, calls the LLM and enforces limits.

### Constraints

- Android only for the overlay (iOS has no equivalent); iPhone users get the PWA.
- $0: Firebase Spark, Vercel Hobby, free-tier LLM, sideloaded APK (no Play Store).
- 10 users, so simplicity beats scale everywhere.
- Most changes ship through the web app without rebuilding the APK.

### Stack

| Layer | Choice |
| --- | --- |
| Web | Next.js 16 App Router (Turbopack default), TypeScript, Tailwind v4, Serwist via `@serwist/turbopack` (PWA) |
| Auth + data | Firebase Auth (Google), Firestore, firebase-admin on the server |
| LLM | Vercel AI SDK (v7) with Google Gemini; automatic fallback to Groq on 429/errors |
| Hosting | Vercel Hobby |
| Android | Kotlin, WindowManager overlay, WebView, foreground service |
| Distribution | Signed APK on GitHub Releases |

### Build order

1. Phase 1: PWA with login and mocked chat
2. Phase 2: real streaming backend
3. Phase 3: overlay page and bridge contract
4. Phase 4: Android bubble app
5. Phase 5: sign, distribute, deploy

## Repo structure

One git repo, two independent projects. The Android app only needs the web app's URL, so they deploy separately.

```
ChatBot/                    # repo root = D:\NextJs\ChatBot
  web/                      # Next.js 16 (App Router), TypeScript, Tailwind v4
    app/
      (app)/page.tsx        # full chat UI for browser / PWA
      overlay/page.tsx      # compact chat UI loaded by the Android WebView
      login/page.tsx
      api/chat/route.ts     # streaming LLM endpoint
      api/conversations/    # DELETE only (recursive delete); clients read history from Firestore directly
      api/device-token/route.ts  # mints custom token for bubble linking
      api/revoke/route.ts   # "Unlink all devices"
      manifest.ts           # PWA manifest
    components/
    lib/
      firebase/client.ts    # Firebase web SDK init
      firebase/admin.ts     # firebase-admin init (server only)
      llm.ts                # provider adapter (Gemini default, Groq fallback)
      bridge.ts             # typed wrapper around window.Android
      usage.ts              # transactional per-user + global daily caps
    scripts/allow-user.ts   # adds allowlist doc + `allowed` custom claim
    firestore.rules
    firebase.json
    .env.example
  android/                  # Kotlin, Android Studio project, minSdk 26, targetSdk 35
    app/src/main/
      AndroidManifest.xml
      java/com/bubblechat/app/   # package com.bubblechat.app (AGP 9 built-in Kotlin, compileSdk 36)
        MainActivity.kt         # permission flow + start/stop service
        OverlayService.kt       # foreground service, owns the WindowManager views
        BubbleView.kt           # draggable circle
        ChatPanelView.kt        # expanded panel hosting the WebView
        JsBridge.kt             # @JavascriptInterface methods
        Prefs.kt                # stores bubble position, auth token
      res/layout/, res/drawable/
  README.md
  CLAUDE.md                 # this plan, trimmed to the rules Claude Code must follow
```

Ask Claude Code to scaffold `web/` with `create-next-app` and `android/` with the Android Studio "Empty Views Activity" template, then commit before writing features.

## Phase 1: Next.js PWA with Firebase Auth and Firestore

Goal: a working, installable chat app in the browser with login and persisted history, using mocked replies until Phase 2.

### Firebase project (manual, one-time)

1. Create a Firebase project on the Spark (free) plan. Do not upgrade to Blaze.
2. Enable Authentication with the Google provider only. Add `localhost` and your Vercel domain to authorized domains.
3. Create a Firestore database in production mode.
4. Register a Web app and copy the config into `web/.env.local` (see the env section).
5. Generate a service-account key (Project settings → Service accounts) for `firebase-admin`; store it as a single base64 env var, never commit it.

Note: Firebase Hosting with Next.js SSR needs App Hosting, which requires Blaze. Host on Vercel instead; Firebase is used only for Auth and Firestore.

### Allowlist (your 10 users)

Firestore collection `allowlist/{email}` with `{ addedAt }`. Store emails **lowercased**. Security rules and the API deny anyone whose email is not present. This stops strangers burning your LLM quota if the URL leaks.

Because ID tokens obtained via `signInWithCustomToken` (the bubble) may not carry the `email` claim, also set a custom claim `allowed: true` on each allowlisted user (small admin script `web/scripts/allow-user.ts` that writes the allowlist doc and calls `setCustomUserClaims`). Rules and `requireUser` accept either the claim or an allowlist doc for the token's email. Verify the actual claims in Phase 3 and simplify if one check suffices.

### Firestore data model

```
users/{uid}                { email, displayName, createdAt, lastSeenAt }
users/{uid}/conversations/{convId}
                           { title, createdAt, updatedAt, messageCount }
users/{uid}/conversations/{convId}/messages/{msgId}
                           { role: 'user' | 'assistant', content, createdAt, tokens? }
allowlist/{email}          { addedAt }
usage/{uid}_{YYYY-MM-DD}   { requests, inputTokens, outputTokens }
```

### Security rules (firestore.rules)

- `users/{uid}/**`: read only if `request.auth.uid == uid` and the user is allowed (claim `allowed == true` or allowlist doc for `request.auth.token.email`).
- Clients never write: the server creates conversations on the first message and writes all messages with the admin SDK. `users/**` is read-only for clients.
- `allowlist/**`: no client read/write; managed from the Firebase console.
- `usage/**`: no client access; written by the server with admin SDK.

### Web tasks

- [ ] `create-next-app` with TypeScript, Tailwind, App Router, `src/` off
- [ ] Install `firebase`, `firebase-admin`, `server-only`, `@serwist/turbopack` (PWA; Next 16 builds with Turbopack, so not `@serwist/next`), `zod`
- [ ] `lib/firebase/client.ts`: init app, `getAuth`, `getFirestore`; export `signInWithGoogle`, `signOut`
- [ ] iOS PWA sign-in: set `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` to the Vercel domain and add a rewrite `/__/auth/:path*` → `https://<project>.firebaseapp.com/__/auth/:path*` in `next.config.ts` (Firebase's documented fix for third-party storage blocking). Popup on desktop/Android, redirect in iOS standalone mode.
- [ ] Auth gate: `(app)` layout redirects to `/login` when signed out; `/login` shows one Google button
- [ ] Chat UI: conversation list sidebar (drawer on mobile), message list, composer, streaming text rendering with markdown (`react-markdown`)
- [ ] Subscribe with `onSnapshot` for the active conversation. Messages are written by the server (even the mock), never by the client.
- [ ] Client generates `userMessageId` and `assistantMessageId` per send; the UI shows pending bubbles under those IDs and replaces them when the snapshot delivers docs with the same IDs (no duplicates).
- [ ] Mock `POST /api/chat` that streams a canned reply and writes both messages via admin SDK, so the UI and data flow match Phase 2
- [ ] PWA: `app/manifest.ts` (name, icons 192/512, `display: standalone`, theme color), Serwist service worker, offline fallback page. Navigations **network-first**, never cache `/api/*`, so web deploys reach the bubble WebView immediately.
- [ ] Mobile-first layout: safe-area insets, `100dvh`, keyboard-aware composer
- [ ] Deploy to Vercel; confirm "Add to Home Screen" works on Android Chrome and iOS Safari

## Phase 2: Backend API, LLM streaming, auth and rate limits

Goal: real streamed answers from a free-tier LLM, with every request tied to an allowlisted Firebase user.

### Request flow

1. Client calls `getIdToken()` on the Firebase user and sends it as `Authorization: Bearer <token>`.
2. `POST /api/chat` verifies the token with `firebase-admin` (`verifyIdToken(token, true)` so revoked devices are rejected) and checks the user is allowed (claim or allowlist).
3. In **one transaction, before calling the LLM**: check and increment `usage/{uid}_{today}` against the per-user cap and `usage/global_{today}` against the global cap. Aborted or failed streams still count, and parallel requests can't overshoot.
4. Server writes the user message (from the request body, under the client's `userMessageId`), then loads the last N messages of the conversation (admin SDK), builds the prompt, and calls the LLM with streaming. Because the server wrote the user message itself, there's no race with a client write.
5. Response is streamed back as plain text chunks (`ReadableStream`, `Content-Type: text/plain; charset=utf-8`), which works in both browsers and the Android WebView without SSE quirks.
6. The server streams the reply and persists it in `after()` from `next/server`: the assistant message (under `assistantMessageId`), `updatedAt`, `messageCount` and token counts in one batch. Clients never write messages. **Stop button:** when the client disconnects (Stop, closed page, dropped connection) the model call is aborted and the partial reply is saved with a `_(stopped)_` note. The response carries `X-Messages-Left`; `GET /api/usage` returns it for the "N messages left today" hint.
7. **Photos:** the body may carry `image: { mediaType, data (base64, client-resized ≤1280 px), thumbnail (data URL ≤60 KB) }`. Only the thumbnail is stored (Firebase Storage needs Blaze); later turns get a "[photo attached earlier]" note instead of the image. Photo requests use only image-capable providers (Gemini), else 503.
8. **Documents:** the body may carry `file: { name, mediaType (pdf | docx | text/plain), data (base64, ≤3 MB) }` (one attachment per message: photo *or* file). The server extracts the text (`lib/chat/documents.ts`: `unpdf` for PDF, `mammoth` for Word, UTF-8 for text/code; capped at 60k chars). Gemini gets PDFs as the original file, and everything else (and Groq) gets the text. The message doc stores only `file: {name, mediaType, size}`; the text goes to `conversations/{id}/attachments/{msgId}` (server-read only in practice) and is re-sent with history for follow-ups (newest first, 60k-char budget). Scanned PDFs with no text need Gemini.

All API routes: `export const runtime = 'nodejs'` (firebase-admin does not run on Edge).

### LLM adapter (`lib/llm.ts`)

One interface, two implementations, chosen by env var:

```
export interface LlmProvider {
  stream(messages: ChatMessage[], opts: { system: string; maxTokens: number }): AsyncIterable<string>
}
```

- Default `gemini`: Google AI Studio API key; model ID from `LLM_MODEL` (a current free-tier Flash model; Pro models are no longer free). Never hard-code the model name.
- Fallback `groq`: Groq API key, model from `GROQ_MODEL` (a current Llama model). `LLM_PROVIDER=groq` forces it; otherwise the adapter **falls back to Groq automatically** when the primary returns 429/5xx before the first chunk.
- Free-tier Gemini prompts may be used by Google for training (except EU/UK/CH). Tell your users.
- Use the Vercel AI SDK (`ai`, `@ai-sdk/google`, `@ai-sdk/groq`) rather than hand-rolling fetch; it handles streaming and provider differences. If it adds friction, fall back to the provider's own SDK.

Set `maxDuration = 60` on the route. Vercel Hobby with Fluid Compute allows up to 300 s, but 60 s is a deliberate guard against a hung model.

### Limits (keep the free tiers safe)

| Limit | Value | Where enforced |
| --- | --- | --- |
| Requests per user per day | 25 (`DAILY_REQUEST_LIMIT`) | `usage/{uid}_{day}` transaction in `/api/chat` |
| Requests per day, all users | 200 (`GLOBAL_DAILY_REQUEST_LIMIT`), set below the Gemini free-tier RPD shown in AI Studio | `usage/global_{day}` in the same transaction |
| Max messages sent to the model | last 20 | prompt builder |
| Max input chars per message | 4,000 | zod schema |
| Max output tokens | 1,024 | LLM call |
| Allowed users | `allowlist` collection | token check |

### Backend tasks

- [ ] `lib/firebase/admin.ts`: init from base64 service account, singleton-safe for Vercel
- [ ] `lib/auth.ts`: `requireUser(req)` helper returning `{ uid, email }` or a 401
- [ ] `POST /api/chat` with zod-validated body `{ conversationId, message, userMessageId, assistantMessageId }`
- [ ] `DELETE /api/conversations/[id]` using admin `recursiveDelete` (clients can't delete subcollections; listing is done client-side via Firestore)
- [ ] `lib/llm.ts` with Gemini and Groq adapters and automatic fallback
- [ ] System prompt in `lib/prompt.ts`, short and editable
- [ ] `lib/usage.ts`: transactional per-user + global daily counters; friendly "limit reached" message in the UI
- [ ] Vitest unit tests for the prompt builder, usage logic and LLM fallback; Firestore rules tests with the emulator (non-allowlisted user denied, messages read-only for clients)
- [ ] Auto-title a conversation from the first user message (truncate, no extra LLM call)
- [ ] Replace the Phase 1 mock and verify streaming end-to-end on Vercel

## Phase 3: Overlay page and the JS bridge contract

Goal: a compact `/overlay` route that works inside a 320×480 WebView, and a fixed contract so the web and Android sides can be built independently.

### `/overlay` page

- No sidebar, no header beyond a 40 px bar with conversation title, "new chat" and "minimize" buttons.
- Always opens the most recent conversation; a "new chat" button starts another.
- Composer pinned to the bottom; messages scroll above it; auto-scroll on new chunks.
- Reads the auth token from the native side (below) instead of running the Google popup, which does not work in a plain WebView.
- Detect native context with `typeof window.Android !== 'undefined'`; render the browser version otherwise so the page is testable in Chrome.
- The WebView runs with a Service context, so **no `<select>`, `alert`/`confirm`/`prompt`, autofill-dependent inputs, or reliance on long-press text selection**: these can crash with `BadTokenException`. Use custom menus and the `copyToClipboard` bridge.
- Every link in rendered markdown opens via `Android.openInBrowser(url)`; the page never navigates the WebView off-domain. `react-markdown` without `rehype-raw`.

### Auth inside the WebView

Google sign-in popups fail in WebViews. Use this flow instead:

1. The user signs in once in Chrome (the PWA) and taps "Link bubble".
2. The web app calls `POST /api/device-token` (allowed users only, max ~5 per user per day), which mints a Firebase custom token (`admin.auth().createCustomToken(uid, { allowed: true })`) and offers it only as an "Open in Bubble app" button (deep link `bubble://link?token=...`, no copy button or copyable `<a href>`, so the link can't be passed on). Once the bubble signs in, `/overlay` calls `POST /api/device-linked` (custom-token sessions only), which sets `users/{uid}.bubbleSeenAt`; `/link` then shows "Bubble app already linked" instead of the Create link button. "Unlink all devices" clears it.
3. The Android app registers the `bubble://` scheme, stores the token in `Prefs`, **immediately** starts the service and loads `/overlay` in the WebView, which reads the token via `Android.getAuthToken()`.
4. `/overlay` calls `signInWithCustomToken(auth, token)` on load, then calls `Android.onLinked()` so the native side deletes the token from `Prefs`. Firebase then manages refresh normally and persists the session in the WebView's storage.

Custom tokens expire after 1 hour, which is why step 3 loads the WebView right away instead of on first bubble tap. After sign-in the SDK keeps its own refresh token. If the session is lost or the token expired, show a "Re-link in the app" message.

Security notes: any app can register `bubble://`, so a link could in theory be intercepted. That's acceptable for 10 friends given the 1-hour lifetime. The PWA settings page has **"Unlink all devices"**, which calls `POST /api/revoke` → `admin.auth().revokeRefreshTokens(uid)`.

### Bridge contract (`lib/bridge.ts` ↔ `JsBridge.kt`)

Native → exposed on `window.Android` via `@JavascriptInterface`:

| Method | Returns | Purpose |
| --- | --- | --- |
| `getAuthToken()` | string or "" | custom token saved at link time |
| `getClipboard()` | string | paste the last copied text into the composer |
| `copyToClipboard(text)` | void | copy an answer |
| `minimize()` | void | collapse panel to bubble |
| `openInBrowser(url)` | void | open the full PWA |
| `getAppVersion()` | string | show in settings, for update checks |
| `onLinked()` | void | web signed in with the custom token; native clears it from `Prefs` |
| `setAccount(account)` | void | signed-in email ("" = signed out); the app's Account section shows "Account linked" (optional: missing in older APKs) |
| `getCapabilities()` | JSON | `{photo, file, screen, voice, speech}`; the page only shows buttons that work (all missing in app 0.1) |
| `pickImage("camera"|"gallery")`, `pickFile()`, `captureScreen()`, `startVoiceInput()` | void | native opens the camera / photo picker / screen-capture consent / Google voice typing via the invisible `ActionActivity` (panel collapses meanwhile) |
| `takePending()` | JSON or "" | text from "Ask Bubble"/Share, voice result, photo (JPEG data URL), document (`{name, mimeType, dataUrl}`) or error waiting for the page; taken once |
| `speak(text)`, `stopSpeaking()` | void | read an answer aloud with Android TextToSpeech |

Native → web events: `window.dispatchEvent(new CustomEvent("bubble-native", { detail: { type } }))` with `type` `"pending"` (call `takePending()`) or `"tts-end"` (reading finished).

"Ask Bubble" (text-selection menu, `ACTION_PROCESS_TEXT`) and the Share sheet (`ACTION_SEND` text/image) go to `AskActivity`, which opens the bubble with the text/photo in the composer; nothing is sent until the user taps Send.

### Web tasks

- [ ] `app/overlay/page.tsx` + `app/overlay/layout.tsx` (no app chrome, `viewport-fit=cover`)
- [ ] `lib/bridge.ts` typed wrapper with no-op fallbacks when `window.Android` is missing
- [ ] `POST /api/device-token` (auth required, rate-limited, returns custom token, logs issuance)
- [ ] `POST /api/revoke` + "Unlink all devices" button in PWA settings
- [ ] "Link bubble" screen in the PWA with an "Open in Bubble app" button (no copy) and an "already linked" state
- [ ] "Paste from clipboard" button in the overlay composer
- [ ] Test `/overlay` in Chrome DevTools at 320×480 before touching Android

## Phase 4: Android overlay app (Kotlin)

Goal: a draggable bubble that floats over every app, expands into the `/overlay` WebView, and survives screen rotation and app switching. Target roughly 400–600 lines of Kotlin.

### Manifest

```xml
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.INTERNET" />

<service android:name=".OverlayService"
         android:foregroundServiceType="specialUse"
         android:exported="false">
  <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
            android:value="Floating chat assistant bubble the user can open over other apps" />
</service>
```

Add an intent filter on `MainActivity` for scheme `bubble`, host `link` (the auth deep link from Phase 3).

### MainActivity.kt

- On launch: if `!Settings.canDrawOverlays(this)`, show a short explanation and a button that fires `ACTION_MANAGE_OVERLAY_PERMISSION` with the package URI; re-check in `onResume`.
- On Android 13+ request `POST_NOTIFICATIONS` (needed for the foreground notification to be visible).
- Buttons: Start bubble, Stop bubble, Re-link account, Open web app. Show app version.
- Handle the `bubble://link?token=` intent: save token to `Prefs`, then start the service, which loads `/overlay` in the WebView immediately (the custom token expires in 1 hour).

### OverlayService.kt

- `startForeground()` immediately in `onCreate` with a low-importance notification ("Bubble is running", action: Stop).
- Create `BubbleView` and add it with `WindowManager.addView` using:
  - `type = TYPE_APPLICATION_OVERLAY`
  - `flags = FLAG_NOT_FOCUSABLE | FLAG_NOT_TOUCH_MODAL | FLAG_LAYOUT_IN_SCREEN`
  - `format = PixelFormat.TRANSLUCENT`, `gravity = TOP or START`, width/height `WRAP_CONTENT`
- Keep a single `WebView` instance alive for the service lifetime so chat state is not lost on collapse. Create it with the service context, not an Activity.
- On expand: remove the bubble view, add `ChatPanelView` with `FLAG_NOT_TOUCH_MODAL | FLAG_LAYOUT_IN_SCREEN` but without `FLAG_NOT_FOCUSABLE` so the soft keyboard can open. Set `softInputMode = SOFT_INPUT_ADJUST_RESIZE`, but don't rely on it: it's unreliable for non-fullscreen overlay windows and deprecated from targetSdk 35. Listen for IME insets (`WindowInsetsCompat.Type.ime()`) on the panel and shrink/move it yourself so the composer stays above the keyboard.
- On collapse (minimize button, back gesture, or tap outside via `FLAG_WATCH_OUTSIDE_TOUCH`): swap back to the bubble.
- Restore bubble position from `Prefs`; on `onConfigurationChanged` clamp it inside the new screen bounds.
- **Movable, resizable panel:** a grab bar on top moves it (double-tap resets), a corner grip at the bottom right resizes it (min 260 × 300 dp). The layout is saved in `Prefs.panelLayout` as screen fractions (survives rotation). The panel stays clear of the status bar and of the non-excludable pull-down / swipe-up-for-Home gesture zones (`mandatorySystemGestures`), which would otherwise steal drags. With the keyboard open it shrinks, and lifts if needed, using the screen-level IME inset (the panel's own inset is wrong when the keyboard covers it completely); it returns when the keyboard closes.
- Return `START_STICKY` so the system restarts the service if killed.

### BubbleView.kt

- 56 dp circle with the app icon, elevation shadow.
- `onTouch`: track down/move/up; move updates `layoutParams.x/y` and calls `updateViewLayout`; a move under 10 px and 200 ms counts as a tap → expand.
- On release, animate snap to the nearest horizontal edge (`ValueAnimator`).
- Optional: a dismiss zone at the bottom while dragging, which stops the service.

### ChatPanelView.kt

- `FrameLayout` sized to roughly 85% screen width and 60% height, rounded corners, positioned near the bubble's last side.
- Hosts the shared `WebView`: JavaScript enabled, DOM storage enabled, `WebViewClient` keeping navigation inside your domain, `WebChromeClient` for console logs during development.
- `webView.addJavascriptInterface(JsBridge(service), "Android")`.
- Load `BASE_URL + "/overlay"` once; reload only on a bridge error.

### JsBridge.kt

Implements the Phase 3 table exactly: `getAuthToken`, `getClipboard`, `copyToClipboard`, `minimize`, `openInBrowser`, `getAppVersion`, `onLinked`, `setAccount`. Clipboard access must run on the main thread; post to a `Handler`. `minimize` posts to the service. Android 10+ only lets the focused app read the clipboard: verify on a device that the focused overlay panel qualifies; if not, `getClipboard` returns "" and users paste via the keyboard's clipboard bar.

### Android tasks

- [ ] Project: Kotlin, minSdk 26, targetSdk 35 (fine for sideloading; bump to 36 when convenient), view binding, no Compose (keeps WindowManager code simple)
- [ ] Milestone A: permission flow + foreground service + static bubble visible over the launcher
- [ ] Milestone B: drag, snap to edge, tap to expand into a panel containing a plain `EditText`, tap outside to collapse. **Keyboard spike here:** the IME opens and the panel resizes via insets. This is the riskiest part, so prove it before adding the WebView.
- [ ] Milestone C: WebView loads `/overlay` from Vercel; keyboard behaviour from B still holds with the WebView
- [ ] Milestone D: deep-link auth, JS bridge, clipboard paste
- [ ] Milestone E: boot receiver (`RECEIVE_BOOT_COMPLETED`) that restarts the service if it was running, and a "disable battery optimization" prompt for aggressive OEMs

## Phase 5: Build, sign, distribute and deploy

Goal: a signed APK your friends can install from a link, and the web app live on Vercel, all at $0.

### Web deploy

- Connect the repo to Vercel with root directory `web/`; add all env vars in the Vercel dashboard.
- Add the Vercel domain to Firebase Auth authorized domains.
- Deploy `firestore.rules` with `firebase deploy --only firestore:rules` from `web/`.

### APK

1. Generate a keystore once (`keytool -genkeypair`), keep it outside the repo, back it up. Losing it means users must uninstall to update.
2. Put the signing config in `android/keystore.properties` (gitignored) and reference it from `app/build.gradle.kts`.
3. Build with `./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk`.
4. Set `BASE_URL` as a `buildConfigField` so debug builds can point at `http://10.0.2.2:3000` (emulator → local Next.js) and release at Vercel.
5. Upload the APK as a GitHub Release asset; share the link. Users enable "Install unknown apps" for their browser once.
6. **Android developer verification:** since 30 Sep 2026, certified devices in Brazil, Indonesia, Singapore and Thailand block sideloaded apps from unverified developers, with global rollout in 2027. If any user is affected, register in the Android Developer Console (check the free hobbyist / limited-distribution track) and register the app's package name and signing key. Installing over `adb install` is exempt as a fallback.

### Updates

- Bump `versionCode` and `versionName` for every release.
- `MainActivity` fetches `https://<your-app>/api/android-version` (returns `{ versionCode, apkUrl }`) and shows an "Update available" banner when newer. No store needed.
- Most feature work ships through the web app with no APK rebuild.

## Environment variables and free-tier checklist

### `web/.env.example`

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
FIREBASE_SERVICE_ACCOUNT_BASE64=      # base64 of the service-account JSON
LLM_PROVIDER=gemini                   # gemini | groq (gemini auto-falls back to groq on 429)
LLM_MODEL=                            # current free-tier Gemini Flash model ID
GROQ_MODEL=                           # current Groq Llama model ID
GOOGLE_GENERATIVE_AI_API_KEY=
GROQ_API_KEY=
DAILY_REQUEST_LIMIT=25                # per user
GLOBAL_DAILY_REQUEST_LIMIT=200        # all users; keep below Gemini free-tier RPD
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

### Accounts to create (all free)

| Service | Plan | Used for | Watch out for |
| --- | --- | --- | --- |
| Firebase | Spark | Auth + Firestore | Do not enable Blaze; stay under 50k reads / 20k writes per day |
| Vercel | Hobby | Next.js hosting | Non-commercial use only; 300 s function limit (we cap at 60 s) |
| Google AI Studio | Free | Gemini API | Per-minute and per-day caps were cut during 2026 (reports range 100 to 1,500 RPD for Flash; Pro not free). Read your project's real limits in AI Studio and set `GLOBAL_DAILY_REQUEST_LIMIT` below them |
| Groq | Free | Fallback LLM | Lower daily token quota |
| GitHub | Free | Repo + APK releases | Keep the keystore and service account out of git |

Free-tier numbers change often; confirm the current limits on each provider's pricing page before relying on them.

## Acceptance criteria and known gotchas

### Done means

- [ ] A non-allowlisted Google account cannot read Firestore or get a reply from `/api/chat`
- [ ] Streaming answers appear token by token in Chrome, in the installed PWA, and in the bubble WebView
- [ ] History survives reload and is identical in the PWA and the bubble
- [ ] Bubble stays visible while using another app, after rotating, and after the app is swiped from recents
- [ ] Keyboard opens inside the expanded panel and the composer stays visible above it
- [ ] Tapping outside the panel collapses it; the conversation is still there on re-expand
- [ ] Release APK installs on a second phone from the GitHub link and links the account via `bubble://`
- [ ] Daily limit message shows at request `DAILY_REQUEST_LIMIT + 1` (and for everyone once the global cap is hit)
- [ ] "Unlink all devices" signs the bubble out (next `/api/chat` call returns 401 → "Re-link" message)

### Gotchas Claude Code should know up front

- `SYSTEM_ALERT_WINDOW` cannot be requested with a normal runtime dialog; it is a Settings screen the user must toggle.
- A WebView created from a Service context works, but `window.open`, file pickers and Google sign-in popups do not. Hence the custom-token link flow.
- Overlay keyboard handling is the hardest part: the panel must drop `FLAG_NOT_FOCUSABLE` while expanded and re-add it when collapsed, or touches leak to the app beneath.
- `FLAG_WATCH_OUTSIDE_TOUCH` only delivers `ACTION_OUTSIDE` with no coordinates; treat it purely as "collapse".
- Android 14+ kills foreground services without a declared type; `specialUse` with the manifest property is required.
- Xiaomi/Huawei/Oppo need "Display pop-up windows while running in the background" and autostart permissions; add a help screen listing them rather than trying to detect each OEM.
- `firebase-admin` must be imported only in server files; Next.js will try to bundle it client-side otherwise. Keep `lib/firebase/admin.ts` with `import 'server-only'`.
- Vercel Hobby functions can run up to 300 s (Fluid Compute), but we set `maxDuration = 60` and cap output tokens so a slow model fails fast.
- API routes using `firebase-admin` must declare `export const runtime = 'nodejs'`; it does not run on the Edge runtime.
- Next.js 16 builds with Turbopack by default: use `@serwist/turbopack`, not the webpack-based `@serwist/next` (or pass `--webpack` to build).
- Clients never write messages. The server writes both the user and assistant messages, which avoids a read-before-write race and keeps the rules simple.
- The bubble WebView has a Service context: avoid `<select>`, JS dialogs and long-press selection in `/overlay`.
- A stale service worker would stop web fixes reaching the bubble: navigations are network-first and `/api/*` is never cached.
- iOS has no overlay API; iPhone users get the PWA only.

### Suggested first prompt for Claude Code

"Read CLAUDE.md. Scaffold the monorepo in the Repo structure section, then implement Phase 1 web tasks in order, committing after each checkbox. Use mocked chat replies. Stop and show me the running app before starting Phase 2."
