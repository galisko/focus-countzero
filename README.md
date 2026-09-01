# Focus Protocol

A frontend-only, privacy-first Pomodoro timer. There is no account, backend, analytics service, or remote database.

## Architecture

- `app/focus-app.tsx` contains the product UI and timer orchestration.
- `lib/storage.ts` is the IndexedDB data layer for tasks, session history, and the local background image.
- `public/timer-worker.js` runs deadline-based ticks outside the main UI thread.
- `localStorage` keeps small preferences and the current timer deadline so an active session survives refreshes.
- `BroadcastChannel` synchronizes changes between tabs on the same browser profile.
- `public/sw.js` and `manifest.webmanifest` provide offline/PWA behavior.

## Local development

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.

## Privacy model

All user content stays in browser-managed storage on the current device. Removing browser site data removes the app's tasks, history, settings, and custom background. Notification permission is requested only when the user enables notifications.
