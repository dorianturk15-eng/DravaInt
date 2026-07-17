import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import { useScheduling } from '../../scheduling/SchedulingContext';
import { useMachines } from '../../machines/MachinesContext';
import { useSettings } from '../../settings/SettingsContext';
import { STATUS_COLORS } from '../../scheduling/boardData';
import { getWeeklyCapacityHours } from '../../scheduling/capacity';
import {
  buildConnectorPath,
  buildTimeTicks,
  cardEdgeAnchor,
  edgesForDependencyType,
  snapToShiftBoundary,
  xToTime,
} from '../../scheduling/boardGeometry';
import { toLocalDateTimeString } from '../../scheduling/cpm';

/** Fired when the user double-clicks empty lane space; MachineSchedule prefills its add-job form. */
export const QUICK_CREATE_EVENT = 'dravaint:board-quick-create';
export interface QuickCreateDetail {
  machine: string;
  start: string;
  end: string;
}
import { useMachineBoardController } from './useMachineBoardController';
import { MachineLane } from './MachineLane';
import { TaskCard } from './TaskCard';
import { ConnectionLayer, type RenderedConnector } from './ConnectionLayer';
import { BoardToolbar } from './BoardToolbar';
import { MachineBoardMobile } from './MachineBoardMobile';

const DEPENDENCY_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;

function useNarrowViewport(maxWidth: number): boolean {
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia?.(`(max-width: ${maxWidth}px)`).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const apply = () => setIsNarrow(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [maxWidth]);
  return isNarrow;
}

