import { useMemo, useState } from 'react';
import type { ShiftDefinition, ShiftScheduleRecord } from './ShiftsContext';
import { dominantShift, isUniformWeek } from './rotation';

/**
 * The Rotation Board — the landing view for the shift planner.
 *
 * The unit of scheduling in this department is the **worker-week**, not the
 * worker-day: a worker holds one shift Monday to Friday and steps to the next
 * shift the following week. The day grid this replaces made that invisible —
 * rows were shift lanes and columns were days, so the same worker appeared five
 * times per week and the weekly pattern could only be read by scanning five
 * columns for a repeated name.
 *
 * Here rows are workers (split into the never-rotates group and the rotating
 * group) and columns are weeks, so the rotation's diagonal stairstep is visible
 * at a glance and "who rotates onto second next week?" is answerable by looking.
 *
 * Days remain the storage format and the exception mechanism: a week whose days
 * do not all share one shift renders as a split cell with per-day ticks, and
 * clicking any cell opens that week's day grid, where per-day drag/override
 * editing works exactly as before. No editing capability is removed.
 */

export interface RotationBoardWorker {
  id: number;
  name: string;
  initials: string;
  fixedShiftDefinitionId?: number | null;
}

export interface RotationBoardProps {
  weeks: ShiftScheduleRecord[];
  workers: RotationBoardWorker[];
  definitions: ShiftDefinition[];
  lang: 'hr' | 'en';
  /** Workday dates of a week, used to place the per-day exception ticks. */
  datesFor: (schedule: ShiftScheduleRecord) => string[];
  isAbsent: (workerId: number, date: string) => boolean;
  /** True when the worker's week breaches rest / weekly-hours rules. */
  hasWarning: (schedule: ShiftScheduleRecord, workerId: number) => boolean;
  /** Open the day grid for a week (the per-week detail editor). */
  onOpenWeek: (scheduleId: number) => void;
  /** Set a worker's shift for a whole week; `applyForward` extends it to the
   *  rest of the horizon. Null clears back to the generated rotation. */
  onSetWeekShift: (scheduleId: number, workerId: number, shiftDefinitionId: number, applyForward: boolean) => void;
  /** Toggle the never-rotates pin on a worker. */
  onTogglePin: (workerId: number, shiftDefinitionId: number | null) => void;
  readOnlyWeek: (schedule: ShiftScheduleRecord) => boolean;
}

const T = {
  hr: {
    fixedGroup: 'Stalna prva smjena',
    rotatingGroup: 'Rotacija',
    fixedHint: 'Ne rotira se',
    worker: 'Radnik',
    week: 'Tj.',
    empty: 'Nema generiranih tjedana — postavite raspon i pritisnite „Generiraj”.',
    noWorkers: 'Nema odabranih radnika u rasporedu.',
    off: 'Slobodno',
    split: 'Tjedan nije jedinstven — otvorite detalje tjedna',
    absent: 'Izostanak',
    pin: 'Pripni na stalnu smjenu',
    unpin: 'Vrati u rotaciju',
    openWeek: 'Otvori dane tjedna',
    warning: 'Prekoračenje sati ili odmora',
    help: 'Redak je radnik, stupac je tjedan. Kliknite ćeliju za promjenu smjene cijelog tjedna; kliknite broj tjedna za uređivanje po danima.',
    applyForward: 'Primijeni i na sve sljedeće tjedne',
  },
  en: {
    fixedGroup: 'Always first shift',
    rotatingGroup: 'Rotating',
    fixedHint: 'Does not rotate',
    worker: 'Worker',
    week: 'Wk',
    empty: 'No weeks generated yet — set a range and press “Generate”.',
    noWorkers: 'No workers selected for this schedule.',
    off: 'Off',
    split: 'Mixed week — open the week detail',
    absent: 'Absence',
    pin: 'Pin to a fixed shift',
    unpin: 'Return to rotation',
    openWeek: 'Open the week’s days',
    warning: 'Hours or rest-period breach',
    help: 'Rows are workers, columns are weeks. Click a cell to change a whole week; click a week number to edit it day by day.',
    applyForward: 'Apply to the rest of the horizon',
  },
} as const;

/** Short code for a shift — "1", "2" … matching the PDF legend's numbering. */
function shiftCode(definitions: ShiftDefinition[], id: number): string {
  const index = definitions.findIndex((d) => d.id === id);
  return index === -1 ? '?' : String(index + 1);
}

