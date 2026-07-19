import type { Machine } from '../../machines/MachinesContext';
import type { LaneLayout } from './useMachineBoardController';

interface MachineLaneProps {
  lane: LaneLayout;
  machine: Machine | undefined;
  jobCount: number;
  loadPercent: number;
  emptyLabel: string;
  isDropTarget: boolean;
  onToggleCollapse: () => void;
  collapseHint: string;
}

const TYPE_LABEL: Record<Machine['type'], string> = { mill: 'Mill', lathe: 'Lathe', saw: 'Saw', qc: 'QC', other: 'Machine' };

export function MachineLane({ lane, machine, jobCount, loadPercent, emptyLabel, isDropTarget, onToggleCollapse, collapseHint }: MachineLaneProps) {
  const typeText = machine ? (machine.type === 'mill' ? (machine.axis ? `${machine.axis}-axis mill` : 'Mill') : TYPE_LABEL[machine.type]) : undefined;
  return (
    <div className={`board-lane-band${isDropTarget ? ' is-drop-target' : ''}${lane.collapsed ? ' is-collapsed' : ''}`} style={{ top: lane.top, height: lane.height }}>
      <div className="board-lane-header">
        <div className="board-lane-title">
          <button
            type="button"
            className="board-lane-collapse"
            onClick={onToggleCollapse}
            title={collapseHint}
            aria-expanded={!lane.collapsed}
          >
            {lane.collapsed ? '▸' : '▾'}
          </button>
          <div>
            <strong>{lane.machine}</strong>
            {typeText && <span>{lane.collapsed ? `${typeText} · ${jobCount}` : typeText}</span>}
          </div>
        </div>
        <div className="efficiency-meter" title={`${Math.round(loadPercent)}%`}>
          <span style={{ width: `${Math.min(100, loadPercent)}%` }} />
          <b>{Math.round(loadPercent)}%</b>
        </div>
      </div>
      {!lane.collapsed && jobCount === 0 && <div className="board-lane-empty">{emptyLabel}</div>}
    </div>
  );
}
