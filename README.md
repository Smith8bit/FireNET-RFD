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
  a few photos, stored in S3/MinIO.
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
├── docker-compose.yml       # Local dev: Postgres/PostGIS + MinIO only
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
