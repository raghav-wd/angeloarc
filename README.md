# ANGELO

ANGELO is a quiet, monochrome habit tracker built with React, TypeScript, and Vite, with an optional strawberry theme for a softer, pinker look and a dark, blood-red Dismantle theme. It works fully as a guest, with the routine stored on the device. An optional account adds cloud sync, a unique username, and a public profile that other people can find and follow from the people drawer.

Registered profiles are public by default. The public view shares the circular routine layout, habit plans, and check-in history so another person can browse the same monthly practice view. Passwords, sessions, reminder text, daily notes, and notes to self remain private. A signed-in user can make the profile private.

## Project layout

- `src/` — the static React frontend, ready for GitHub Pages.
- `backend/` — the Fastify API, ready for a Cloud Run source deployment.
- Firestore — durable production storage for users, tracker state, private notes, and revocable sessions.
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

The Cloud Run service must allow unauthenticated HTTP access because signup, login, health, search, and public profiles are public API routes. Private tracker and account routes still require the app's bearer session. After deployment, verify `https://YOUR_SERVICE_URL/health`.

### Automatic backend deployment

`.github/workflows/deploy-backend.yml` deploys backend changes pushed to `main`. It uses GitHub OIDC with Google Workload Identity Federation, so there is no long-lived service-account JSON key to store in GitHub. The checked-in defaults target the `angeloarc` project, its existing `angelo-api` runtime service account, the project's Compute Engine default account for source builds, and `asia-south2`. Those non-secret identifiers can be overridden with repository variables named `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_SERVICE_ACCOUNT`, `GCP_BUILD_SERVICE_ACCOUNT`, `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`, and `ALLOWED_ORIGINS`.

The Google Cloud project must contain the matching Workload Identity provider and `github-deployer` service account. The provider is restricted to this repository's `main` branch. The deployer needs `roles/run.sourceDeveloper` and `roles/serviceusage.serviceUsageConsumer` on the project plus `roles/iam.serviceAccountUser` on both the runtime and build service accounts. The build account needs `roles/run.builder` on the project. The workflow names that build account explicitly instead of depending on Cloud Build's evolving default-account selection. It deliberately does not accept a `credentials_json` input; Google authentication requires exactly one mode, and keyless federation is the configured mode.

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
- Signup imports the current guest routine and private notes, but clears the built-in sample completions before publishing the routine. Login always loads the account's server state; it never overwrites an existing account with unrelated guest data.
- Guest data stays in browser storage. Creating an account transfers the guest notes into its private cloud record and clears that guest note copy; later guest notes remain device-only. Signed-in notes never use an account-scoped browser copy.
- Tracker and settings changes save locally as they happen and are debounced to the API for signed-in users. A sync failure does not stop the local tracker from working.
- Signed-in daily notes and notes to self are debounced to the private API and restored on another device. When an older account creates its cloud-notes record for the first time, its account-scoped browser notes are uploaded; stale device copies are then removed.
- The top-right account control is reserved for sign-in, profile visibility, follower totals, and sign-out. The center-right people control opens a compact drawer that defaults to followed profiles and also searches public usernames.
- Selecting a public profile replaces the current circle through the same clockwise out/in animation. Public circles are read-only; use **My practice** to animate back to the signed-in or guest routine.
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
- The **Today is a good day** note opens today's tasks where it sits: every habit for the day as a plain list on the page, no card around it. Over the list the cursor turns into a pencil. Checking a task folds its box into a tick while the pencil scribbles the name out with a hand-drawn zig-zag and then glides back to the pointer. Over a task already crossed out, the pencil turns into an eraser: clicking rubs the scribble away, crumbs and all, and the tick unfolds back into a box. From the keyboard, or on a touch screen, the zig-zag draws and rubs itself out. Changes show on the wheel straight away.
- While the list is open, clicking a date on the wheel moves the list to that day: a ring travels round the wheel to the date, and the tasks take on that day in a wave down the list (or up it, going back in time). Future days are locked, and habits that had not started yet are dashed out.
- Clicking anywhere else, or pressing Escape, puts the list away and brings the note back. Up and down arrow keys move between tasks.
- Keyboard navigation, focus management, reduced motion, and touch input are supported.

