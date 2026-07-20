# FireNET (RFD)

> ระบบจัดการและรายงานจุดความร้อน — กรมป่าไม้ (Royal Forest Department, Thailand)

A firespot-management system for internal staff: it ingests wildfire hotspots
from the department's national feed, lets regional dispatchers assign field
officers to active fires, tracks those officers live on a map, and records how
each fire was resolved. The web console is a single-page React app served by
nginx; field officers use a companion Expo (React Native) app. Both talk to a
FastAPI + PostGIS backend, deployed behind an existing Traefik reverse proxy
with Docker Compose.

In production the system lives under a path prefix at **`/firenet`** (e.g.
`https://wildfire.forest.go.th/firenet/`) on the same host as the upstream
hotspot feed — an internal tool, not a public site.

---

## Features

- **Hotspot ingest** — a scheduled job pulls the department's wildfire feed on an
  interval (default hourly, with a one-day lookback so a midnight gap can't drop
  fires) and upserts firespots into PostGIS.
- **Dispatch & assignment** — dispatchers claim a fire for a field officer;
  assignment is first-come-first-served (enforced by a unique index), and
  unresolved fires auto-expire after a few days and release their officer.
- **Live officer tracking** — the mobile app pushes officer locations on a
  clamped cadence; the console renders them over WebSocket, bounded to the
  admin's current viewport and capped so a national view never ships the whole
  fleet. Officers age to *offline* after a TTL without an update.
- **Fire resolution with evidence** — officers close a fire with a note and up to
  a few photos plus an optional video, stored in S3/MinIO.
- **Region hierarchy** — regional offices / provinces modeled as a Postgres
  `ltree` tree, with region-change requests and per-user region scoping.
- **Push notifications** — assignment / status pushes via Firebase Cloud
  Messaging (sends are logged-and-skipped until FCM credentials are configured).
- **Role-based access** — superuser, regional dispatchers, and field officers,
  with JWT auth (cookie for web, bearer for mobile) and rotating, revocable
  refresh tokens so a lost device or removed officer can be cut off fast.
- **Audit log** — security-relevant actions are recorded server-side.
- **Console pages** — live map, dashboard stats, officers, dispatchers, fire
  history, audit log, and user/access management.

## Tech stack