export function RotationBoard(props: RotationBoardProps) {
  const { weeks, workers, definitions, lang, datesFor, isAbsent, hasWarning } = props;
  const t = T[lang];
  // When set, a week-grain change also moves the worker for every later week —
  // "this worker is on second shift from week 31 onwards".
  const [applyForward, setApplyForward] = useState(false);
  const laneOrder = useMemo(() => definitions.map((d) => d.id), [definitions]);
  const definitionById = useMemo(() => new Map(definitions.map((d) => [d.id, d])), [definitions]);

  const groups = useMemo(() => {
    const fixed = workers.filter((w) => w.fixedShiftDefinitionId != null);
    const rotating = workers.filter((w) => w.fixedShiftDefinitionId == null);
    return [
      { key: 'fixed' as const, title: t.fixedGroup, hint: t.fixedHint, members: fixed },
      { key: 'rotating' as const, title: t.rotatingGroup, hint: '', members: rotating },
    ].filter((group) => group.members.length > 0);
  }, [workers, t]);

  if (weeks.length === 0) return <p className="rotation-empty">{t.empty}</p>;
  if (workers.length === 0) return <p className="rotation-empty">{t.noWorkers}</p>;

  return (
    <div className="rotation-board glass-panel">
      <div
        className="rotation-grid"
        style={{ '--rotation-columns': weeks.length } as React.CSSProperties}
        role="grid"
        aria-label={t.help}
      >
        <div className="rotation-corner">{t.worker}</div>
        {weeks.map((week) => (
          <button
            type="button"
            className="rotation-week-header"
            key={week.id}
            onClick={() => props.onOpenWeek(week.id)}
            title={t.openWeek}
          >
            <strong>{t.week} {week.weekNumber}</strong>
            <span>{week.startDate.slice(5)}</span>
          </button>
        ))}

        {groups.map((group) => [
          <div className="rotation-group-label" key={`group-${group.key}`} role="rowheader">
            <strong>{group.title}</strong>
            {group.hint && <small>{group.hint}</small>}
          </div>,
          ...weeks.map((week) => <div className="rotation-group-spacer" key={`spacer-${group.key}-${week.id}`} />),

          ...group.members.flatMap((worker) => [
            <div className="rotation-worker-label" key={`worker-${worker.id}`} role="rowheader">
              <span className="mini-avatar">{worker.initials}</span>
              <span className="rotation-worker-name">{worker.name}</span>
              <button
                type="button"
                className={`rotation-pin${worker.fixedShiftDefinitionId != null ? ' is-pinned' : ''}`}
                aria-pressed={worker.fixedShiftDefinitionId != null}
                title={worker.fixedShiftDefinitionId != null ? t.unpin : t.pin}
                onClick={() => props.onTogglePin(
                  worker.id,
                  worker.fixedShiftDefinitionId != null ? null : (definitions[0]?.id ?? null),
                )}
              >
                {worker.fixedShiftDefinitionId != null ? '1' : '○'}
              </button>
            </div>,

            ...weeks.map((week) => {
              const mine = week.assignments.filter((a) => a.workerId === worker.id);
              const shiftId = dominantShift(mine, worker.id, laneOrder);
              const uniform = isUniformWeek(mine, worker.id);
              const definition = shiftId == null ? null : definitionById.get(shiftId);
              const dates = datesFor(week);
              const locked = props.readOnlyWeek(week);
              const warning = hasWarning(week, worker.id);
              const key = `cell-${worker.id}-${week.id}`;

              if (!definition) {
                return (
                  <div className="rotation-cell is-off" key={key} role="gridcell">
                    <span className="rotation-off">{t.off}</span>
                  </div>
                );
              }

              const label = lang === 'hr' ? definition.nameHr : definition.nameEn;
              return (
                <div
                  key={key}
                  role="gridcell"
                  className={`rotation-cell${uniform ? '' : ' is-split'}${locked ? ' is-locked' : ''}${warning ? ' has-warning' : ''}`}
                  style={{ '--shift-color': definition.color } as React.CSSProperties}
                  title={`${worker.name} · ${label}${uniform ? '' : ` · ${t.split}`}${warning ? ` · ${t.warning}` : ''}`}
                >
                  <select
                    className="rotation-shift-select"
                    value={definition.id}
                    disabled={locked}
                    aria-label={`${worker.name} · ${t.week} ${week.weekNumber}`}
                    onChange={(event) => props.onSetWeekShift(
                      week.id,
                      worker.id,
                      Number(event.target.value),
                      applyForward,
                    )}
                  >
                    {definitions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {shiftCode(definitions, d.id)} · {d.startTime}–{d.endTime}
                      </option>
                    ))}
                  </select>
                  <span className="rotation-code" aria-hidden="true">{shiftCode(definitions, definition.id)}</span>
                  <span className="rotation-times">{definition.startTime}–{definition.endTime}</span>
                  {warning && <span className="rotation-warning" aria-hidden="true">!</span>}
                  {!uniform && (
                    <span className="rotation-ticks" aria-label={t.split}>
                      {dates.map((date) => {
                        const day = mine.find((a) => a.date === date);
                        const absent = isAbsent(worker.id, date);
                        const dayDefinition = day ? definitionById.get(day.shiftDefinitionId) : null;
                        const differs = Boolean(dayDefinition && dayDefinition.id !== definition.id);
                        return (
                          <i
                            key={date}
                            className={`rotation-tick${absent ? ' is-absent' : differs ? ' is-other' : ''}`}
                            style={differs && dayDefinition
                              ? { '--tick-color': dayDefinition.color } as React.CSSProperties
                              : undefined}
                            title={`${date}${absent ? ` · ${t.absent}` : dayDefinition ? ` · ${lang === 'hr' ? dayDefinition.nameHr : dayDefinition.nameEn}` : ''}`}
                          />
                        );
                      })}
                    </span>
                  )}
                </div>
              );
            }),
          ]),
        ])}
      </div>
      <div className="rotation-board-footer">
        <label className="rotation-apply-forward">
          <input
            type="checkbox"
            checked={applyForward}
            onChange={(event) => setApplyForward(event.target.checked)}
          />
          {t.applyForward}
        </label>
        <p className="rotation-help">{t.help}</p>
      </div>
    </div>
  );
}
