# Bubble Chat

A private chatbot for ~10 allowlisted friends: a Next.js PWA (`web/`) plus an
Android app (`android/`, Phase 4) that floats it over other apps as a bubble.
See [CLAUDE.md](CLAUDE.md) for the full plan.

## Status

- [x] Phase 1: PWA with Google login, live history, mocked streaming replies
- [ ] Phase 2: real LLM (Gemini → Groq fallback), usage limits
- [ ] Phase 3: `/overlay` page + JS bridge
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
   `FIREBASE_SERVICE_ACCOUNT_BASE64`. (LLM keys aren't needed until Phase 2.)
7. Deploy the security rules and allowlist yourself:
   ```powershell
   cd web
   firebase login
   firebase use --add            # pick your project
   firebase deploy --only firestore:rules
   npm run allow -- add you@gmail.com
   ```

## Run locally

```powershell
cd web
npm install
npm run dev        # http://localhost:3000
```

Allowlist management: `npm run allow -- add|remove|list [email]`. Removing a
user also revokes all their sessions.

## Deploying (Vercel Hobby)

- Import the repo with **root directory `web/`**; add every `.env.local` key.
- Set `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` to your Vercel domain (the app
  proxies `/__/auth/*` to Firebase, which fixes sign-in in iOS home-screen apps),
  then in Google Cloud Console → APIs & Services → Credentials → the "Web client
  (auto created by Google Service)" add
  `https://<your-app>.vercel.app/__/auth/handler` as an authorized redirect URI.
- Add the Vercel domain to Firebase Auth → Settings → Authorized domains.
