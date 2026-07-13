# DravaInt walkthrough

## 2026-07-13 — production completion pass

### Compile and architecture

- Corrected the JSX/TSX structure in `WorkOrderCreator.tsx` and `Admin.tsx`; Vite now parses every page cleanly.
- Added lazy page loading, React Router hash routes, centralized role guards, a 403 notification, TanStack Query caching for profiles/roles, realtime refresh, and IndexedDB-backed offline mutation recovery.
- Added an installable PWA manifest and service worker. Production assets and the application shell are cached for resilient workshop-terminal startup.

### Workforce and shifts

- Added shared `WorkersContext` and `ShiftsContext` data layers with Supabase/local fallback, realtime updates, normalized worker profiles, qualifications, account links, lifecycle/status controls, schedules, assignments, absences, and shift definitions.
- Rebuilt `ShiftSchedule.tsx` as an interactive multi-week planning board: department selection, participant cards, database RPC generation, preserved overrides, absence exclusion, drag/drop, pre-drop conflict feedback, double-click reassignment, weekly-hours/rest warnings, draft save, publish/version status, CSV, ICS, and themed print controls.
- Expanded Administration with worker directory editing, qualifications, account linking, live status, archive/reactivate actions, and soft role deactivation.

### Work orders, dashboard, and Gantt

- Separated product and operator fields, added qualification-aware operator selectors, comments, setup hours, material status, route overlap feedback, product printing, and optimistic job versions.
- Added operator allocation and shift-balance cards to the dashboard.
- Upgraded CPM to exact FS/SS/FF/SF forward/backward logic with concrete cycle reporting, configurable critical tolerance, holidays, working boundaries, weekends, and tested slack calculations.
- Upgraded the Gantt workspace with synchronized machine scrolling and one primary timeline header; custom dependency curves and related-path hover glow; drag/resize/progress callbacks; debounced recursive propagation; machine overlap zones; active textures; setup segmentation; operator/material badges; weekend and exact-today overlays; operation drag reordering; hierarchy persistence; multi-select; undo/redo; baselines; critical toggle; search; zoom presets; machine sorting/efficiency; skeletons; empty lanes; edit modal; auto-scheduling; snap rules; full-screen; and dynamic PNG/PDF export.

### Settings, security, and lock screen

- Added a searchable, focus-trapped, four-tab Settings modal with HR/EN, system/dark/light theme, landing page, compact mode, Gantt sizing, role timeouts, PIN, active lock window, blur lock, import/export/reset, workday and holiday controls, critical tolerance, wallpaper, greeting, logo, and avatar settings.
- Added local and Supabase settings persistence plus a reusable inactivity hook with role resolution, session lock state, Gantt-drag suspension, 30-second dimming, pre-lock countdown, keep-alive, and audio warning.
- Added the unified premium lock screen with SVG branding, shift clock/progress ring, operator banner, custom message/wallpaper, physical and virtual keypad, haptics, visibility control, failed-attempt cooldown, unlock animation, emergency logout, and a manual-lock top-bar action.

### Backend and verification

- Replaced the legacy schema with production Supabase tables, relationships, indexes, Auth/profile triggers, role claims, strict RLS, soft deletion, audit triggers, optimistic versions, machine/operator overlap validation, schedule notifications, scheduling RPC, load-metric views, and realtime publication.
- Added `admin-users` and `shift-calendar` Edge Functions plus safe environment and deployment documentation.
- Added Vitest/jsdom coverage for authentication password policy and CPM relation types, cycles, critical/slack results, weekends, and holidays.
- Verification completed: lint has zero findings, all 5 automated tests pass, TypeScript and the optimized production build succeed, and live in-app browser testing covered login, dashboard, settings, shifts, Gantt, manual lock/unlock, dark-mode palette, and runtime console errors.

### Visual QA captures

- Live browser captures were reviewed for the dashboard, Settings modal, shift planner, enhanced Gantt lane, and lock screen.

## 2026-07-13 — beyond-150 command and visual refinement

### Visual assessment and iteration

- Captured baseline images of Dashboard, Administration, Work Orders, Settings, Gantt, and Shifts at 1280 × 720 in `docs/screenshots/`.
- Identified the wrapping header as the most significant visual defect: it consumed roughly one third of the first viewport and pushed operational content below the fold.
- Replaced it with a 62 px single-row command bar, responsive icon navigation, correctly themed profile control, live connection state, command search, and notification badge.
- Re-captured Dashboard, Admin, Work Orders, Gantt, the command palette, and the alert center. The final dashboard exposes substantially more content above the fold while keeping the existing premium dark/glass style.
- A second review caught and fixed a native white comments input, alert-panel persistence across route changes, and an inconsistency between the dashboard focus message and live schedule alerts.

### New operational features (Points 151–165 and 181)

- Added a keyboard-driven command palette (`Ctrl/Cmd + K`) with fuzzy module/action search, arrow-key selection, shortcut hints, navigation, settings, and lock actions.
- Added a live operational alert center for delayed work, material risk, machine overlap, staff absence, offline state, and pending sync changes; read state persists per workstation.
- Added a precise IndexedDB queue counter and online/offline state in the header.
- Added Dashboard “Today’s focus” and one-click New Order, Shift Plan, and Gantt actions.
- Added a module error boundary with safe dashboard recovery and full-app reload actions.
- Collapsed advanced Gantt task/dependency/baseline controls behind a persistent planning-workshop disclosure, moving the actual chart into the first viewport.
- Replaced native CAD, company-logo, and backup file controls with consistent premium upload surfaces.
- Added `CommandLayer.test.tsx` coverage for command filtering/execution, alert navigation, persisted read state behavior, and route-change closing.