| Layer    | Technologies |
|----------|--------------|
| Web      | React 19, Vite, React Router 7, Tailwind CSS 4, MapLibre GL, Zustand, react-use-websocket |
| Mobile   | Expo (React Native 0.85), Expo Router, MapLibre, expo-location/notifications/task-manager, React Native Firebase (FCM), NativeWind, Zustand |
| Backend  | FastAPI, fastapi-users, SQLAlchemy 2 (async / asyncpg), GeoAlchemy2 + Shapely, APScheduler, MinIO, firebase-admin |
| Database | PostgreSQL + PostGIS (with `ltree`) |
| Storage  | S3-compatible object storage (MinIO) for fire-resolution evidence |
| Infra    | Docker / Docker Compose, Traefik (TLS via Let's Encrypt), nginx (SPA) |

## Project structure

```
fireNet/
├── backend/                 # FastAPI + SQLAlchemy (async) + PostGIS API
│   ├── app/
│   │   ├── main.py          # App factory, lifespan, scheduler, router wiring
│   │   ├── config.py        # Pydantic settings (env-driven)
│   │   ├── middleware.py    # Rate limiting + security headers
│   │   ├── storage.py       # S3/MinIO client
│   │   ├── auth/            # fastapi-users, refresh tokens, WS auth
│   │   ├── router/          # API endpoints (auth, fires, officers, regions, users, audit, ws)
│   │   ├── db_control/      # Business logic (ingest/fetch, fires, permissions, push)
│   │   ├── database/        # Engine, ORM models, schemas, seed scripts
│   │   └── ws/              # WebSocket manager, Postgres LISTEN/NOTIFY, handlers
│   └── requirements.txt
├── web/                     # React 19 + Vite SPA (Tailwind 4 + MapLibre)
│   └── src/
│       ├── pages/           # Map, Dashboard, Officers, Dispatchers, History, Audit, Users, Login
│       ├── components/      # Map, sidebar, cards, toasts; layers/ map styles
│       └── lib/             # Zustand stores, fire-data + websocket hooks, helpers
├── mobile/                  # Expo (React Native) field-officer app
├── infra/                   # Production Docker Compose (Traefik labels) + nginx conf
├── docker-compose.example.yml  # Local dev template: Postgres/PostGIS + MinIO (copy to docker-compose.yml)
└── all-start.ps1            # Dev launcher: backend + web + mobile (Windows)
```

## Getting started (local development)

### Prerequisites

- Python 3.13+
- Node.js 20+
- Docker (for Postgres/PostGIS + MinIO), or your own PostGIS-enabled Postgres

### Quick start (Windows)

```powershell
# Brings up Postgres + MinIO (docker), the FastAPI backend, the Vite web dev
# server, and the Expo dev server — pointing mobile at this machine's LAN IP.
.\all-start.ps1            # add -Fresh to drop & recreate the database
```

The rest of this section is the manual, per-service equivalent.

### 1. Infrastructure (Postgres + MinIO)

```bash
cp docker-compose.example.yml docker-compose.yml   # gitignored; edit creds if needed
docker compose up -d        # db on :5432, MinIO on :9000 (console :9001)
```

### 2. Backend

```bash
cd backend
python -m venv venv
# Windows: .\venv\Scripts\activate     macOS/Linux: source venv/bin/activate
pip install -r requirements.txt

# Configure environment: copy the template to .env and fill in real values
copy .env.example .env             # PowerShell / cmd
# cp .env.example .env              # macOS/Linux

# Run the API (Swagger at http://localhost:8000/docs)
uvicorn app.main:app --reload --port 8000
```

On first boot the app creates the schema, seeds the bootstrap superuser
(`INITIAL_SUPERUSER_USERNAME` / `INITIAL_SUPERUSER_PASSWORD`), and — if
`SEED_REGIONAL_ACCOUNTS=true` — provisions one dispatcher per region with random
passwords written to a gitignored `seeded_accounts.csv` at the repo root.

### 3. Web console

```bash
cd web
npm install
npm run dev                         # Vite dev server at http://localhost:5173
```

`http://localhost:5173` is already allowed by the backend's default CORS config.

### 4. Mobile app

```bash
cd mobile
npm install
npx expo start                      # point the app's .env at your machine's LAN IP
```

## Configuration

Backend configuration is environment-driven (see `backend/.env.example`).
Settings with **no in-code default are required** — the app refuses to boot
without them rather than fall back to an insecure value. Key variables:

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | **Required.** Master signing secret for the auth JWT; the reset/verification token secrets are derived from it. Use a long random value. |
| `INITIAL_SUPERUSER_PASSWORD` | **Required.** Bootstrap superuser password (seeded once). Rotate after first login. |
| `S3_SECRET_KEY` | **Required.** Object-storage (MinIO/S3) secret key. |
| `DATABASE_URL` | PostGIS DSN, e.g. `postgresql+asyncpg://firenet:firenet@localhost:5432/firenet` |
| `COOKIE_SECURE` | `true` in production (HTTPS); `false` for local HTTP dev |
| `CORS_ORIGINS` | Allowed web origins (defaults to the Vite dev server) |
| `WILDFIRE_API_URL` | Upstream hotspot feed; ingest interval/lookback are configurable alongside it |
| `FCM_CREDENTIALS_FILE` | Path to a Firebase service-account JSON; until set, pushes are logged and skipped |

Ingest cadence, fire display/expiry windows, officer online-TTL and
location-poll bounds, viewport officer caps, and the auth rate limit all have
sensible defaults in `backend/app/config.py` and can be overridden via env.

> **Secrets are never committed.** `backend/.env` and `infra/.env` are
> git-ignored. Keep real database passwords, `JWT_SECRET`, and storage
> credentials only in the deployment host's local copies.

## Command reference

Every command is run from the directory shown in the first column.

### Repo root

| Command | What it does |
|---------|--------------|
| `.\all-start.ps1` | Dev launcher: creates the backend venv and installs `node_modules` on first run, brings up Postgres/MinIO, then starts the API, the Vite dev server, and Expo — with the mobile `.env` pointed at this machine's LAN IP. |
| `.\all-start.ps1 -Fresh` | Same, but drops and recreates the database first. Destroys all local data. |
| `.\publish-apk.ps1 -VersionCode N -VersionName X.Y.Z` | Builds and publishes an Android release. See [Building and releasing the mobile app](#building-and-releasing-the-mobile-app). |

### `backend/`

| Command | What it does |
|---------|--------------|
| `uvicorn app.main:app --reload --port 8000` | Run the API with auto-reload. Swagger at `/docs`. |
| `.\start.ps1` | Starts the Postgres container (creating it if needed), waits for it to accept connections, then runs the API. |
| `.\start.ps1 -Fresh` | Same, after dropping and recreating the database. |
| `.\reset.ps1` | `docker compose down -v && up -d` — wipes the DB volume and brings the containers back. Destroys all local data. |
| `pip install -r requirements.txt` | Install/refresh Python dependencies (activate the venv first). |

### `web/`

| Command | What it does |
|---------|--------------|
| `npm run dev` | Vite dev server at `http://localhost:5173`. |
| `npm run build` | Production build into `web/dist` — required before deploying, the nginx container serves that directory. |
| `npm run preview` | Serve the built `dist/` locally to check a production build. |
| `npm run lint` | ESLint over the SPA. |

### `mobile/`

| Command | What it does |
|---------|--------------|
| `npx expo start` | Expo dev server. Point `mobile/.env` at your machine's LAN IP so the device can reach the API. |
| `npm run android` | `expo run:android` — build and launch the dev client on a connected device/emulator. |
| `npm run lint` | ESLint over the app. |
| `npx expo prebuild --platform android` | Regenerate the native `android/` project from `app.json`. Needed after changing plugins or permissions; `android/` is checked in, so review the diff. |
| `cd android && .\gradlew.bat assembleRelease` | Build a signed release APK by hand. Prefer `publish-apk.ps1`, which also stamps and verifies the version. |

### Production server

| Command | What it does |
|---------|--------------|
| `cd infra && docker compose -f compose.yaml up -d --build api` | Rebuild and recreate just the API container after backend code changes. |
| `docker compose -f compose.yaml up -d --force-recreate api` | Recreate the API container after editing `backend/.env` — a plain restart does **not** re-read `env_file`. |
| `docker compose -f compose.yaml logs -f api` | Follow API logs. |

## Building and releasing the mobile app

Field officers install the app as a **sideloaded APK** — there is no Play Store
listing and no Expo OTA channel. The app asks the backend what the newest build
is, and hands the APK URL to the system browser; the officer downloads it and
installs it from their file manager.

Two rules govern every release:

- **Same keystore, always.** Every APK must be signed with
  `mobile/firenet-release.keystore` (credentials in `~/.gradle/gradle.properties`
  as `FIRENET_UPLOAD_*`). Android refuses an over-the-top install from a
  different key.
- **`versionCode` only ever increases.** Android treats a lower code as a
  downgrade and refuses it.

### Releasing

From the repo root:

```powershell
.\publish-apk.ps1 -VersionCode 2 -VersionName 1.0.1
```

That single command:

1. **Stamps** the version into `mobile/app.json` *and*
   `mobile/android/app/build.gradle`. Both must agree — `build.gradle` is what
   reaches the APK, `app.json` is what a future `expo prebuild` regenerates it from.
2. **Builds** a signed release APK with `gradlew assembleRelease`, deleting the
   previous output first so a failed build can't leave a stale APK to publish.
3. **Verifies** the APK's *embedded* `versionCode`/`versionName` with `aapt2` and
   aborts if they disagree with what you asked for.
4. **Publishes** to `backend/app_releases/firenet-<VersionName>-<VersionCode>.apk`
   and rewrites `android-latest.json`, the manifest the API serves.

| Option | Purpose |
|--------|---------|
| `-VersionCode` *(required)* | The new build number. Must exceed the previous release. |
| `-VersionName` *(required)* | Human-readable version shown to the officer, e.g. `1.0.1`. |
| `-MinVersionCode N` | Builds below `N` are forced to update (the officer can't dismiss the prompt). Defaults to `1`. |
| `-ReleaseNotes "..."` | Shown in the update dialog. Thai is fine. |
| `-SkipBuild` | Republish an APK already at the output path instead of rebuilding. The version check still runs. |
| `-Prebuild` | Run `expo prebuild` before building. Needed after plugin/permission changes in `app.json`. |
| `-ApkPath` / `-ReleaseDir` | Override the input APK or output directory. |

Step 3 exists because the failure it prevents is silent and confusing: if the
manifest advertises a `versionCode` higher than the one actually inside the APK,
officers get an update prompt that reinstalls the same build and never goes
away, because the client compares the manifest against the version the installed
APK reports.

> `publish-apk.ps1` must stay **UTF-8 with BOM**. Windows PowerShell 5.1 reads a
> BOM-less file as cp1252, which turns the em-dashes in its strings into
> characters it treats as string delimiters — producing parse errors far from the
> real line.

### Deploying the release

The APK and manifest are gitignored, so `git pull` on the server will not carry
them — copy them up:

```bash
scp backend/app_releases/firenet-1.0.1-2.apk backend/app_releases/android-latest.json \
    yok@wildfire.forest.go.th:~/www/firenet/backend/app_releases/
```

No restart is needed: `backend/app_releases` is a live read-only bind mount into
the API container. Commit the version bump in `mobile/app.json` and
`mobile/android/app/build.gradle` so the repo matches what shipped.

Verify without pulling the whole ~160 MB:

```bash
curl -s -r 0-0 -D - -o /dev/null \
  https://wildfire.forest.go.th/firenet/api/app/android/download/2
```

Expect `206`, `content-type: application/vnd.android.package-archive`, and a
`content-range` total matching the manifest's `fileSize`. (`curl -I` returns 405
— the route is GET-only.)

> **`PUBLIC_BASE_URL` must be set** in the server's `backend/.env` to
> `https://wildfire.forest.go.th/firenet/api`. If it is empty the backend derives
> the APK URL from `request.base_url`, which after Traefik's TLS termination and
> prefix-strip yields the wrong scheme and a missing `/firenet/api` — every
> download 404s.

## Deployment

Production runs from `infra/` with Docker Compose behind an existing Traefik
instance:

```bash
cd infra
cp .env.example .env                # POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD
docker compose -f compose.yaml up -d --build
```

- **db** (PostGIS) and **minio** stay on a private `internal` network with no
  host ports.
- **api** (FastAPI) and **web** (nginx serving the built SPA) join the shared
  external `wildfire_default` network.
- **Traefik labels** route `Host(...) && PathPrefix('/firenet')` to the web
  container and `/firenet/api` to the backend (stripping the prefix), and
  terminate TLS via Let's Encrypt.

Build the SPA (`cd web && npm run build`) before bringing the stack up — the web
container serves `web/dist`. Provide production values through the host's
`.env` files; never commit them.

## License

Internal project of the Royal Forest Department (กรมป่าไม้). All rights reserved.
