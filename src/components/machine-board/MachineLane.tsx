import type { Machine } from '../../machines/MachinesContext';
import type { LaneLayout } from './useMachineBoardController';

interface MachineLaneProps {
  lane: LaneLayout;
  machine: Machine | undefined;
  jobCount: number;
  loadPercent: number;
  emptyLabel: string;
  isDropTarget: boolean;
}

export function MachineLane({ lane, machine, jobCount, loadPercent, emptyLabel, isDropTarget }: MachineLaneProps) {
  return (
    <div className={`board-lane-band${isDropTarget ? ' is-drop-target' : ''}`} style={{ top: lane.top, height: lane.height }}>
      <div className="board-lane-header">
        <div>
          <strong>{lane.machine}</strong>
          {machine && <span>{machine.type === 'mill' ? (machine.axis ? `${machine.axis}-axis mill` : 'Mill') : 'Lathe'}</span>}
        </div>
        <div className="efficiency-meter" title={`${Math.round(loadPercent)}%`}>
          <span style={{ width: `${Math.min(100, loadPercent)}%` }} />
          <b>{Math.round(loadPercent)}%</b>
        </div>
      </div>
      {jobCount === 0 && <div className="board-lane-empty">{emptyLabel}</div>}
    </div>
  );
}
