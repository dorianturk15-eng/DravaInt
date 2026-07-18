# Prerelease Cleanup Plan — Drava Planner

*Audit date: 2026-07-18. Scope: dead code, debug artifacts, duplication, orphaned files,
line-ending artifact, consistency. **No functional behavior changes** — cleanup/consolidation only.*

## Baseline (before any change)

- `npm run lint` (oxlint) — **clean, 0 warnings**
- `npx tsc -b` — **exit 0** (`noUnusedLocals` + `noUnusedParameters` are on, so unused imports/locals
  are already impossible — confirmed none exist)
- `npm test` (vitest) — **18 files, 80 tests passing**
- `npm run build` — to confirm during execution

The codebase is already in good shape (strict TS + oxlint keep it tidy). The audit surfaced a **small,
targeted** set of genuinely-dead symbols plus one repo-hygiene artifact. Most "candidates" turned out to
be legitimately used and are deliberately left alone (documented below).

---

## Findings & actions, prioritized

### P0 — Repo hygiene: package.json line-ending artifact

- **Cause:** No `.gitattributes`; `core.autocrlf=true`. Git stores blobs as LF but the working tree has
  CRLF for 16 tracked text files. `package.json` shows a persistent phantom `M` (empty `git diff`) —
  a stat-cache artifact. `git add --renormalize package.json` confirms there is **no real content diff**.
- **Action:** Add a `.gitattributes` with `* text=auto eol=lf` and run a one-time `git add --renormalize .`.
  This resolves the phantom **and prevents recurrence** for every contributor. The resulting diff is
  EOL-only (verified with `git diff --stat`); no source content changes.
- **Verify:** lint + test + build all still green (EOL changes can't affect runtime).

### P1 — Dead code removal (referenced nowhere: not internally, not externally, not in tests)

Verified by whole-word grep across all of `src` (including test files), excluding only the defining file,
**and** an internal-reference count within the defining file. These four have zero references anywhere.

1. **`getWorkerQualifications`** — `src/scheduling/cpm.ts`. Never called. `getJobConflicts` computes
   qualifications inline from `worker.qualifications`; this standalone helper was superseded and left behind.
   Its dependencies (`findWorker`, `loadWorkerRecords`) stay — used elsewhere in the file.
2. **`isContainerNode`** — `src/scheduling/hierarchy.ts`. Never called. Thin wrapper over `hasChildren`
   (which *is* used); the wrapper never got wired up.
3. **`isJobAtRisk`** — `src/scheduling/status.ts`. Never called. Speculative companion to `isJobOverdue`
   (which *is* used for the lateness auto-flag). *Flagged:* this looks like intended-future-use ("at risk"
   look-ahead). Removing per "lean toward removing genuinely dead code"; trivially restorable from git if
   the feature lands.
4. **`MachineBoardController`** (`export type … = ReturnType<typeof useMachineBoardController>`) —
   `src/components/machine-board/useMachineBoardController.ts:711`. Convenience alias referenced nowhere;
   consumers use the inferred hook return type directly.

### P2 — Narrow over-exported internal-only helpers (drop `export`, keep the code)

Used **only inside their own file** (grep-verified: 0 external refs incl. tests). Not dead — just wider
visibility than warranted. Narrowing reduces the module's public surface for prerelease. No behavior change.

5. **`calculateWeeklyHours`**, **`checkShiftScheduleConflict`** — `src/scheduling/cpm.ts`. Used only by
   `getJobConflicts` in the same file.
6. **`getChildren`** — `src/scheduling/hierarchy.ts`. Used only within `hierarchy.ts`
   (`computeJobRange`, `buildGanttTasks`). Sibling `hasChildren` is the externally-used one.

---

## Considered and deliberately LEFT ALONE (with rationale)

- **Over-exported *types in exported signatures* / context value types** — `StoredUser`, `recordLogin`,
  `RoleWriteResult`, `BoardJob`, `Point`, `CardRect`, `TimeTick`, `WeekWindow`, `OperationSchedule`,
  `GanttBuildOptions`, `PublishMeta`, `WorkerStatus`, `Toast`, `MachineBoardControllerOptions`,
  `DEFAULT_SETTINGS`, `WEEKLY_CAPACITY_HOURS`, `PRIORITY_META`. Each is genuinely *used* (as a public
  function's parameter/return type, or internally). Exporting a type that appears in an exported
  signature is idiomatic, not dead code. Narrowing these adds churn and risk for no benefit.
- **`computeOperationSchedule` (hierarchy.ts) vs `operationIntervals` (cpm.ts)** — near-duplicate layout
  logic, but the duplication is **intentional and documented** in `cpm.ts` ("kept local to avoid a
  cpm ↔ hierarchy import cycle"). Consolidating would reintroduce the cycle. Leave.
- **`getMonday` (cpm.ts) vs `weekWindow` (capacity.ts)** — both do Monday-of-week math but return
  different shapes (ISO date string vs epoch-ms window) for different call sites. Minor overlap; merging
  is a refactor with behavior risk. Leave.
- **"Refetch after write" consistency** — audited all contexts:
  - Machines / Workers → explicit `await load…()` after each write ✓
  - Roles → react-query `invalidateQueries` after each write ✓
  - Scheduling → realtime channel + focus-refetch + optimistic ✓
  - **Shifts → optimistic local update + realtime-echo reconcile, with NO explicit refetch-after-write.**
    This is the one inconsistency, and given the noted unreliability of realtime echo it's a *latent*
    concern. **But converting it to explicit refetch is a behavior change, out of scope for a cleanup
    pass.** Flagged here for a separate follow-up rather than silently changed.
  - Settings / Logo → single-key `app_settings` upsert, optimistic ✓ (fine for a singleton row).
- **`FALLBACK_MACHINES` / demo fallback data** — intentional non-Supabase (demo/offline) mode data; not dead.
- **CSS pruning (`App.css`, 1598 lines)** — unused-rule detection is unreliable with dynamic class names;
  pruning risks visual regressions. Out of scope for a no-behavior-change pass.
- **Planning/backlog docs** — `IMPROVEMENTS_PLAN.md` (now stale: says 70 tests/1 warning; reality is
  80/0), `functionality_improvements_100.md` (78 open wishlist items), `ui_ux_cleanup_100.md`,
  `additional_improvements_2026-07-13.md`, `walkthrough.md`. These are the user's dev/backlog history,
  **not** unresolved items from today's work (they're forward-looking wishlists). Not deleting without
  the user's call; **recommend** archiving to `docs/` or removing. Flagged in final report.

## Confirmed clean (no action needed)

- No stray `console.log` / `debugger` (the 6 `console.warn`/`console.error` are legitimate error logging).
- No real `TODO`/`FIXME` (matches were UI `placeholder=` attributes).
- No commented-out code blocks.
- No orphaned modules — every non-test source file is imported somewhere.
- No backup/scratch files (`*.bak`/`*.orig`/`*.tmp`) in tracked tree.
- Dependency audit: all 8 runtime deps are imported (`html2canvas` via dynamic `import()`); no unused packages.

---

## Execution order (incremental commits, each verified with lint+test+build, auto-pushed)

1. `.gitattributes` + renormalize (P0).
2. Remove dead symbols (P1: items 1–4).
3. Narrow internal-only helpers (P2: items 5–6).

Final: full `npm run check` + in-browser smoke test (login, create work order, generate shift schedule,
publish, Gantt, PDF export).
