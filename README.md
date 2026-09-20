# ANGELO

ANGELO is a quiet, monochrome habit tracker built with React, TypeScript, and Vite. It works fully as a guest, with the routine stored on the device. An optional account adds cloud sync, a unique username, and a public profile that other people can find from the social button.

Registered profiles are public by default. The public view contains the username, routine title, habit names, and aggregate consistency for the selected month; passwords, sessions, and individual check-in dates are never returned by a public endpoint. A signed-in user can make the profile private.

## Project layout

- `src/` — the static React frontend, ready for GitHub Pages.
- `backend/` — the Fastify API, ready for a Cloud Run source deployment.
- Firestore — durable production storage for users, tracker state, and revocable sessions.
- In-memory storage — the default backend mode for local development and automated tests only.

Cloud Run's local filesystem is not used for application data. The frontend and backend are deliberately separate deployments and communicate through `VITE_API_BASE_URL`.

## Local development

Node.js 22.18 or newer is required.

```sh
npm ci
npm ci --prefix backend
```

The checked-in examples contain all local defaults. If you create local env files, copy `.env.example` to `.env` and `backend/.env.example` to `backend/.env` first. Env files are ignored by Git.

Start the API and frontend in separate terminals:

```sh
npm run dev:backend
```

```sh
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). The local API runs at `http://localhost:8080` and uses an in-memory store, so local accounts disappear whenever that API process restarts. Guest routines continue to use browser storage and do not depend on the API.

### Local Firestore instead of memory

Set `DATA_STORE=firestore`, set `GOOGLE_CLOUD_PROJECT`, and use either the Firestore emulator or Application Default Credentials. For ADC-based development:

```sh
gcloud auth application-default login
npm run dev:backend
```

Do not create or commit a service-account key. Cloud Run uses its attached service identity in production.

## Checks

```sh
npm run check
```

The individual commands are also available:

```sh
npm run lint
npm test
npm run typecheck
npm run build
```

Backend tests use the in-memory adapter and do not require GCP.

## Configuration

Frontend:

- `VITE_API_BASE_URL` — public Cloud Run service URL, without a trailing slash. Defaults to `http://localhost:8080` during local development.

Backend:

- `NODE_ENV` — use `production` on Cloud Run.
- `DATA_STORE` — `memory` locally or `firestore` in production. Production refuses to start with the memory store.
- `ALLOWED_ORIGINS` — comma-separated exact origins. For a GitHub project page this is `https://OWNER.github.io`, without the repository path.
- `GOOGLE_CLOUD_PROJECT` — normally supplied by Cloud Run automatically.
- `FIRESTORE_DATABASE_ID` — optional; defaults to Firestore's `(default)` database.
- `PORT` — supplied by Cloud Run; defaults to `8080` locally.

See `backend/.env.example` and `backend/README.md` for the complete API configuration and endpoint contract.

## Deploy the backend to Cloud Run

These commands prepare a small, scale-to-zero deployment. Replace the uppercase placeholders and choose one region for both Firestore and Cloud Run.

```sh
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com
gcloud firestore databases create --location=YOUR_REGION --type=firestore-native
gcloud iam service-accounts create angelo-api --display-name="ANGELO API"
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID --member="serviceAccount:angelo-api@YOUR_PROJECT_ID.iam.gserviceaccount.com" --role="roles/datastore.user"
```

Skip the database creation command if the project already has the `(default)` Firestore database. Then deploy the self-contained backend directory:

```sh
gcloud run deploy angelo-api --source=backend --region=YOUR_REGION --allow-unauthenticated --service-account=angelo-api@YOUR_PROJECT_ID.iam.gserviceaccount.com --memory=512Mi --concurrency=20 --max-instances=3 --set-env-vars="NODE_ENV=production,DATA_STORE=firestore,ALLOWED_ORIGINS=https://OWNER.github.io"
```

The Cloud Run service must allow unauthenticated HTTP access because signup, login, health, search, and public profiles are public API routes. Private tracker and account routes still require the app's bearer session. After deployment, verify `https://YOUR_SERVICE_URL/healthz`.

If the backend ships a Firestore index definition, apply it before enabling profile search in production as described in `backend/README.md`.

## Deploy the frontend to GitHub Pages

1. In the GitHub repository, create an Actions variable named `VITE_API_BASE_URL` containing the Cloud Run URL.
2. In **Settings → Pages**, choose **GitHub Actions** as the source.
3. Push to `main`, or run the **Deploy frontend to GitHub Pages** workflow manually.
4. Add `https://OWNER.github.io` to the backend's `ALLOWED_ORIGINS` value. The repository path is not part of an origin.

The Vite build uses relative asset URLs, so it works at both `OWNER.github.io/REPOSITORY/` and a custom domain. No client-side history routes are required.

## Account behavior and security

- Usernames are case-insensitively unique, 3–24 characters, and limited to letters, numbers, and underscores.
- Passwords are hashed with salted `scrypt`. The API stores only a SHA-256 hash of each random session token, and sessions expire after 30 days.
- The browser holds the opaque bearer token so authentication works reliably across the GitHub Pages and Cloud Run domains. CORS accepts only configured origins.
- Signup imports the current guest routine but clears the built-in sample completions before publishing it. Login always loads the account's server state; it never overwrites an existing account with unrelated guest data.
- Guest and account caches use separate browser-storage keys. Logging out restores the guest routine.
- Tracker and settings changes save locally as they happen and are debounced to the API for signed-in users. A sync failure does not stop the local tracker from working.
- There is intentionally no email collection or password-recovery flow in this small username-only system. Losing the password means the account cannot currently be recovered.

Rate limiting is per API instance, which is appropriate for the expected small deployment but is not a replacement for a managed edge/WAF if traffic grows substantially.

## The daily practice

- Each concentric ring is a habit; each cell is a calendar day.
- Today and earlier days can be checked off. Future dates remain locked based on the device's local calendar.
- Gray zig-zag cells mark dates before the tracker or that habit began. They cannot be checked off and are excluded from consistency.
- Monthly consistency is completed check-ins divided by eligible check-ins in the displayed month. Eligible future days remain in the denominator, while pre-start days do not.
- Habits use effective-dated monthly plans: changing September leaves August intact and applies from September forward until another month has its own plan. A habit first added during the current month begins on that day.
- Settings open on the current month, can switch through tracked months, support up to nine habits per monthly plan, and save every valid change automatically.
- The first guest visit includes starter habits and clearly labeled sample progress.
- Keyboard navigation, focus management, reduced motion, and touch input are supported.