## Notes to self

- The center-left crumpled-paper control opens a page for principles, goals, quotes, and other short notes. Crumpled paper balls fall onto the homepage, it comes apart where they land, and the balls settle at the center of the grid in simple shapes: one in the middle, three in a triangle, and so on. Each ball is captioned with its note's title.
- Clicking a ball unfolds it into a flat sheet of about 70% of the screen for reading and writing. Closing it crumples the sheet back into its spot, and **Throw away** deletes the note after a second click to confirm.
- Pressing and holding a ball picks it up: the cursor morphs into a grabbing hand and a waste-paper bin appears at the right edge. Flicking the ball toward the bin, or letting go over it, bounces it once on the page and drops it in; the note is thrown away, with **Undo** on the bin for a few seconds, which lifts the ball back out to its old spot. Holding a ball over another one morphs the cursor into swap arrows, and letting go there makes the two trade places; the new order is saved. Let go anywhere else and the ball falls back into its spot.
- The kinds of note are listed down the left (a row of chips on phones) with how many of each are kept. Choosing a kind rolls every other note off the screen together while that kind gathers into its own formation; **All**, the default on every visit, brings them back. A new note starts as the kind being shown.
- From the keyboard, Delete throws the focused note into the bin, Alt with an arrow key swaps it with its neighbor, and Escape puts a held ball back. On touch screens, picking up, swapping, and throwing come with short vibrations where the browser supports them.
- Leaving the page rolls every ball off screen before the homepage, settings, account, or people view takes over. **My practice**, the paper-ball control, the ANGELO mark, and Escape all lead back to the homepage.
- Up to 12 notes are kept, with titles up to 48 characters and text up to 800 characters. A first visit starts with three example notes.
- For guests, daily notes and notes to self stay on this device. Creating an account moves those guest notes into the account's private cloud record and clears the guest copy after signup succeeds. Signed-in notes follow the account across devices and are never shared on a public profile.

## Welcome guide

