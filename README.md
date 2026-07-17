# DravaInt Production OS

DravaInt is a bilingual Croatian/English production-planning web app for workshop terminals. It combines work orders, machine and shift scheduling, live progress, CPM/Gantt planning, workforce administration, offline recovery, and a secure operator lock screen in one installable interface.

## What is included

- Clean, flat responsive shell with a single-row command bar, drawer navigation, role-aware routes, light/dark themes, compact mode, and keyboard shortcuts.
- Universal `Ctrl/Cmd + K` command palette, live operational alert center, online/offline and queued-change status, dashboard quick actions, and safe per-module recovery.
- Per-operator saved Gantt views, configurable delay/capacity/material/conflict/absence alert rules, and unified operation-aware capacity calculations.
- Work-order creation with product, operator qualifications, operation routes, conflict validation, comments, setup time, material status, printing, and optimistic versioning.
- Interactive multi-week shift planner with worker directory data, absences, rotations, drag/drop overrides, inline reassignment, rest/hour warnings, publishing, CSV, print, and ICS export.
- Advanced Gantt/CPM workspace with FS/SS/FF/SF dependencies, cycle prevention, critical-path slack, shift snapping, holidays, undo/redo, multi-select, hierarchy collapse, operation reordering, baseline comparison, custom dependency curves, conflict/material/setup indicators, PNG/PDF export, and full-screen mode.
- Dashboard capacity and operator-allocation summaries plus live progress views.
- Machine Scheduling board: a custom drag-and-drop timeline (own engine, no external Gantt library) for the shop floor. Drag a card to reschedule or drop it on a different machine lane to reassign it in one gesture; drag from a card's edge handle to another card to draw an FS/SS/FF/SF dependency live, with cycle/duplicate/self-link detection during the drag; resize handles, multi-select group drag, undo/redo, and a "connect mode" tap-to-link fallback for touch. Every change writes through the same shared job store the Gantt Chart and Dashboard read, so it propagates automatically — no separate sync step.
- Settings center with search and tabs, language/theme/default-page controls, role-specific lock timeouts, custom PIN, workday/holiday rules, Gantt sizing, backup import/export, wallpaper, greeting, logo, and avatar settings.
- Unified lock screen with shift clock/progress, keypad and physical keyboard support, password visibility, failed-attempt cooldown, haptics, warning chime, screen dimming, manual lock, and emergency logout.
- Supabase Auth, strict RLS, realtime tables, audit logging, soft deletion, optimistic locking, database overlap checks, schedule-generation RPC, admin-user Edge Function, and public shift-calendar Edge Function.
- IndexedDB mutation queue and automatic reconnection sync. The production build is an installable PWA with a cached application shell.
- Admin system diagnostics for connection, browser storage, PWA cache, exact queued mutations, last sync error, manual retry, and selective discard recovery.

## Local preview

Requirements: Node.js 22 or newer (required by the current Supabase client).

```bash
npm install
npm run dev
```

Open `http://localhost:5173/`.

When Supabase variables are not configured, DravaInt clearly runs in local preview mode. Demo accounts:

| Role | Username | Password |
| --- | --- | --- |
| Administrator | `admin` | `DravaInt!2026` |
| Supervisor | `supervisor` | `Workshop!2026` |

Local preview data stays in that browser. Do not use demo mode as a shared production deployment.

## Production Supabase setup

1. Create a Supabase project and copy `.env.local.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`.
3. Run `supabase/schema.sql` in the Supabase SQL Editor. It creates the complete normalized schema, indexes, triggers, views, RLS policies, role claims hook, realtime publication, seeded roles/shifts, and schedule-generation RPC.
4. Deploy the server-only functions from the repository root:

   ```bash
   supabase functions deploy admin-users
   supabase functions deploy shift-calendar --no-verify-jwt
   ```

5. In Supabase Auth, enable email/password. Configure Azure OAuth only if Microsoft SSO is required, and add the deployed app URL to the allowed redirect URLs.
6. Configure `public.custom_access_token_hook` as the Auth custom access-token hook so `app_role` is included in JWTs.
7. Create the first Auth administrator, then set the matching `public.profiles.role` to `admin` in the SQL Editor. Subsequent accounts can be managed in DravaInt Administration.
8. Keep `SUPABASE_SERVICE_ROLE_KEY` only in Edge Function secrets. Never expose it through a `VITE_` variable.

The `shift-calendar` function accepts a worker's private `calendar_token`. Rotate that token if a calendar URL is shared accidentally.

## Quality commands

```bash
npm run lint
npm run test
npm run build
npm run check
```

`npm run check` runs linting, all Vitest tests, TypeScript compilation, and the optimized Vite build.

## Deployment

The included GitHub Pages workflow builds on pushes to the configured deployment branches. Add repository secrets named `SUPABASE_URL` and `SUPABASE_ANON_KEY`; the workflow maps them to the public Vite variables at build time.

For another static host, publish `dist/` after `npm run build`. Hash-based routes keep deep links compatible with static hosting. HTTPS is required for reliable PWA installation and service-worker caching.

## Operational notes

- Use the top-bar padlock for an immediate terminal lock. `Ctrl/Cmd + K` opens the command palette and `Ctrl + Alt + S` opens Settings from any unlocked view.
- The bell surfaces live machine overlaps, delayed orders, material risks, staff absence, connectivity, and the exact number of queued offline changes.
- Export a settings backup before changing shared workshop-terminal configuration.
- Published schedules remain versioned; archived workers and roles are retained for historical records.
- Offline edits are queued and retried when connectivity returns. Resolve an optimistic-lock warning by reloading the newest shared record before editing again.
