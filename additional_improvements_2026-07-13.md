# DravaInt — Beyond 150 Product Roadmap

Visual review date: 2026-07-13  
Baseline reviewed at: 1280 × 720 and compact desktop mode

## Product direction

The original 150-point plan established a complete workshop operating system. This next phase focuses on making that system faster to operate during a real shift: less navigation overhead, clearer exceptions, resilient offline behavior, and a more disciplined information hierarchy.

## Phase 7 — Command and awareness layer (Points 151–160)

- [x] 151. Replace the wrapping desktop header with a single-row command bar.
- [x] 152. Add responsive icon-only navigation before the drawer breakpoint.
- [x] 153. Add an application-wide command palette with keyboard navigation.
- [x] 154. Add `Ctrl/Cmd + K` as the universal command shortcut.
- [x] 155. Add an operational notification center derived from live work-order and staffing data.
- [x] 156. Persist read notification state locally per workstation.
- [x] 157. Add visible online/offline state to the application chrome.
- [x] 158. Add dashboard quick actions for the most common planning flows.
- [x] 159. Add keyboard shortcut discoverability in the command palette and header.
- [x] 160. Add a global recovery boundary so a failed module cannot blank the workstation.

## Phase 8 — Planning workspace refinement (Points 161–170)

- [x] 161. Collapse advanced Gantt creation and dependency controls by default.
- [x] 162. Keep search, auto-schedule, undo/redo, export, and view controls above the fold.
- [x] 163. Persist the Gantt planning-tools disclosure state locally.
- [x] 164. Add a compact planning-tools summary showing jobs, dependencies, and baseline state.
- [x] 165. Restyle CAD, logo, and backup file inputs as premium upload surfaces.
- [x] 166. Add saved Gantt filter presets per operator.
- [ ] 167. Add a compare-scenarios mode for alternate machine allocations.
- [ ] 168. Add an approval gate before publishing a materially changed baseline.
- [ ] 169. Add a minimap for very long multi-machine Gantt timelines.
- [ ] 170. Add shift-to-Gantt capacity overlays.

## Phase 9 — Daily operations (Points 171–180)

- [ ] 171. Add a shift handover log with unresolved items and owner assignment.
- [ ] 172. Add downtime reason tracking with MTTR and MTBF summaries.
- [ ] 173. Add a material shortage board linked to affected work orders.
- [ ] 174. Add quality holds and non-conformance records.
- [ ] 175. Add maintenance checklists with machine-specific templates.
- [ ] 176. Add operator kiosk mode with oversized touch targets.
- [ ] 177. Add barcode/QR work-order lookup.
- [ ] 178. Add a live “next operation” queue per machine.
- [ ] 179. Add production target versus actual by shift.
- [ ] 180. Add an end-of-shift digest export.

## Phase 10 — Reliability and intelligence (Points 181–190)

- [x] 181. Surface the exact number of pending offline mutations.
- [x] 182. Add manual retry and discard-based conflict resolution for queued mutations.
- [x] 183. Add an admin diagnostics page for sync, storage, and service-worker health.
- [ ] 184. Add audit history for critical schedule and role changes.
- [ ] 185. Add automated backup rotation and restore-point labels.
- [ ] 186. Add demand-based capacity forecasting.
- [ ] 187. Add schedule-risk scoring based on dependencies, materials, and staffing.
- [ ] 188. Add suggested operator substitutions based on qualifications.
- [x] 189. Add configurable alert thresholds in Settings.
- [ ] 190. Add an optional morning briefing view for supervisors.

## Visual review findings

- The dashboard cards, Settings dialog, glass surfaces, color system, and lock screen already meet the premium visual target.
- The former multi-row top navigation consumed too much vertical space and was the primary visual defect.
- Gantt controls placed advanced editing ahead of the schedule itself, reducing at-a-glance usefulness.
- Native browser upload fields broke the visual language in Admin and Work Orders.
- The app needed a persistent command and exception layer so operators can act without hunting through modules.

## Batch status — 2026-07-13

- ✅ Points 151–166, 181–183, and 189 implemented after two full screenshot/interaction audit passes.
- ⏭️ Remaining open points are prioritized future work; Phase 9 should follow after production feedback on the command, alert, and diagnostics layers.
