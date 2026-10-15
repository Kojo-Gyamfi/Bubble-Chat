# Bubble Chat

A private chatbot for ~10 allowlisted friends: a Next.js PWA (`web/`) plus an
Android app (`android/`, Phase 4) that floats it over other apps as a bubble.
See [CLAUDE.md](CLAUDE.md) for the full plan.

## Status

- [x] Phase 1: PWA with Google login, live history, mocked streaming replies
- [x] Phase 2: real LLM (Gemini → Groq fallback), usage limits, delete
- [x] Phase 3: `/overlay` page + JS bridge, bubble linking
- [ ] Phase 4: Android bubble app
- [ ] Phase 5: signing, distribution, deploy

## One-time Firebase setup (free Spark plan, never upgrade to Blaze)

1. [Firebase console](https://console.firebase.google.com) → **Add project**.
2. **Authentication** → Get started → Sign-in method → enable **Google** only.
   `localhost` is already an authorized domain; add your Vercel domain later.
3. **Firestore Database** → Create database → **production mode** → pick a region.
4. **Project settings → General → Your apps → Web (`</>`)** → register an app and
   copy `apiKey`, `authDomain`, `projectId`, `appId`.
5. **Project settings → Service accounts → Generate new private key**. Keep the
   JSON *outside* this repo and base64 it:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\service-account.json"))
   ```
6. `copy web\.env.example web\.env.local` and fill in the Firebase values and
   `FIREBASE_SERVICE_ACCOUNT_BASE64`.
7. Deploy the security rules and allowlist yourself:
   ```powershell
   cd web
   firebase login
   firebase use --add            # pick your project
   firebase deploy --only firestore:rules
   npm run allow -- add you@gmail.com
   ```

## AI provider keys (free)

- **Gemini** (default): create a key at [Google AI Studio](https://aistudio.google.com/apikey) →
  `GOOGLE_GENERATIVE_AI_API_KEY`. Check your real free-tier requests/day there and set
  `GLOBAL_DAILY_REQUEST_LIMIT` below it.
- **Groq** (automatic fallback when Gemini is rate-limited or down): key from
  [console.groq.com](https://console.groq.com/keys) → `GROQ_API_KEY`.
- No keys yet? `LLM_PROVIDER=mock` streams canned replies.

Limits reset at 00:00 UTC. Counters live in Firestore `usage/{uid}_{YYYY-MM-DD}` and
`usage/global_{YYYY-MM-DD}`.

## Run locally

```powershell
cd web
npm install
npm run dev        # http://localhost:3000
```

Tests: `npm test` (unit) and `npm run test:rules` (Firestore rules, starts the emulator; needs Java).

Allowlist management: `npm run allow -- add|remove|list [email]`. Removing a
user also revokes all their sessions.

## Bubble linking (Phase 3)

- `/overlay` is the compact chat the Android app loads in its WebView. In Chrome it uses
  your normal session, so you can test it with DevTools device mode at 320×480.
- **Link bubble app** (sidebar → `/link`) creates a one-hour `bubble://link?token=…` link
  (5 per user per day). The app passes the token to `/overlay`, which signs in with it.
- **Unlink all devices** on the same page revokes every session of the account.
- The JS bridge contract lives in `web/lib/bridge.ts` and must match `JsBridge.kt`.

## Local development with emulators

To try things without touching the real Firebase project, start the emulators and set the
variables listed at the bottom of `web/.env.example`. Sign in through `/overlay` with a
token from `/api/device-token`, or create users in the Auth emulator.

## Deploying (Vercel Hobby)

- Import the repo with **root directory `web/`**; add every `.env.local` key.
- Set `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` to your Vercel domain (the app
  proxies `/__/auth/*` to Firebase, which fixes sign-in in iOS home-screen apps),
  then in Google Cloud Console → APIs & Services → Credentials → the "Web client
  (auto created by Google Service)" add
  `https://<your-app>.vercel.app/__/auth/handler` as an authorized redirect URI.
- Add the Vercel domain to Firebase Auth → Settings → Authorized domains.
