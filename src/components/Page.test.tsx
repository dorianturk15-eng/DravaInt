import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { EmptyState, InlineNotice, PageHeader, Panel, StatTile } from './Page';

describe('PageHeader', () => {
  it('renders eyebrow, title, subtitle and actions', () => {
    render(<PageHeader eyebrow="Planiranje" title="Raspored" subtitle="Podnaslov" actions={<button>Novo</button>} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Raspored');
    expect(screen.getByText('Planiranje')).toHaveClass('eyebrow');
    expect(screen.getByText('Podnaslov')).toHaveClass('subtitle-text');
    expect(screen.getByRole('button', { name: 'Novo' })).toBeInTheDocument();
  });

  it('omits the optional slots entirely rather than rendering empty nodes', () => {
    const { container } = render(<PageHeader title="Samo naslov" />);
    expect(container.querySelector('.eyebrow')).toBeNull();
    expect(container.querySelector('.subtitle-text')).toBeNull();
    expect(container.querySelector('.page-heading-actions')).toBeNull();
  });

  it('marks the header no-print on request', () => {
    const { container } = render(<PageHeader title="X" noPrint />);
    expect(container.querySelector('.page-heading-row')).toHaveClass('no-print');
  });
});

describe('Panel', () => {
  it('defaults to the glass treatment and switches on the variant', () => {
    const { container: glass } = render(<Panel>body</Panel>);
    expect(glass.firstChild).toHaveClass('glass-panel');
    const { container: step } = render(<Panel variant="step">body</Panel>);
    expect(step.firstChild).toHaveClass('step-box');
    // Adopting Panel must never silently swap a page's panel treatment.
    expect(step.firstChild).not.toHaveClass('glass-panel');
  });

  it('renders the title row and hint only when given', () => {
    const { container } = render(<Panel>body</Panel>);
    expect(container.querySelector('.section-title-row')).toBeNull();
    expect(container.querySelector('.panel-hint')).toBeNull();
    render(<Panel title="Naslov" titleAside="3" hint="Povucite za izmjenu">body</Panel>);
    expect(screen.getByText('Naslov')).toHaveClass('step-title');
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Povucite za izmjenu')).toHaveClass('panel-hint');
  });
});

describe('StatTile', () => {
  it('renders a plain div when not clickable', () => {
    const { container } = render(<StatTile value={12} label="Ukupno" />);
    expect(container.querySelector('button')).toBeNull();
    expect(screen.getByText('12')).toHaveClass('stat-value');
  });

  it('becomes a real button when clickable, so it is keyboard reachable', async () => {
    const onClick = vi.fn();
    render(<StatTile value={3} label="Kašnjenja" onClick={onClick} />);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('is-clickable');
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('passes the accent through as a custom property', () => {
    const { container } = render(<StatTile value={1} label="X" accent="var(--danger-color)" />);
    expect(container.querySelector('.stat-tile')?.getAttribute('style')).toContain('--accent');
  });
});

describe('EmptyState', () => {
  it('renders the message and optional action', () => {
    render(<EmptyState action={<button>Dodaj</button>}>Nema podataka</EmptyState>);
    expect(screen.getByText('Nema podataka')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dodaj' })).toBeInTheDocument();
  });
});

describe('InlineNotice', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses alert for errors and status for everything else', () => {
    const { unmount } = render(<InlineNotice tone="error">Greška</InlineNotice>);
    expect(screen.getByRole('alert')).toHaveTextContent('Greška');
    unmount();
    render(<InlineNotice tone="success">Spremljeno</InlineNotice>);
    expect(screen.getByRole('status')).toHaveTextContent('Spremljeno');
  });

  it('stays put with no dismiss timer', () => {
    render(<InlineNotice tone="error">Trajna greška</InlineNotice>);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('auto-dismisses and reports back after the delay', () => {
    const onDismiss = vi.fn();
    render(<InlineNotice tone="success" dismissAfterMs={2000} onDismiss={onDismiss}>Gotovo</InlineNotice>);
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1999); });
    expect(screen.queryByRole('status')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole('status')).toBeNull();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('reappears when a new message arrives after a dismissal', () => {
    const { rerender } = render(<InlineNotice tone="success" dismissAfterMs={1000}>Prvi</InlineNotice>);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<InlineNotice tone="success" dismissAfterMs={1000}>Drugi</InlineNotice>);
    expect(screen.getByRole('status')).toHaveTextContent('Drugi');
  });
});
