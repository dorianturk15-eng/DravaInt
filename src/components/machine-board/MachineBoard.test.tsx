import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { SchedulingProvider } from '../../scheduling/SchedulingContext';
import { MachinesProvider } from '../../machines/MachinesContext';
import { SettingsProvider } from '../../settings/SettingsContext';
import { MachineBoard } from './MachineBoard';

function renderBoard() {
  return render(
    <LanguageProvider>
      <SettingsProvider>
        <MachinesProvider>
          <SchedulingProvider>
            <MachineBoard />
          </SchedulingProvider>
        </MachinesProvider>
      </SettingsProvider>
    </LanguageProvider>,
  );
}

describe('MachineBoard', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('dravaint-lang', 'en');
  });
  afterEach(cleanup);

  it('renders lanes and cards from the shared job data without React warnings', () => {
    // A regression guard for a real bug caught during manual QA: calling a setState updater with
    // side effects (or reading a value synchronously right after calling setState) produced
    // "Cannot update a component while rendering a different component" on every mount.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderBoard();

    expect(screen.getByRole('button', { name: 'RN-2026-014' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RN-2026-015' })).toBeInTheDocument();
    const badCalls = errorSpy.mock.calls.filter(([message]) => typeof message === 'string' && message.includes('Cannot update a component'));
    expect(badCalls).toEqual([]);
    errorSpy.mockRestore();
  });

  it('shows an empty-lane message for a machine with no scheduled jobs', () => {
    renderBoard();
    expect(screen.getByText('No jobs on this machine.')).toBeInTheDocument();
  });
});
