# ANGELO API

Small, stateless Node.js API for ANGELO accounts, cloud-saved trackers, and public profile search. It runs on Cloud Run and uses Firestore in production. Guest use remains entirely in the frontend; the API is only needed for accounts and public profiles.

## Requirements

- Node.js 22+
- A Firestore Native Mode database for production
- Application Default Credentials (ADC) with Firestore access

## Local development

```sh
cd backend
npm ci
npm run dev
```

Development defaults to the in-memory store and the two localhost Vite origins, so no environment setup is required. To override the defaults, copy `.env.example` to `.env`; the development command loads that file when present. `DATA_STORE=memory` needs no Google credentials, starts empty, and intentionally loses all data on restart.

Verification:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | Production | Set to `production` on Cloud Run. |
| `PORT` | No | HTTP port; defaults to `8080`. Cloud Run supplies this. |
| `DATA_STORE` | Production | `firestore` in production; `memory` for local development/tests. The server refuses a production memory store. |
| `ALLOWED_ORIGINS` | Production | Comma-separated exact origins, such as `https://owner.github.io`. Paths and `*` are rejected. |
| `LOG_LEVEL` | No | Structured log level; defaults to `info`. |
| `GOOGLE_CLOUD_PROJECT` | Usually automatic | GCP project used by Firestore. Cloud Run normally provides it. |
| `FIRESTORE_DATABASE_ID` | No | Named Firestore database; defaults to `(default)`. |

The production service uses ADC. Do not package or set a service-account JSON key.

## API

Authenticated routes use `Authorization: Bearer <token>`. Tokens are 32 random bytes encoded with base64url, last 30 days, and are returned only by signup/login. Only their SHA-256 hashes are stored. Passwords are hashed with `scrypt` and a fresh per-user salt.

- `GET /healthz`
- `POST /v1/auth/signup` — `{username,password,tracker}`
- `POST /v1/auth/login` — `{username,password}`
- `GET /v1/auth/me`
- `POST /v1/auth/logout`
- `PUT /v1/me/tracker` — `{tracker}`
- `PATCH /v1/me/profile` — `{isPublic}`
- `GET /v1/profiles?query=<username-prefix>`
- `GET /v1/profiles/:username?month=YYYY-MM`

Errors have the stable shape `{ "error": { "code": "...", "message": "..." } }`. Login always uses the same `INVALID_CREDENTIALS` response for unknown users, malformed usernames, and wrong passwords.

Usernames are normalized to lowercase and must contain 3–24 ASCII letters, numbers, or underscores. Reserved route/system names cannot be registered. Passwords contain 8–128 Unicode code points. Profiles are public on signup and may subsequently be made private.

Tracker responses use the version-2 model:

```json
{
  "version": 2,
  "title": "Keep Going",
  "startedOn": "2026-09-20",
  "habitPlans": {
    "2026-09": [
      { "id": "move", "name": "Move", "startedOn": "2026-09-20" }
    ],
    "2026-10": [
      { "id": "move", "name": "Morning walk", "startedOn": "2026-09-20" }
    ]
  },
  "completions": { "2026-09-20": ["move"] },
  "isDemo": false
}
```

`habitPlans` contains change-point snapshots. A month uses the most recent plan at or before that month; months before `startedOn` have no habits. A baseline plan is required in the start month, and an explicit empty plan pauses the routine. Each plan may contain at most nine habits. Reusing an ID preserves its original `startedOn`, while its display name may change in a later plan.

Completion IDs must be active in the plan resolved for their date and cannot precede the tracker or habit start date. Monthly consistency still includes future eligible days, but excludes days before those start dates. Legacy version-1 payloads remain accepted and are returned as canonical V2 using a `0000-01-01` sentinel baseline, preserving their previous full-month statistics. Demo signup clears sample completions, starts the tracker on the current UTC date, and materializes only the currently effective plan. If a demo's declared start is ahead of UTC at a client-local month boundary, the required baseline plan is preserved instead of being replaced with an empty routine.

V2 histories may contain at most 1,200 monthly plan snapshots and 45,000 completion-date entries; larger histories are rejected with `INVALID_TRACKER`. Requests are capped at 800 KiB and the canonical serialized tracker is capped at 704 KiB. The small allowance above the former 700 KiB V1 cap covers sentinel migration metadata while remaining safely below Firestore's 1 MiB document limit.

## Firestore setup

The service stores user documents under `users/{normalizedUsername}` and session documents under `sessions/{sha256Token}`. Each user also has a small top-level `searchSummary` containing only the title and latest plan's habit count. Browser access is not used. Deploy the included deny-all rules, public-search composite index, and the single-field index exemptions for password material, search summary, and the unqueried tracker map from this directory. The tracker exemption is important: a long but valid completion history must not hit Firestore's per-document index-entry limit.

Public search uses a Firestore field mask and reads only username, `searchSummary`, and the update timestamp. A narrow legacy fallback reads only V1 title/habits. It never loads password fields, V2 habit-plan history, or the potentially large completion map.

```sh
firebase deploy --only firestore --config firebase.json --project YOUR_PROJECT_ID
```

Grant the Cloud Run runtime service account `roles/datastore.user`. The Admin SDK bypasses Firestore security rules through IAM. Enable a Firestore TTL policy on the `sessions.expiresAt` field to clean up expired session documents; the API also rejects and deletes an expired session whenever it is presented.

## Cloud Run

Build locally if desired:

```sh
docker build -t angelo-api .
docker run --rm -p 8080:8080 -e NODE_ENV=development -e DATA_STORE=memory angelo-api
```

From the `backend` directory, a typical production deployment is:

```sh
gcloud run deploy angelo-api \
  --source . \
  --region YOUR_REGION \
  --allow-unauthenticated \
  --service-account angelo-api@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars NODE_ENV=production,DATA_STORE=firestore,ALLOWED_ORIGINS=https://OWNER.github.io \
  --min-instances 0 \
  --max-instances 5 \
  --concurrency 40
```

The service must be publicly reachable because search and public-profile endpoints are guest-accessible. Private endpoints are protected by application bearer sessions. Cloud Run terminates TLS; the process listens on `0.0.0.0:$PORT` and drains on `SIGTERM`.

Use a dedicated runtime service account, keep Firestore and Cloud Run in nearby compatible regions, and change the GitHub Pages frontend's API base URL to the resulting HTTPS service URL. The Firebase index can take several minutes to finish building before prefix search becomes available.