- A browser that has never used ANGELO opens on a full-screen, three-page guide drawn like a sketchbook: hand-drawn doodles that draw themselves on, a dot-grid paper sheet, and Anri, the mascot, as paper stickers whose expression changes with the story.
- **Why bother** asks about inconsistency and motivation and suggests trying Angelo Arc for a week. **How it works** shows the two blocks: a sticky note listing daily actions that align with goals, and a one-week arc where those actions are tracked. Ticking the demo actions fills today's cells and celebrates when the list is done. **Your first week** closes with the quote "Once you learn to quit, it becomes a habit." and **Continue to app**.
- Poking Anri makes her hop and say something. Pages turn with **Next**/**Back**, the step dots, the arrow keys, or a sideways swipe on touch screens. **Skip intro** or Escape leaves at any time, without closing anything open underneath.
- Leaving folds the guide into a small, quiet Anri control in the bottom-right corner, and that control replays the guide at any time. Hovering it shows a hint with Anri peeking over it.
- The guide is shown once. Finishing or skipping it is remembered on the device, and a guide closed halfway comes back on the next visit. Anyone who used the app before the guide existed is not greeted again; the corner control still opens it.
- The guide's code, Anri's poses, and the handwriting font load only when it opens, and every page's final state is shown at once when the system asks for reduced motion.

## Themes

- **Make it yours** (the settings control) opens with **Your theme**: one swatch per theme, each a tiny version of the wheel drawn in its own colours. Picking one changes the whole app at once; where the browser supports view transitions, the new look spreads out in a circle from the swatch (Dismantle instead cuts the old look open along a glowing line). Arrow keys move between the swatches like any radio group.
- **Monochrome** is the default and is unchanged: ink on paper.
- **Strawberry** is blush pink with a cute, soft-girl-grind voice and small strawberry details:
  - The usual grid stays, drawn in pink, with a tiny berry or heart pinned to it here and there.
  - Kept promises become ripe berry flesh with a few seeds in tiny dimples. The flesh deepens from the middle of the wheel outwards, like a halved strawberry, and one continuous fill means a streak of kept days reads as one berry.
  - Pink words are glossy berry syrup that slowly flows through the letters: the title's last word, the consistency score (crowned with a blossom that twirls whenever the score moves), and the other emphasised words.
  - The page speaks in the theme's voice: the stock title reads **Soft Girl Grind** (a title someone wrote is never changed, and other people's titles always show as written), and the eyebrow, notes around the wheel, legend, footer, month caption and notes heading get softer lines such as "Berry serious about showing up."
  - A few faint bits of stationery sit around the page on larger screens — a pink ruler, two gel pens, a strip of washi tape holding the day note — with Anri in a pink jumper writing in her planner.
  - Keeping a promise, on the wheel or in today's list, sends out a small shower of seeds, petals, hearts and sparkles.
  - Day notes are blush ruled paper held by a strawberry pin; notes to self are crumpled pink paper with a pink bin; tooltips, panels, the cursor, the flash reminder and the people drawer follow the palette.
- **Dismantle** is a dark theme after the King of Curses' cutting technique, black with blood-red highlights and a domination-and-grind voice:
  - The page is black, ruled with a dark blood-red grid. A few faint old cuts across it catch the light now and then, a fresh one is made every so often, and a shrine stands under a blood moon on the empty side of the page.
  - Anri appears only on the settings and account pages, in front of the shrine with her hands in a domain-expansion sign. The Sukuna-style markings on her face, under her eyes and on her forehead, flare red as she arrives and then keep breathing faintly.
  - Kept promises are fresh blood, darkening towards the rim of the wheel and crossed by faint old cuts. The score is blood with a blade's glint running over it, crowned with two fresh cuts that flinch whenever it moves.
  - When the wheel sweeps away it is actually cut to pieces. Blades streak round the rings from the top, and each tile one passes through splits along that line, with a white hairline that opens into a red seam. The piece above the cut slips down along it, and the pieces fall away. Coming back, the tiles mend into place.
  - The page speaks in the theme's voice. The stock title reads **Malevolent Grind** (as with Strawberry, a title someone wrote is never changed). The habits are **Cursed techniques**, the score is **Dominance**, kept cells are **Dismantled**, and notes to self are **Binding vows**.
  - Keeping a promise sends two quick crossing cuts and a spray of blood. In today's list a kept task is slashed rather than scribbled: a long cut rises through the name, short ones cross it, and a name on one line falls apart into two halves along the cut.
  - Notes to self drop in as fireballs that flare and throw sparks when they land. The homepage burns away underneath them like paper: ragged holes with a scorched brown edge, a black char line and a glowing ember rim, creeping outwards until the whole page goes up.
  - Day notes are dark talismans pinned with a drop of blood. The unfolded note is bone paper with red rules, and panels, tooltips, the cursor, the flash reminder and the people drawer all follow the palette.
- The choice is a preference for this browser, stored under `angelo-theme-v1` only once someone picks a theme, so it never makes a first-time visitor look like a returning one. It is not synced to an account and is never shown on a public profile: everyone sees other people's circles in their own theme. Other open tabs follow a change straight away, and the theme is applied before the app first paints.
- Reduced motion switches themes instantly and leaves out the bursts, the twirl, the flowing syrup, Anri's bobbing, the glowing cuts, the shattering wheel, the fireballs and the burning page; the wheel and the homepage simply go, as in the other themes.
- The welcome guide keeps its own sketchbook style in every theme.

To add a theme, add its entry to `THEMES` in `src/lib/theme.ts` (name, caption, swatch colours, paper and flash colours, and its words — spread `MONOCHROME_COPY` to keep the defaults), then add a stylesheet in `src/themes/` whose rules are all scoped to `[data-theme='your-id']` and import it in `src/main.tsx`. The berry sticker, stationery and Anri artwork in `src/assets/strawberry/` were made for the strawberry theme with an image-generation model, using Anri's existing poses as reference. The same goes for Dismantle's art in `src/assets/dismantle/`: Anri's domain-expansion pose, her markings as a separate glow layer, her peeking sticker, the shrine and the fireball.
