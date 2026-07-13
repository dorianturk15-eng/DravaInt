import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette, type CommandItem } from './CommandPalette';
import { NotificationCenter, type OperationalAlert } from './NotificationCenter';

describe('command layer', () => {
  beforeEach(() => localStorage.clear());

  it('filters commands and runs the selected action', async () => {
    const user = userEvent.setup();
    const openGantt = vi.fn();
    const commands: CommandItem[] = [
      { id: 'dashboard', label: 'Dashboard', description: 'Open module', group: 'Navigation', run: vi.fn() },
      { id: 'gantt', label: 'Gantt', description: 'Open planning', group: 'Navigation', keywords: 'schedule', run: openGantt },
    ];
    render(<CommandPalette open onClose={vi.fn()} commands={commands} language="en" />);

    await user.type(screen.getByRole('textbox', { name: 'Search commands' }), 'schedule');
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(openGantt).toHaveBeenCalledOnce();
  });

  it('navigates from an alert and closes when the active module changes', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const alerts: OperationalAlert[] = [{ id: 'overlap', title: 'Machine overlap', detail: 'CNC-1 is double-booked.', severity: 'warning', action: 'machines' }];
    const view = render(<NotificationCenter alerts={alerts} online pendingChanges={0} language="en" activeTab="dashboard" onNavigate={navigate} />);

    await user.click(screen.getByRole('button', { name: '1 unread alerts' }));
    await user.click(screen.getByRole('button', { name: /Machine overlap/ }));
    expect(navigate).toHaveBeenCalledWith('machines');

    await user.click(screen.getByRole('button', { name: '0 unread alerts' }));
    expect(screen.getByRole('dialog', { name: 'Operational alerts' })).toBeInTheDocument();
    view.rerender(<NotificationCenter alerts={alerts} online pendingChanges={0} language="en" activeTab="admin" onNavigate={navigate} />);
    expect(screen.queryByRole('dialog', { name: 'Operational alerts' })).not.toBeInTheDocument();
  });
});
