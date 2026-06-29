# FireNET — Field-officer app

The companion mobile app for [FireNET](../README.md), carried by field officers
in the wildfire response: register and await approval, see assigned firespots on
a map, share live location while on duty, and close out a fire with notes and
photos. Built with Expo (React Native) and file-based routing via Expo Router.

See the [root README](../README.md) for the full system overview.

## Stack

Expo SDK 56 · React Native 0.85 · Expo Router · MapLibre · NativeWind ·
Zustand · React Native Firebase (FCM push) · expo-location / -notifications /
-task-manager (background location) · Kanit + Sarabun (Thai fonts)

## Features

### Onboarding & access
- **Login** with username + password (tokens kept in the device keystore via
  `expo-secure-store`).
- **Multi-step registration** ([`Register.tsx`](src/app/Register.tsx)) with a
  progress indicator and province selection.
- **Approval gate** ([`Pending.tsx`](src/app/Pending.tsx)) — new officers wait for
  a dispatcher to verify them before gaining access.

### Map View
- MapLibre map of firespots **colored by status** (ว่าง / ถูกจอง / จองแล้ว / ดับแล้ว),
  with the officer's currently held fire highlighted; the selected dot is enlarged
  with a white stroke. Fires are rendered as a GeoJSONsource for smooth updates.
- **Opens on the officer's home region** (from their profile), falling back to a
  whole-Thailand view; a **recenter** button flies back to that view, and a
  **refresh** button reloads fires, the held fire, and profile in one tap.
- **Online/offline toggle** — switching online requests location permission and
  starts location sharing; while offline the fire list is dimmed and
  non-interactive.
- **Bottom-sheet fire list** — sortable by **time** or **name** (tap the active
  chip again to flip direction), virtualized for long lists.
- **List ⇆ map sync** — tapping a dot focuses it and scrolls the list to that
  row; selecting a row flies the camera to the fire.
- **Reserve (จอง)** from a row jumps to the Firespot screen; locked while the officer
  already holds an unresolved fire, for fires booked by another officer, and when offline.

### Resolve a fire
- **Claim/hold** a firespot, then **resolve** it (ดับไฟแล้ว) with a note and photos.
- Photos from **camera or gallery**, with **EXIF GPS** pulled off the image
  (falling back to the device's current position) so a resolution carries the
  location it was taken. At least 1 photo required, up to 3.
- **Navigate** opens turn-by-turn directions to the fire in Google Maps.
- **Cancel reservation** (ยกเลิกการจอง) — release the fire back to free for
  another officer, behind a confirm dialog. Hidden when the fire was **appointed
  by a dispatcher** (those can be cancelled only by dispatcher).
- **Report "not a fire"** (ไม่ใช่ไฟ) — flag a false alarm with an optional note
  when there's no real fire at the spot.
- Online/offline aware: all actions are disabled while offline so an officer
  knows a submit won't go through.

### Live location
- **Background location updates** via an `expo-task-manager` headless task and a
  foreground service, so position keeps flowing when the app is backgrounded.
- Cadence is **configurable by the superuser** and re-armed on app-state changes;
  each tick pushes the freshest fix in the batch (a coords-only heartbeat that
  never flips the officer's active state). Auth token is rehydrated from the
  keystore inside the headless context.

### Offline map
- **Pre-download the home region's map tiles** (MapLibre OfflineManager) from
  Settings, with a size estimate and a download progress percentage, so the map
  still renders with no signal in the field.

### History
- The officer's resolved-fire history, with **auth-gated evidence photos**
  downloaded on demand and viewable in a gallery.

### Region change
- Request a move to another province; shows the pending request's status.

### Account & settings
- Edit profile fields; offline-map download; logout.

### Push notifications 
- **FCM** (React Native Firebase v22 modular API) for appointment alerts on a
  HIGH-importance Android channel (heads-up banner). Foreground messages are
  re-presented as local notifications so they surface over the open app.

## Develop

```bash
npm install
npx expo start
```

> **Requires a development build, not Expo Go.** The app uses native modules
> (React Native Firebase, MapLibre, background location) that Expo Go can't
> load. Build and run on a device/emulator with `npm run android` (`expo
> run:android`) or `npm run ios`.

### Configuration

Set the backend the app talks to in `mobile/.env`:

```
EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:8000
```

[`src/lib/api.ts`](src/lib/api.ts) throws on startup if it's missing. On Windows,
the repo's [`all-start.ps1`](../all-start.ps1) auto-detects your LAN IP and
writes this for you. `npm run lint` runs `expo lint`.

> ⚠️ **Expo SDK 56 changed APIs.** Check the versioned docs at
> <https://docs.expo.dev/versions/v56.0.0/> before writing native code — see
> [`AGENTS.md`](AGENTS.md).

## Layout

```
src/
├── app/                  # Expo Router routes
│   ├── index, Login, Register, Pending   # auth + approval gate
│   └── (authorized)/     # MapView, Firespot, History, RegionChange, Account, Setting
├── lib/                  # api, background locationTask, offlineMap, push, theme, toastStore
├── stores/               # Zustand state (fireStore: fires, held fire, online status)
├── providers/            # AuthProvider
├── components/           # Toast, Toaster
├── utils/                # format helpers
└── data/                 # provinces.json
```