### Screenshot set

- Before: `dashboard-before.png`, `admin-before.png`, `work-orders-before.png`, `gantt-before.png`, `shifts-before.png`, and `settings-before.png`.
- Final: `dashboard-final.png`, `work-orders-final.png`, `admin-after.png`, `gantt-after.png`, `command-palette-after.png`, and `alerts-after.png`.

### Verification

- `npm run check` passes: zero lint findings, 4 test files / 9 tests passing, TypeScript compilation successful, and optimized Vite production build successful.
- Live browser verification covered command search/navigation, notification display, route-change dismissal, Gantt planning-tools expand/collapse, Dashboard quick actions, and the restyled upload surfaces.

## 2026-07-13 — operations-readiness continuation

### Planning views and alert governance

- Added per-operator saved Gantt views for search text, machine sorting, critical-path highlighting, and zoom level. Views can be created, applied, deleted, and persist through navigation in local storage.
- Added a dedicated Settings “Alerts” tab with delay grace period, weekly machine-capacity threshold, and toggles for material, machine-conflict, and operator-absence alerts.
- Alert rules apply immediately to the top-bar alert center and Dashboard focus summary.
- Added a shared operation-aware capacity calculator so Dashboard heatmaps and alert thresholds use the same machine names and hours. Detailed operation hours take priority; undetailed routed duration is distributed across its machines.

### Recovery and diagnostics

- Expanded the IndexedDB mutation queue with exact queue inspection, public count/item APIs, last synchronization error details, manual retry, and selective discard for a rejected or obsolete change.
- Added the Admin System Health console showing connection mode, pending mutation count, browser storage usage/quota, PWA service-worker state, the latest sync error, and individual queued operations.
- Retry is safely disabled while offline, in local-preview mode, or when the queue is already empty.

### Verification and captures

- Added capacity calculation tests for operation-detail and routed-duration cases; the suite now passes 9/9 tests across 4 files.
- Browser QA verified live alert threshold changes, saved-view creation/application/persistence, diagnostics refresh/empty state, unified capacity totals, and responsive glass styling.

## 2026-07-13 — Machine Scheduling board overhaul

### Custom drag-and-drop board (`src/components/machine-board/`, `src/pages/MachineSchedule.tsx`)

- Replaced the Machine Scheduling page's static add-job form + table with a bespoke, from-scratch timeline board (no external Gantt library) rendering one lane per machine and one absolutely-positioned card per work order, with overlap-aware row stacking within a lane.
- Whole-card pointer drag reschedules a job (snapped to the nearest shift boundary) and, if dropped on a different lane, reassigns its machine — both from a single gesture. Left/right edge handles resize a card's start or end independently.
- New interactive dependency-drawing gesture: dragging from a card's edge handle to another card draws a live connector that classifies as valid/self-link/duplicate/cycle in real time (cycle detection reused from `findDependencyCycle`) and commits an FS/SS/FF/SF link on drop, inferred from which edges were used. Committed connectors are selectable (click to edit type/lag or delete). A toolbar "connect mode" offers a tap-source-then-tap-target fallback for touch/precision use.
- Multi-select group drag, undo/redo (now persisting to Supabase via a hardened `restoreBackup`, not just local state), and a toast for version-conflict/server-rejected writes round out the interaction set.
- Every mutation writes through the same `updateJob`/`SchedulingContext` every other page reads from, so a connection or reschedule made here shows up on the Gantt Chart, Dashboard capacity view, and conflict badges immediately with no extra plumbing.

### Hardening carried out alongside the new page

- Fixed a silent optimistic-lock failure in `SchedulingContext.updateJob`: a lost version-conflict race now surfaces to the UI instead of no-op'ing.
- Gave the database's machine/operator double-booking trigger a stable error code so a genuine conflict is shown to the user instead of being retried forever through the offline queue.
- Extracted a shared, working-hours-aware `cascadeDependents` in `cpm.ts` and switched the Gantt Chart's drag-cascade to use it, removing a drift where its own hand-rolled cascade math could disagree with the CPM engine driving the visible schedule.
- `calculateMachineLoads` now accepts the CPM-effective schedule, so the Dashboard capacity heatmap reflects a dependency cascade immediately rather than only after a follow-up write.

### Verification

- `npm run check`-equivalent passes: oxlint clean, `tsc -b` (the actual project-reference build, not a bare `tsc --noEmit`) clean, Vitest 20/20 across 6 files (including a new `MachineBoard` render regression test and unit tests for the new geometry/cascade/capacity functions), and `vite build` succeeds.
- Live browser QA (dispatched real `PointerEvent`s against a running dev server) confirmed: drag-to-reschedule with correct shift-boundary snapping and dependency cascade, cross-machine drag reassignment, resize, connection creation with correct FS/SS/FF/SF inference, connection deletion, cycle-attempt rejection, undo actually persisting, and the new dependency appearing on the Gantt Chart page without any manual sync step.
- New captures: `alert-settings-after.png`, `gantt-saved-view-final.png`, `system-diagnostics-after.png`, and `dashboard-capacity-final.png` in `docs/screenshots/`.
