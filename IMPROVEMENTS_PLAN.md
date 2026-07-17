# DravaInt — Improvements Plan

*Full-app review, 2026-07-17. Covers architecture, data model, scheduling logic, security/privacy, UX, performance, accessibility, testing, and operations. Findings are prioritized **Now / Next / Later** by real-world impact for daily use in the shop. No code was changed as part of this review.*

**Status snapshot:** `npm run lint` — 1 warning (unused `viewingSnapshot` in `ShiftSchedule.tsx`, part of the in-flight publish feature). `npm run test` — 70/70 pass.

> **In progress elsewhere:** a separate session is building the published-schedule access/edit feature (uncommitted changes in `src/pages/ShiftSchedule.tsx` and `src/shifts/ShiftsContext.tsx`: publication snapshots, archive view, versioning). Findings below that touch that area are marked *(in progress)* and should be coordinated, not duplicated.

---

## NOW — correctness and security issues that bite in production

> **Implementation status (updated 2026-07-17):** Items 1–5, 7–12 are ✅ **done** on this branch.
> Schema/RLS changes (1, 2, 3, 4) live in `supabase/schema.sql` **and** a new idempotent
> `supabase/migrations/0001_now_tier_security_and_schema.sql` — **these must be run against the live
> Supabase project by hand** (this environment has no DB connection). Item 6 (offline-queue optimistic
> locking) and the *server-side* half of item 10 (routed-order DB trigger, which needs the item-13
> `job_operations` table) remain open — see notes on each.

### 1. ✅ DONE — `priority` column is missing from the database schema *(data loss in Supabase mode)*
**Fixed:** `priority text not null default 'normal' check (...)` added to `public.jobs` in `schema.sql` and migration `0001`. **Requires running migration `0001` against live Supabase.**
The client now reads/writes `priority` on jobs (`SchedulingContext.tsx` sends it in every insert/update payload), but `supabase/schema.sql` has **no `priority` column** on `public.jobs`. In Supabase mode every job insert/update will fail with an unknown-column error, get enqueued to the offline queue, and retry forever. The recent bug-11 work (commit `74beb31`) landed client-side only.
**Fix:** add `priority text not null default 'normal' check (priority in ('low','normal','high','urgent'))` to the schema (and a migration note in the README). Audit for other schema drift whenever a Job field is added — consider generating types from the schema.

