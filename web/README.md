# FireNET — Web console

The internal web console for [FireNET](../README.md) (ระบบจัดการไฟป่า): a React 19
single-page app that dispatchers and admins use to watch wildfire hotspots on a
live map, assign field officers, and manage people, permissions, history, and
audits.

Served in production as static files by nginx under the **`/firenet`** path
prefix (see [`infra/`](../infra/)). See the [root README](../README.md) for the
full system overview.

## Stack

React 19 · Vite · React Router 7 · Tailwind CSS 4 · MapLibre GL · Zustand ·
react-use-websocket · react-window · Heroicons

## Features

### Live fire map
- **MapLibre map** with three switchable base layers — default, satellite, and
  topographic.
- **Per-user opening view** — the map centers and zooms on the region the signed-in
  admin is assigned to (falls back to a national view).
- **Firespots colored by status** — free, booked by officer, or resolved.
- **Side list, virtualized** with `react-window` so thousands of fires scroll
  smoothly. Sort by time/other (tap the active chip again to flip direction) and
  filter by **status** (ลุกไหม้ / ถูกจอง / ดับแล้ว), **province**, and **satellite**.
- **List ⇄ map selection sync** — selecting a fire in the list focuses it on the
  map and vice-versa.
- **Live officers overlay** (toggleable) streamed over WebSocket, bounded to the
  current map viewport (bbox) and capped server-side so a national view never
  ships the whole fleet.
- **Fire detail card** — selecting a fire opens a panel with its status, area
  type, detection time, location (tambon · amphoe · province), satellite, and
  the responsible officer (or "no officer yet").
- **Appoint an officer** — pick from the in-area officer
  list, each tagged online/offline and busy, then assign over WebSocket. Busy
  officers, and fires that are resolved or already booked, are locked out; a
  live `officers_map` refresh disarms the button if the picked officer turns
  busy mid-flow. Outcome and reasons (out of scope, officer busy, already
  booked, …) come back as toasts.
- **Cancel a booking** — release an officer's reservation on a booked, unresolved fire.

### Dashboard
- Situation summary (สรุปสถานการณ์ไฟป่า) with **operations** and **info** tabs.
- Per-day rollups: hotspots **detected**, fires **resolved**, **false alarms**,
  and **expired**, with manual refresh.

### Officers
Three panels, each gated by the viewer's permissions:
- **Roster of verified officers** — searchable by name / username / division /
  province; sortable by name (Thai collation), date added, or last update (tap
  the arrow to flip direction); filterable by **online / offline / busy**; and
  client-side paginated (20/page). Each row shows online status with a
  last-seen timestamp, and a yellow dot marks officers **holding a fire** —
  click them to jump to that fire on the map.
- **Inline edit** — rename, change division, reassign to
  another province, change username, or reset the password (blank keeps the
  current one), plus delete with a confirm prompt.
- **Pending registrations** — approve or reject new
  signups; rejecting deletes the account.
- **Region-change requests** — approve or reject
  officers' requests to move provinces.

  Roster, approvals, and decisions all stream live over WebSocket.

### Dispatchers
- Grant and manage dispatcher permissions: view/manage/verify officers, view &
  decide region-change requests, appoint fires, view fire history, and view
  dispatchers — with auto-derived dependencies between permissions.

### History
- Fire-resolution history (ประวัติการดับไฟ), searchable by fire name, officer, or
  location.

### Audit log
- Server-recorded event log (บันทึกเหตุการณ์) with category filter, color-coded
  action labels, and search by username/actor.

### Access management
- Manage user accounts and permissions, filter by status and division, sort, and
  search.

### Cross-cutting
- **Role-based UI** — every control is gated by a `can(user, permission)` check,
  so the menu and actions match the signed-in account's rights.
- **JWT cookie auth** with silent token refresh; routes are guarded by
  `RequireAuth`.
- **Live updates over WebSocket** (Zustand socket store) — fires and officers
  update without polling.
- **Toast notifications** and a Thai-localized, accessibility-minded UI.

## Develop

```bash
npm install
npm run dev          # Vite dev server at http://localhost:5173
```

`npm run lint` runs ESLint · `npm run build` emits `dist/` (what nginx serves) ·
`npm run preview` serves that build locally.

> **Backend target.** The app is served under `base: '/firenet'`, and the Vite
> dev server proxies `/auth`, `/users`, `/regions`, `/fires`, `/officers`,
> `/audit`, and the `/ws` WebSocket to a backend (configured in
> [`vite.config.js`](vite.config.js); it points at the production host by
> default). Point those at your local API on `:8000` to develop against this
> repo's backend.

## Layout

```
src/
├── main.jsx, App.jsx     # Entry + router with auth-guarded routes
├── pages/                # Map, Dashboard, Officers, Dispatchers, History, Audit, Users, Login
├── components/           # map, sidebar, cards (card / expandedCard), toasts
│   └── layers/           # MapLibre style JSON (base, satellite, topo)
└── lib/
    ├── useAuthStore.js   # auth state + permission helpers
    ├── stateStore.js     # socket + map-selection stores
    ├── useFireData.js    # fire data hook
    ├── useMessageEffect.js, toastStore.js
    └── datetime.js, shared.js
```
