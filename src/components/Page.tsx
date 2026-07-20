import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Shared page furniture (UI_MODERNIZATION_PLAN Tier 1.4/1.5).
 *
 * The audit found the same handful of patterns hand-rolled per page: an
 * eyebrow/title/subtitle heading (only ShiftSchedule had it as a proper
 * idiom), two competing panel treatments, five ad-hoc empty states and four
 * ad-hoc feedback styles.
 *
 * These components deliberately render the CLASS NAMES THAT ALREADY EXIST
 * rather than introducing a new visual language — the app's problem is
 * inconsistent application of its design system, not the design system. So
 * adopting them is a markup consolidation with no rendering change; any
 * restyle is a separate, reviewable step.
 */

export interface PageHeaderProps {
  /** Small uppercase kicker above the title. */
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-hand slot: the page's primary action, or a status badge. */
  actions?: ReactNode;
  /** Headings are excluded from print output on the planner pages. */
  noPrint?: boolean;
}

export function PageHeader({ eyebrow, title, subtitle, actions, noPrint }: PageHeaderProps) {
  return (
    <div className={`page-heading-row${noPrint ? ' no-print' : ''}`}>
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {subtitle && <p className="subtitle-text">{subtitle}</p>}
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </div>
  );
}

export interface PanelProps {
  children: ReactNode;
  /**
   * `glass` is the card treatment used by the planner and board pages;
   * `step` is the flatter wizard-step treatment. These were the app's two
   * competing panel looks — kept as explicit variants so adopting Panel never
   * silently changes which one a page had.
   */
  variant?: 'glass' | 'step';
  title?: ReactNode;
  /** Right-hand side of the title row (a count, a control). */
  titleAside?: ReactNode;
  /** One-line affordance hint, for panels whose interactions are not obvious
   *  (drag, double-click) — UI_MODERNIZATION_PLAN F9. */
  hint?: ReactNode;
  className?: string;
  as?: 'div' | 'section';
}

export function Panel({
  children, variant = 'glass', title, titleAside, hint, className = '', as: Tag = 'div',
}: PanelProps) {
  const base = variant === 'step' ? 'step-box' : 'glass-panel';
  return (
    <Tag className={`${base}${className ? ` ${className}` : ''}`}>
      {title && (
        <div className="section-title-row">
          <div className="step-title">{title}</div>
          {titleAside && <span>{titleAside}</span>}
        </div>
      )}
      {children}
      {hint && <p className="panel-hint">{hint}</p>}
    </Tag>
  );
}

export interface StatTileProps {
  value: ReactNode;
  label: ReactNode;
  icon?: ReactNode;
  /** Token expression for the tile accent, e.g. `var(--primary-color)`. */
  accent?: string;
  onClick?: () => void;
  /** Quiet tiles are the rarely-actionable ones (totals, averages). */
  quiet?: boolean;
}

export function StatTile({ value, label, icon, accent, onClick, quiet }: StatTileProps) {
  const content = (
    <>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
      {icon && <div className="stat-icon">{icon}</div>}
    </>
  );
  const className = `stat-tile${quiet ? ' is-quiet' : ''}${onClick ? ' is-clickable' : ''}`;
  const style = accent ? ({ '--accent': accent } as React.CSSProperties) : undefined;
  if (onClick) {
    return <button type="button" className={className} style={style} onClick={onClick}>{content}</button>;
  }
  return <div className={className} style={style}>{content}</div>;
}

export interface EmptyStateProps {
  icon?: ReactNode;
  /** The one-line explanation. Say what is missing and how to get it. */
  children: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon, children, action, compact }: EmptyStateProps) {
  return (
    <div className={`empty-state${compact ? ' is-compact' : ''}`}>
      {icon && <span className="empty-state-icon" aria-hidden="true">{icon}</span>}
      <p>{children}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export interface InlineNoticeProps {
  tone: 'success' | 'error' | 'info';
  children: ReactNode;
  /** Auto-dismiss after N ms. Errors should generally NOT auto-dismiss. */
  dismissAfterMs?: number;
  onDismiss?: () => void;
}

/**
 * One feedback component replacing the per-page mix of `inline-success` divs,
 * bare coloured `<p role="alert">`, and toast-like banners (F11). Errors get
 * `role="alert"` (interrupts a screen reader); success and info get
 * `role="status"` (announced politely).
 */
export function InlineNotice({ tone, children, dismissAfterMs, onDismiss }: InlineNoticeProps) {
  const [visible, setVisible] = useState(true);
  // Keep the latest callback without restarting the timer on every render.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    setVisible(true);
    if (!dismissAfterMs) return;
    const timer = window.setTimeout(() => {
      setVisible(false);
      onDismissRef.current?.();
    }, dismissAfterMs);
    return () => window.clearTimeout(timer);
  }, [dismissAfterMs, children]);

  if (!visible) return null;
  return (
    <div className={`inline-notice tone-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