### 2. ✅ DONE — Audit logs are readable by every authenticated user *(RLS ordering bug)*
**Fixed:** `audit_logs` (and `absences`) removed from the read-all loop in `schema.sql`, so only `audit_admin_read` applies. Migration `0001` drops the stale policy on existing DBs. **Requires running migration `0001`.**
`schema.sql` line 268 drops `authenticated_read` on `audit_logs`, but the generic loop at lines 366–371 runs **after** that and re-creates `authenticated_read using (true)` for `audit_logs` (it's in the table array). Policies are OR'd, so `audit_admin_read` doesn't restrict anything — any worker can read full before/after row images of every table.
**Fix:** exclude `audit_logs` from the read-all loop (and move the drop after it, or delete it).

### 3. ✅ DONE — RFID badge codes and emails exposed to all users
**Fixed:** column-level `revoke select` + safe-column re-grant on `profiles` (hides `rfid_code`) and `workers` (hides `calendar_token`) in `schema.sql`/migration `0001`. `AuthContext` no longer selects `rfid_code` (RFID login is disabled in Supabase mode anyway). **Requires running migration `0001`.**
`profiles` is readable by every authenticated user including `rfid_code`. Badge numbers are authentication credentials (demo mode literally logs in by RFID); any logged-in worker can enumerate everyone's badges. **Fix:** column-restrict via a view (username + role only for non-admins) or move `rfid_code` to an admin-only table. Same review for `workers.calendar_token` — it's a capability token and is currently selectable by all authenticated users via `authenticated_read`.

### 4. ✅ DONE — Absence types are health data visible to everyone
**Fixed:** direct `select` on `absences` revoked; new `public.absences_visible` view masks `type`/`notes` for non-planners (nulls them) while keeping worker + date range for the absence alert. `ShiftsContext` reads the view; writes still target the base table. **Requires running migration `0001`.**
`absences.type` includes `sick` and `maternity`, readable by all authenticated users. Under GDPR this is sensitive personal data; a shop terminal shouldn't show every worker why a colleague is off. **Fix:** RLS so non-planners see only worker + date range (a view that nulls `type`/`notes`), planners/admin see full records.

### 5. ✅ DONE — Silent write failures: work orders "created" that never persisted
**Fixed:** `WorkOrderCreator.createOrder`, `MachineSchedule.handleAdd`, and `ProgressMonitoring` now await the `UpdateResult` and surface `rejected` / `version-conflict` / `offline` distinctly (form kept on genuine rejection). `restoreBackup` now logs partial replay failures instead of silently claiming success.
`WorkOrderCreator.createOrder()` and `MachineSchedule.handleAdd()` call `addJob(...)` without awaiting or checking the result. In Supabase mode a DB rejection (double-booking trigger `DR001`, RLS denial, the missing-priority-column error above) or a version conflict shows the green "Order created" message anyway. `ProgressMonitoring` similarly ignores `updateJob` results, and `restoreBackup`'s replayed writes can partially fail without any feedback.
**Fix:** await the `UpdateResult`, surface `rejected` / `version-conflict` / `offline` distinctly (the machine board already gets this right — reuse its pattern).

### 6. Offline queue replay bypasses optimistic locking and can duplicate rows
`flushOfflineQueue()` (`src/sync/offlineQueue.ts`) replays updates matched only on `id` — the `version` check that protects live edits is not applied, so a reconnecting terminal silently clobbers newer edits made by others while it was offline. Queued inserts are also not idempotent (a request that actually reached the server before the connection dropped will be inserted twice), and one failing item head-of-line-blocks the whole queue forever.
**Fix:** include expected `version` in the replay match and surface conflicts to the SyncDiagnostics UI; add a client-generated idempotency key (or unique `job_order` constraint) for inserts; skip-and-park permanently failing items instead of blocking the queue.

### 7. ✅ DONE — Lock screen cannot be unlocked in production mode until a PIN is set
**Fixed:** `App.tsx` unlock now rejects an empty secret, matches a configured PIN, and in Supabase mode re-authenticates via `signInWithPassword` (no more comparing against the empty `password`). Demo mode still accepts the locally-stored account password (non-empty).
`App.tsx` unlock check: `secret === settings.lockPin` (only if a 4/6-digit PIN is set — default is `''`) OR `secret === currentUser?.password`. In Supabase mode `password` is always `''` (profiles carry no password), so with no PIN configured the terminal auto-locks and **the only way back in is emergency logout + full re-login**. Fix: verify the password against Supabase (`signInWithPassword` re-auth) or force PIN setup on first login; never compare against the empty string. Related hardening: the 3-attempt/60s lockout lives in `sessionStorage` (new tab = fresh attempts) — acceptable for a shop terminal but worth noting; and the PIN is stored in plaintext (see #8).

### 8. ✅ PARTIAL — One shared `ui_settings` row leaks the lock PIN and fights between terminals
**Fixed (security-critical part):** `SettingsContext.commit()` now strips `lockPin` before upserting to the shared `app_settings` row (the PIN stays strictly local), purges any previously-synced PIN on read, and logs upsert errors instead of silently dropping saves. **Still open:** the per-user vs shop-wide split (last-writer-wins on avatar/greeting/default-view, non-admin write rejection) — deferred with the item-15 `app_settings` work; the PIN plaintext leak itself is closed.
`SettingsContext.commit()` upserts the entire settings object — including `lockPin`, avatar, greeting, default view — into a single global `app_settings` row `'ui_settings'`. Consequences: (a) every authenticated user can *read* the lock PIN via the table's read-all policy; (b) last-writer-wins — one workstation's personal prefs overwrite everyone's; (c) `app_settings` is admin-write-only, so non-admin saves silently fail (error ignored) and settings quietly stop syncing. **Fix:** split per-user prefs (keyed by user, or local-only) from shop-wide config; never persist the PIN server-side in plaintext (store a hash, or keep it strictly local); check the upsert result.

### 9. ✅ DONE — Hardcoded admin fallback for username `dturk`
**Fixed:** removed; `role` now derives solely from the authenticated profile (`currentUser?.role || 'workers'`).
`App.tsx:64`: `role = currentUser?.role || (username === 'dturk' ? 'admin' : 'workers')`. A username-based privilege default is a backdoor pattern — harmless server-side (RLS still applies) but it grants the full admin UI and will confuse a future audit. Remove it.

### 10. ✅ PARTIAL — Machine-overlap alert still uses the pre-fix naive comparison
**Fixed (client):** the App.tsx notification bell and `Dashboard.tsx` now use `cpm.getJobConflicts(...).machineOverlap`, matching the Gantt/board (routed chains + per-operation windows). **Still open (server):** `validate_job_assignment` trigger — documented as a known limitation in `schema.sql`; a real fix needs the item-13 `job_operations` table, so DB-side enforcement for routed work is intentionally deferred.
The notification bell (`App.tsx:155–158`) and the Dashboard (`Dashboard.tsx:44–47`) detect machine conflicts by exact `job.machine === candidate.machine` string equality — precisely the bug fixed in `cpm.getJobConflicts()` for routing chains ("Tokarilica-1 → CNC-2") and per-operation windows. The bell can say "operations are stable" while the Gantt shows red conflicts. **Fix:** reuse `getJobConflicts`/`machineIntervals` from `cpm.ts` in both places. Same story server-side: the `validate_job_assignment` trigger compares `machine` by exact string and sees only the zero-duration parent window of routed orders, so the DB-level double-booking guard doesn't protect routed work at all.

### 11. ✅ DONE — Admin JSON backup exports the wrong keys (backs up nothing)
**Fixed:** `Admin.tsx` now delegates to `SettingsContext.exportBackup()`/`importBackup()`, which back up every non-`sb-` localStorage key. The dead hardcoded key list is gone.
`Admin.tsx handleExportBackup()` reads `dravaint-shift-schedule`, `dravaint-machines`, `dravaint-roles`, `dravaint-users-fallback`, `dravaint-schedule` — none of which exist. Actual keys are `dravaint-shifts-v2`, `dravaint-machines-fallback`, `dravaint-roles-fallback`, `dravaint-offline-users-v2`, `dravaint-jobs-fallback`. The exported file is a JSON of nulls; anyone relying on it for recovery has no backup. **Fix:** delete this duplicate — `SettingsContext.exportBackup()` already exports all non-`sb-` localStorage correctly — and point the Admin button at it.

### 12. ✅ PARTIAL — CI/deploy hygiene
- ✅ **Fixed:** `actions/setup-node` bumped to Node 22 in `.github/workflows/deploy.yml` to match `package.json` engines.
- ⏳ **Left as-is intentionally:** the workflow still auto-deploys the working branch — it's the active dev/PR branch, so restricting to `main` now would stop deploying current work. Do this once the branch merges/stabilizes.

---

## NEXT — structural fixes that make the app dependable

### 13. Identity by display-name string is the root fragility of the data model
Machines and operators are matched by free-text names everywhere: `job.machine` holds either a name or a chain string `"A → B"` parsed with `split('→')` (two different separators are used: `'→'` in `cpm.ts`, `' → '` in `capacity.ts`/`GanttChart.tsx` — a chain without spaces silently double-counts); operators are matched by `firstName + lastName` equality (`cpm.findWorker`), even though `operatorId` and `jobs.machine_id` / `worker_qualifications` exist in the schema but go unused. Renaming a worker or machine silently detaches history, conflicts, and qualifications; two workers with the same display name collide.
**Plan:** (a) make `operatorId` (and a real `machineId` per operation) the join key, keeping names as display only; (b) model routed operations as rows (`job_operations` table) instead of a JSONB blob + magic zero-duration parent window; (c) normalize the chain separator immediately as a stopgap. This unlocks correct DB-side overlap checks (#10) too.

### 14. Conflict engine reads localStorage instead of app state
`getJobConflicts()` and friends (`cpm.ts:299–463`) load workers, absences, shift schedules, and `cfg-max-hours` by parsing localStorage on **every call**. It works only because the contexts happen to persist their caches there; it's untestable without seeding storage, re-parses JSON in hot paths, and can read stale data mid-session (e.g., an absence added on another tab). **Fix:** pass workers/absences/shifts/settings in as parameters (the callers all have the contexts in scope); keep a thin adapter for the two tests that seed storage.

### 15. Shop-wide labor rules are per-browser
`cfg-max-hours`, `cfg-shift-hours`, `cfg-bottleneck-hours` (Admin → System) live in localStorage only, while `app_settings` already seeds `max_weekly_hours`, `minimum_rest_hours`, etc. server-side — unused. Two terminals can enforce different weekly-hour limits and capacity thresholds on the same schedule. Read these from `app_settings` (with the localStorage value as offline fallback), and write them there from Admin.

### 16. Shift schedule persistence: race + ID divergence
`ShiftsContext.saveSchedule()` optimistically assigns a local id (`max+1`), then inserts remotely (getting a *different* id), deletes all non-override assignments, and re-upserts — non-transactionally. Until the next realtime refetch, local state carries wrong ids; two planners saving the same week interleave delete/upsert and can lose overrides; errors from any step are ignored. **Fix:** wrap in an RPC (single transaction, returns canonical row + assignments), reconcile local state from its result, and surface version conflicts like jobs do. *(Coordinate with the in-progress publish feature — it calls `saveSchedule` on publish.)*
Also *(in progress, acknowledged in code)*: publication snapshots are localStorage-only. They're the payroll-grade audit trail — they need an append-only `shift_publications` table or they vanish with browser storage and never reach other terminals.

### 17. Unfinished features visible to users — finish or cut
- **CAD upload** (`WorkOrderCreator`): validates and displays the chosen file, then discards it — nothing is uploaded or attached to the order. Wire it to Supabase Storage (bucket + `job_attachments` table) or remove the control.
- **Fake barcode/QR** on the printed work order: hardcoded decorative SVGs that don't encode the order number. On a real shop floor someone *will* try to scan them. Generate a real Code128/QR (tiny pure-JS libs exist) or drop them from the print.
- **ICS export button** in the shift-board footer exports only `activeWorkers[0]` — a placeholder. Offer a per-worker picker (or per-row action), and surface the existing `shift-calendar` Edge Function subscription URL, which is strictly better than one-off files.
- **Snapshot "View" action** *(in progress)*: `viewingSnapshot` is set but never rendered (the lint warning) — presumably the other session's modal is coming.

### 18. Destructive actions without confirmation
`ProgressMonitoring` deletes a work order on a single click of the red trash button (list and board views), with no confirm and no undo surface outside the Gantt's history. Same for role/machine/worker deletes in Admin. Add a lightweight confirm (or an "Undo" toast window — the soft-delete backend makes restore easy, but no UI exposes it).

### 19. Timezone and date-boundary correctness
Date logic mixes local-time `datetime-local` strings with `toISOString()` (UTC) date extraction: `ShiftSchedule.isoDate()`, `cpm.getMonday()`, `App.tsx`'s `today`. In Croatia (UTC+1/+2), between 22:00 and midnight UTC-derived "today"/"Monday" are off by one day — absence checks, week snapping, and rest-period calculations can shift a day at exactly the hours a night shift is running. Consolidate on one local-date helper (you already have `toLocalDateTimeString`) and add regression tests around midnight/DST.

### 20. i18n: one system, not two
`translations.ts` exists, but ~250 inline `lang === 'hr' ? … : …` ternaries bypass it (52 in `ShiftSchedule` alone), and `cpm.ts` conflict messages are hardcoded Croatian — English users see mixed-language warnings. Move user-facing strings into the translation table (conflict messages should return codes + params, rendered by the UI layer). This also shrinks page components noticeably.

### 21. Test the risky seams, not just the math
Current 70 tests cover scheduling math, board geometry, and the PDF — good. Nothing covers: the offline queue (enqueue/flush/conflict), `ShiftsContext` save/publish flows, `SchedulingContext` version-conflict paths, role-based route gating, or RLS (Supabase offers pgTAP / policy tests). Priorities: offline queue replay (#6) and `saveSchedule` (#16) before refactoring them, then a smoke e2e (Playwright) for login → create order → see it on the board.

---

## LATER — polish, performance, and scale

### 22. Performance headroom (fine today at ~60 jobs, worth watching)
- `App.tsx` runs CPM + machine loads + an O(n²) conflict scan on **every shell render** for the alert bell. Memoize on `jobs`/settings, or compute in the pages that show it.
- `getJobConflicts` is O(n²) per job and re-parses localStorage each call (see #14); Gantt/board call it per visible row.
- Realtime handlers refetch entire tables (`select *`) on any single-row change, and `ShiftsContext` refetches four tables on any shift event. Switch to applying the change payload, or at least debounce.
- `WorkOrderCreator`'s auto "Time Machine" snapshot stringifies the whole jobs array on every change and keeps 30 copies in localStorage — with realistic data this approaches the ~5 MB quota, and a quota exception in that effect is uncaught. Cap by size, wrap in try/catch, or move snapshots to IndexedDB.

### 23. Accessibility pass
Drag-and-drop (shift board, machine board, Gantt) has no keyboard path except the shift board's double-click reassign; status/priority communicated by color chips alone in several tables; modals (`ProgressMonitoring` detail, `SettingsModal`) don't trap focus or handle Escape consistently; icon-only buttons in the board toolbar lack labels in places (nav is decent — `aria-label`s exist). Run an axe audit, add keyboard alternatives for every drag interaction, and give status pills a text/shape cue. For a terminal used with gloves on a shop floor, also revisit hit-target sizes in compact mode.

### 24. PWA/offline coherence
- `index.html` loads Inter/Outfit from Google Fonts — the "offline-capable" terminal loses its fonts offline, and it's a third-party call from a company app. Self-host the two families (you already embed Tinos for the PDF).
- `sw.js` caches every same-origin GET forever in one cache; old hashed bundles accumulate until the cache name bumps. Add size/age pruning or precache-manifest versioning.
- The demo/fallback mode stores plaintext passwords in localStorage (`dravaint-offline-users-v2`). README says demo-only — consider hashing anyway (SubtleCrypto) so a demo deployment that drifts into real use isn't storing credentials in the clear.

### 25. UX opportunities that would genuinely help daily planning
- **A "today / my shift" operator view:** workers currently land on the same planner UI as managers. A read-optimized screen — my assignments today, my machine's queue in priority order, one-tap progress/status — fits the RLS `worker_progress_update` policy that already exists (note: that policy currently lets an operator edit *any* column of their own job, including times; column-restrict it alongside this).
- **Conflict panel instead of scattered warnings:** conflicts surface as per-row icons and a generic bell alert. A single "problems this week" list (double-bookings, unqualified, rest violations, overdue, material waits) with jump-to-fix links would match how a planner actually works through exceptions. All the detection logic already exists in `cpm.ts`.
- **Dashboard honesty:** the capacity heatmap pads with fake machines (`'Glodalica-2'`) when empty, and the routing map shows demo operations when no order is selected — show real empty states instead; a supervisor glancing at a wallboard must be able to trust it.
- **Machine registry as the single source:** `MachineSchedule` uses the registry dropdown but `WorkOrderCreator` operations take free-text machine names (typos create phantom machines in every capacity view). Use a datalist/select from `MachinesContext` (its type label also mislabels saw/QA/other as "lathe" in the dropdown).
- **Undo/redo beyond Gantt:** the machine board has its own undo; shift board and progress page have none. A shared command-history on top of `restoreBackup` would cover all three.

### 26. Code-quality cleanups (low urgency, high leverage while doing the above)
- `GanttChart.tsx` (1,317 lines) and `ShiftSchedule.tsx` mix data logic and view; extract hooks (`useGanttData`, `useShiftBoard`) — this also makes #14's parameter-passing natural.
- Duplicated helpers: ISO-week/Monday logic exists in three places (`cpm.getMonday`, `capacity.weekWindow`, `ShiftSchedule.mondayOf/getIsoWeek`); CSV/ICS download-blob boilerplate ×3; pad/format-date helpers ×4. Consolidate into `src/lib/`.
- The role string `'level between admin and managers'` is load-bearing in schema constraints, RLS, and `canAccess` — rename to a real slug (`planner`?) with a migration before more code depends on it.
- Heavy inline `style={{…}}` objects across pages fight the otherwise clean CSS-variable system in `App.css`; move to classes as pages get touched.
- `dist/` exists locally in the repo root; confirm it stays ignored (it is in `.gitignore`) and out of commits.

---

## Suggested sequencing

| Order | Items | Why first |
|---|---|---|
| 1 | #1, #2, #5, #7 | Broken persistence in prod mode, data exposure, lockout — all user-visible failures |
| 2 | #3, #4, #8, #9, #11, #12 | Security/privacy + backup/deploy correctness, all small diffs |
| 3 | #6, #10, #16 (+ tests from #21) | Sync integrity and conflict-detection consistency |
| 4 | #13, #14, #15, #19 | Data-model and architecture — do once, everything above gets simpler |
| 5 | #17, #18, #20 | Finish/cut half-features, confirmations, i18n |
| 6 | #22–#26 | Performance, a11y, PWA, UX opportunities, refactors |
