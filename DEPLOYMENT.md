# TFMS Deployment

Self-hosted on a single private server, zero paid infrastructure. This describes
the worker topology and the supporting services. It reflects the **real** current
scale (~100–200 concurrent web users), not the deferred 10k ceiling — see the
scaling note at the end.

## Components

| Component | What it is | How it runs |
|---|---|---|
| Backend API | FastAPI app (`backend/app/main.py`) serving REST **and** the `/ws` WebSocket | uvicorn (see below) |
| Postgres | PostGIS + `ltree` (regions, fires, officers, audit) | `docker-compose.yml` → `tfms-postgres` |
| MinIO | S3-compatible store for fire-resolution evidence | `docker-compose.yml` → `tfms-minio` |
| Web console | React/Vite static build (admin/dispatcher only) | served as static files by nginx |
| nginx | TLS termination + reverse proxy (REST, WS upgrade, static) | host package |

The backend lifespan also runs, **in-process**: the bootstrap DDL, the seed step,
the APScheduler wildfire ingest job, and the `pg_listener` (Postgres
`LISTEN/NOTIFY` → WebSocket broadcasts). These assume a single authoritative
process — which is exactly what the recommended topology gives them.

## Worker model (the important part)

**Run the backend as a single worker.**

```bash
# production, single private server
cd backend
fastapi run app/main.py --workers 1        # or: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

Why one worker:

- The realtime layer (`ConnectionManager`, the fire registry, per-scope delta
  versions, snapshot caches) and the `pg_listener` keep their state **in process
  memory**. One worker = one authority = correct and efficient.
- At ~100–200 mostly-idle WebSocket connections this is trivial; a single asyncio
  process handles it with room to spare. Broadcast cost is bounded by the number
  of distinct region *scopes*, not by connection count.
- Running `--workers N` would not corrupt anything, but every worker's
  `pg_listener` receives every change and independently re-queries/re-serializes —
  it multiplies DB/CPU load and duplicates the ingest scheduler. Don't.

A startup **advisory lock** (`BOOTSTRAP_LOCK_KEY` in `main.py`, mirrored in
`pg_listener.py`) serializes the bootstrap DDL, so even an accidental multi-worker
start won't deadlock on `CREATE INDEX`/trigger creation — but single-worker is
still the intended configuration.

## Required environment

Secrets have **no in-code defaults** — the app refuses to boot without them (fail
fast). Copy `backend/.env.example` to `backend/.env` and set at least:

```
JWT_SECRET=<long random>           # python -c "import secrets; print(secrets.token_urlsafe(48))"
INITIAL_SUPERUSER_PASSWORD=<value> # rotate after first login
S3_SECRET_KEY=<value>              # must match MinIO MINIO_ROOT_PASSWORD
DATABASE_URL=postgresql+asyncpg://tfms:<pw>@localhost:5432/tfms
COOKIE_SECURE=true                 # default; requires HTTPS in front
CORS_ORIGINS=["https://wildfire.forest.go.th"]
```

## First-run provisioning

Region/dispatcher accounts are created by a one-time, opt-in seed:

1. Set `SEED_REGIONAL_ACCOUNTS=true` and start the backend once.
2. It writes generated credentials to `seeded_accounts.csv` at the repo root
   (gitignored — plaintext passwords). Distribute and rotate them.
3. Set `SEED_REGIONAL_ACCOUNTS=false` again so it doesn't re-run.

The bootstrap superuser is always seeded from `INITIAL_SUPERUSER_*`.

## nginx sketch

```nginx
# all backend paths are proxied under /tfms/api/ (matches web/vite.config.js prod)
location /tfms/api/ {
    proxy_pass http://127.0.0.1:8000/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # used by the auth rate limiter
}
location /tfms/api/ws {
    proxy_pass http://127.0.0.1:8000/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;           # WebSocket upgrade
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 1h;
}
# web console static build
location /tfms/ { root /var/www; try_files $uri /index.html; }
```

TLS must terminate here (the session cookie is `Secure`).

## Operational notes

- Logs go through the stdlib `logging` module; request-time logs carry user **ids,
  not emails** (emails live only in `audit_log`).
- The auth rate limiter (`app/middleware.py`) is **per-process**, so with one
  worker the configured limit is the actual limit. Behind nginx it keys on the
  first `X-Forwarded-For` entry — keep nginx setting that header.
- `INGEST_ENABLED=false` disables the wildfire ingest scheduler (e.g. for a
  staging copy that shouldn't pull live data).

## Scaling beyond one worker (future — district/subdistrict rollout)

Not needed at current scale. When the deferred ~900 district + ~5,000 subdistrict
tiers land:

- **Connection count is still fine** on one worker (~6k idle sockets is cheap).
- The watch item is the **officer-list refresh**, which queries the DB once per
  distinct scope. The fire-delta path is already O(1) per change; mirror that
  pattern for officers (fetch once, bucket in memory) before anything else.
- If REST/mobile throughput (separately) needs horizontal scale, the clean split
  is **one dedicated WS process (single worker, owns `pg_listener` + ingest) + N
  stateless REST workers**, routed by path in nginx. This needs a small code
  change first: a role flag so REST-only processes **don't** start the ingest
  scheduler / `pg_listener` / registry warm. Track that as a prerequisite — it is
  not drop-in config today.

A shared broker (Redis pub/sub) is the textbook multi-worker fan-out fix but is
**out of scope** (no paid/extra infra). Postgres `LISTEN/NOTIFY` already covers
single-process needs.