export function MachineBoard() {
  const { t, lang } = useLanguage();
  const { jobs, updateJob, removeJob, restoreBackup, getJobConflicts } = useScheduling();
  const { machines } = useMachines();
  const { settings } = useSettings();
  const isMobile = useNarrowViewport(680);
  const [openConflictId, setOpenConflictId] = useState<number | null>(null);

  const controller = useMachineBoardController({
    jobs,
    machines,
    updateJob,
    removeJob,
    restoreBackup,
    getJobConflicts,
    settings,
    locale: lang === 'hr' ? 'hr-HR' : 'en-GB',
    rejectedMessage: lang === 'hr' ? 'Taj termin je već zauzet na tom stroju ili kod tog operatera.' : 'That slot is already booked for this machine or operator.',
    versionConflictMessage: lang === 'hr' ? 'Netko drugi je upravo izmijenio ovaj nalog — podaci su osvježeni.' : 'Someone else just updated this job — data refreshed.',
  });

  const machineByName = useMemo(() => new Map(machines.map((machine) => [machine.name, machine])), [machines]);
  const jobById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);

  const connectors: RenderedConnector[] = [];
  controller.board.lanes.forEach((lane) => {
    lane.jobs.forEach((boardJob) => {
      (boardJob.job.dependencies ?? []).forEach((dependency) => {
        const predecessorLayout = controller.cardLayouts.get(dependency.jobId);
        const successorLayout = controller.cardLayouts.get(boardJob.job.id);
        if (!predecessorLayout || !successorLayout) return;
        const { sourceEdge, targetEdge } = edgesForDependencyType(dependency.type);
        const source = cardEdgeAnchor(predecessorLayout, sourceEdge);
        const target = cardEdgeAnchor(successorLayout, targetEdge);
        connectors.push({
          key: `${dependency.jobId}-${boardJob.job.id}`,
          path: buildConnectorPath(source, target),
          predecessorId: dependency.jobId,
          successorId: boardJob.job.id,
          dashed: dependency.type === 'SS' || dependency.type === 'SF',
          selected: controller.selectedConnection?.predecessorId === dependency.jobId && controller.selectedConnection?.successorId === boardJob.job.id,
        });
      });
    });
  });

  let livePath: string | null = null;
  let liveValid: boolean | null = null;
  let connectSourceId: number | null = controller.connectSource;
  if (controller.interaction?.kind === 'link') {
    const sourceLayout = controller.cardLayouts.get(controller.interaction.sourceJobId);
    if (sourceLayout) {
      const source = cardEdgeAnchor(sourceLayout, controller.interaction.sourceEdge);
      livePath = buildConnectorPath(source, { x: controller.interaction.pointerX, y: controller.interaction.pointerY });
      liveValid = controller.interaction.classification === 'valid';
    }
    connectSourceId = controller.interaction.sourceJobId;
  }

  const ticks = useMemo(
    () => buildTimeTicks(controller.originMs, controller.spanHours, controller.pixelsPerHour, controller.zoom, controller.locale),
    [controller.originMs, controller.spanHours, controller.pixelsPerHour, controller.zoom, controller.locale],
  );

  const draggingJobId = controller.interaction && controller.interaction.kind !== 'link' ? controller.interaction.jobId : null;
  const dropTargetMachine = controller.interaction?.kind === 'move' ? controller.interaction.targetMachine : null;

  const cycleLabel = controller.cycle?.map((id) => jobById.get(id)?.order || `#${id}`).join(' → ');

  return (
    <div className="board-page">
      <p className="subtitle-text" style={{ margin: '0 0 12px 0', fontSize: 13 }}>{t.machineBoard.dragHint}</p>

      <BoardToolbar
        t={t.machineBoard}
        statusLabels={t.progress.statusOptions}
        zoom={controller.zoom}
        onZoomChange={controller.setZoom}
        sortBy={controller.sortBy}
        onSortChange={controller.setSortBy}
        statusFilter={controller.statusFilter}
        onStatusFilterChange={controller.setStatusFilter}
        connectMode={controller.connectMode}
        onToggleConnectMode={() => controller.setConnectMode((value) => !value)}
        onScrollToday={controller.scrollToToday}
        onAutoSchedule={() => void controller.autoSchedule()}
        onExportCsv={controller.exportCsv}
        onExportPng={() => void controller.exportPng()}
        onJumpToConflict={() => controller.jumpToConflict()}
        onChainSelected={controller.chainSelected}
        selectionCount={controller.selectedIds.size}
        views={controller.views}
        onSaveView={controller.saveView}
        onApplyView={controller.applyView}
        onDeleteView={controller.deleteView}
        canUndo={controller.canUndo}
        canRedo={controller.canRedo}
        historyDepth={controller.historyDepth}
        futureDepth={controller.futureDepth}
        onUndo={controller.undo}
        onRedo={controller.redo}
        compact={isMobile}
      />

      {controller.cycle && (
        <div className="gantt-cycle-banner" role="alert">
          <strong>{lang === 'hr' ? 'Kružna ovisnost' : 'Dependency cycle'}</strong>
          <span>{cycleLabel}</span>
        </div>
      )}

      {controller.connectMode && !isMobile && (
        <p className="subtitle-text" style={{ fontSize: 12, margin: '8px 0 0' }}>{t.machineBoard.connectModeHint}</p>
      )}

      {isMobile ? (
        <MachineBoardMobile
          lanes={controller.laneOrder}
          machineByName={machineByName}
          statusLabels={t.progress.statusOptions}
          t={t.machineBoard}
          removeLabel={t.common.remove}
          locale={controller.locale}
          getJobConflicts={getJobConflicts}
          onRemove={(id) => void controller.removeJob(id)}
        />
      ) : (
      <div className="board-scroll" ref={controller.scrollRef}>
        <div
          className="board-content"
          ref={controller.contentRef}
          style={{ width: controller.contentWidth, height: controller.totalHeight + 32 }}
          onDoubleClick={(event) => {
            if ((event.target as HTMLElement).closest('.board-task-card')) return;
            const point = controller.toContentCoords(event.clientX, event.clientY);
            const lane = controller.laneLayouts.find((item) => point.y >= item.top && point.y < item.top + item.height);
            if (!lane) return;
            const startMs = snapToShiftBoundary(xToTime(point.x, controller.originMs, controller.pixelsPerHour), settings.workdayStart, settings.workdayEnd);
            window.dispatchEvent(new CustomEvent<QuickCreateDetail>(QUICK_CREATE_EVENT, {
              detail: { machine: lane.machine, start: toLocalDateTimeString(new Date(startMs)), end: toLocalDateTimeString(new Date(startMs + 8 * 3_600_000)) },
            }));
          }}
        >
          <div className="board-ruler" style={{ width: controller.contentWidth }}>
            {ticks.map((tick) => (
              <div key={tick.ms} className={`board-ruler-tick${tick.isDayStart ? ' is-day' : ''}`} style={{ left: tick.x }}>
                <span>{tick.label}</span>
              </div>
            ))}
          </div>

          {controller.laneOrder.map((lane) => {
            const layout = controller.laneLayouts.find((item) => item.machine === lane.machine)!;
            const hours = lane.jobs.reduce((sum, item) => sum + (item.effectiveEnd - item.effectiveStart) / 3_600_000, 0);
            return (
              <MachineLane
                key={lane.machine}
                lane={layout}
                machine={machineByName.get(lane.machine)}
                jobCount={lane.jobs.length}
                loadPercent={(hours / getWeeklyCapacityHours()) * 100}
                emptyLabel={t.machineBoard.emptyLane}
                isDropTarget={dropTargetMachine === lane.machine}
              />
            );
          })}

          <ConnectionLayer
            width={controller.contentWidth}
            height={controller.totalHeight}
            connectors={connectors}
            livePath={livePath}
            liveValid={liveValid}
            onSelectConnector={(predecessorId, successorId) => controller.setSelectedConnection({ predecessorId, successorId })}
          />

          {controller.board.lanes.flatMap((lane) => lane.jobs).map((boardJob) => {
            const layout = controller.cardLayouts.get(boardJob.job.id);
            if (!layout) return null;
            return (
              <TaskCard
                key={boardJob.job.id}
                job={boardJob.job}
                layout={layout}
                color={STATUS_COLORS[boardJob.job.status]}
                conflicts={getJobConflicts(boardJob.job)}
                selected={controller.selectedIds.has(boardJob.job.id)}
                isDragging={draggingJobId === boardJob.job.id}
                isConnectSource={connectSourceId === boardJob.job.id}
                conflictsOpen={openConflictId === boardJob.job.id}
                onToggleConflicts={() => setOpenConflictId((current) => (current === boardJob.job.id ? null : boardJob.job.id))}
                onPointerDown={(event) => controller.beginMove(event, boardJob.job.id)}
                onResizePointerDown={(event, edge) => controller.beginResize(event, boardJob.job.id, edge)}
                onConnectPointerDown={(event, edge) => controller.beginLink(event, boardJob.job.id, edge)}
                onPointerMove={controller.handlePointerMove}
                onPointerUp={controller.handlePointerUp}
                onPointerCancel={controller.handlePointerCancel}
                onToggleSelect={(additive) => controller.toggleSelect(boardJob.job.id, additive)}
                onRemove={() => controller.removeJob(boardJob.job.id)}
              />
            );
          })}
        </div>
      </div>
      )}

      {controller.selectedConnection && !controller.editingConnection && !isMobile && (
        <div className="dependency-editor" style={{ marginTop: 10 }}>
          <strong>{jobById.get(controller.selectedConnection.successorId)?.order || jobById.get(controller.selectedConnection.successorId)?.machine}</strong>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              const successor = jobById.get(controller.selectedConnection!.successorId);
              const dependency = successor?.dependencies?.find((item) => item.jobId === controller.selectedConnection!.predecessorId);
              if (dependency) controller.setEditingConnection({ successorId: controller.selectedConnection!.successorId, predecessorId: controller.selectedConnection!.predecessorId, type: dependency.type, lagHours: dependency.lagHours });
            }}
          >
            {lang === 'hr' ? 'Uredi' : 'Edit'}
          </button>
          <button type="button" className="btn btn-red" onClick={() => controller.deleteConnection(controller.selectedConnection!.successorId, controller.selectedConnection!.predecessorId)}>
            {t.machineBoard.deleteConnection}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => controller.setSelectedConnection(null)}>×</button>
        </div>
      )}

      {controller.editingConnection && (
        <div className="dependency-editor" style={{ marginTop: 10 }}>
          <strong>{lang === 'hr' ? 'Uredi vezu' : 'Edit dependency'}</strong>
          <select
            value={controller.editingConnection.type}
            onChange={(event) => controller.setEditingConnection({ ...controller.editingConnection!, type: event.target.value as (typeof DEPENDENCY_TYPES)[number] })}
          >
            {DEPENDENCY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <input
            type="number"
            step="0.5"
            value={controller.editingConnection.lagHours}
            onChange={(event) => controller.setEditingConnection({ ...controller.editingConnection!, lagHours: Number(event.target.value) })}
          />
          <button type="button" className="btn btn-blue" onClick={controller.saveConnectionEdit}>{lang === 'hr' ? 'Spremi' : 'Save'}</button>
          <button type="button" className="btn btn-ghost" onClick={() => controller.setEditingConnection(null)}>×</button>
        </div>
      )}

      {controller.toast && (
        <div className={`board-toast board-toast-${controller.toast.tone}`} role="status" onClick={controller.dismissToast}>
          {controller.toast.message}
        </div>
      )}
    </div>
  );
}
