import type { DependencyType } from '../../scheduling/SchedulingContext';

export type GanttTaskType = 'task' | 'milestone' | 'project';

/** Zoom presets, mapped 1:1 to the toolbar's Sat/Smjena/Dan/Tjedan/Mjesec buttons. */
export type GanttViewMode = 'hour' | 'shift' | 'day' | 'week' | 'month';

export interface GanttTaskStyles {
  backgroundColor?: string;
  backgroundSelectedColor?: string;
}

/**
 * One renderable row on the chart. The scheduling layer (hierarchy.buildGanttTasks) emits the
 * base fields; the Gantt page then attaches the decoration fields (setup stripes, baseline
 * ghosts, warning badges…) that the old implementation injected into gantt-task-react's DOM
 * after the fact — here they are first-class inputs to the renderer.
 */
export interface GanttTask {
  id: string;
  type: GanttTaskType;
  name: string;
  start: Date;
  end: Date;
  /** 0–100 */
  progress: number;
  /** Parent task id ("wo-<jobId>") for rows nested under a project row. */
  project?: string;
  /** Predecessor task ids. */
  dependencies?: string[];
  /** Disables drag/resize (project container rows). */
  isDisabled?: boolean;
  styles?: GanttTaskStyles;

  /** FS/SS/FF/SF per predecessor task id — controls arrow anchors and dashing. */
  dependencyTypes?: Record<string, DependencyType>;
  /** Fraction (0–1) of the bar to stripe as setup time, from the bar's start. */
  setupRatio?: number;
  /** Tooltip for the setup stripe. */
  setupLabel?: string;
  /** Diagonal "running" stripes over the whole bar (in-progress jobs). */
  texture?: boolean;
  /** Saved-baseline window; rendered as a dashed ghost outline on the task's row. */
  baseline?: { start: Date; end: Date };
  /** When set, renders a warning badge on the bar with this text as its tooltip. */
  warning?: string;
  /** Allows a move-drag to drop the bar on another lane (cross-machine reassignment). Set only
   *  for plain single-machine leaf jobs — routed/chained/container orders keep their lanes. */
  laneChangeable?: boolean;
}

/** One machine swimlane: a header row followed by that machine's task rows. */
export interface GanttLane {
  id: string;
  label: string;
  /** 0–100, rendered as the small efficiency meter in the lane header. */
  efficiency?: number;
  tasks: GanttTask[];
}
