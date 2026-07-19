# Changelog

## 2026-07-19 — Machine scheduling Phase D: operations as rows + DB overlap enforcement

- New `public.job_operations` table (one row per routed operation), a **derived mirror** of the
  `jobs.operations` JSONB kept in sync by a `SECURITY DEFINER` trigger — the JSONB stays the client
  write format, so every existing write path dual-writes both copies atomically with no client change.
- `validate_job_assignment` extended to expand routed jobs into sequential per-machine windows and
  detect operation-level double-booking (the gap where routed work was invisible to the DB). Rolls out
  **warn-first** (`app_settings.job_operations_overlap_enforcement` = `"warn"`, logs to `audit_logs`)
  and flips to `"enforce"` (rejects with errcode `DR001`) when ready.
- Migration `supabase/migrations/0008_*`, TS mirror `src/scheduling/jobOperations.ts` (+ tests),
  and read-only checksum/overlap preview `scripts/verify-job-operations.mjs`. Not yet applied to
  production — see `MACHINE_OPERATIONS_ROLLOUT.md`.

## 2026-07-14 — Batch 2: board power features + alert controls

- Machine board: saved views (zoom/sort/filter presets), PNG export for shift handovers,
  "jump to conflict" navigation, and bulk Finish-to-Start chaining of selected cards.
- Alert center: separate mute toggles for delay and capacity alerts (Settings → Alerts).
- Kiosk mode toggle: ≥44px touch targets for shop-floor terminals.
- Work orders: search across number/product/operations, one-click duplicate of an existing
  route into the creation form.
- Administration: per-account last-login timestamps on this workstation.
- Typography/spacing consolidation: two font weights (600/700), gap values on the
  4/8/12/16/20/24 scale, decorative letter-spacing removed from small labels.

## 2026-07-14 — Flat theme cleanup + operations batch

### UI/UX cleanup (from `ui_ux_cleanup_100.md`)
- Replaced the "premium SaaS demo" styling with a flat, clean theme: **0 gradients** (was 25),
  **4 light overlay scrims** (was 15 backdrop blurs), **3 functional keyframes** (was 7+),
  no glow/drop-shadow effects, no hover-lift transforms.
- Introduced design tokens in `src/index.css`: z-index scale (`--z-*`), radius scale
  (`--radius-sm/inner/card/pill`), motion tokens (`--transition-fast/base`), flat shadows.
- Every global overlay (nav, drawer, modals, palette, lock screen, toasts) now sits on the
  documented z-scale — removed the 0–20000 ad-hoc stacking.
- Raised the micro-typography floor from 7px to 10–11px across the app.
- Fixed undefined `--bg-main` variable (auth screen, Gantt fullscreen/export backgrounds).
- Removed duplicated lock-screen CSS block and dead `.login-page` styles; ProgressMonitoring's
  detail dialog now uses the shared modal component classes.
- Unified status colors across the board, Gantt, and legends to the theme tokens; dark mode
  audited after flattening.
- Machine board: connect handles moved fully outside card edges (resize strips were
  unreachable), conflict popover can no longer render off-screen, keyboard focus ring added.
- `prefers-reduced-motion` now disables all non-essential animation.

### Functionality (from `functionality_improvements_100.md`)
- Machine board: status filter chips, auto-schedule button (same greedy scheduler as the Gantt
  page), CSV export, arrow-key nudge for selected cards, undo/redo depth indicators,
  double-click empty lane space to prefill the add-job form.
- Weekly machine-capacity threshold is now the admin-configurable "bottleneck hours" value
  instead of a hardcoded 40h (dashboard heatmap, alert center, board lane meters).
- Jobs are soft-deleted (`deleted_at`) in Supabase mode, preserving audit history and
  dependency references.
- Scheduling data refetches when the terminal regains focus (drift reconciliation), and the
  offline queue retries on an exponential backoff (30s → 8min) instead of only on reconnect.
- Link-drawing validation extracted to a pure `classifyLinkCandidate` function with unit tests
  (self/duplicate/cycle/transitive-cycle cases) plus board lane-stacking tests.

## Earlier
- See `walkthrough.md`, `additional_improvements_2026-07-13.md`, and the git history for the
  150-point plan, the command layer, and the drag-and-drop Machine Scheduling board.
