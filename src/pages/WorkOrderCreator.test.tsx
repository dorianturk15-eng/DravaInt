import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageContext';
import { SchedulingProvider, type Job } from '../scheduling/SchedulingContext';
import { WorkersProvider } from '../workers/WorkersContext';
import { LogoProvider } from '../logo/LogoContext';
import WorkOrderCreator from './WorkOrderCreator';

// Runs against the demo/offline fallback (no Supabase env in tests): SchedulingProvider persists
// every write to the 'dravaint-jobs-fallback' localStorage key, which the assertions read back.
function loadSavedJobs(): Job[] {
  return JSON.parse(localStorage.getItem('dravaint-jobs-fallback') ?? '[]');
}

function renderCreator(initialEntry = '/workOrders') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LanguageProvider>
        <WorkersProvider>
          <LogoProvider>
            <SchedulingProvider>
              <WorkOrderCreator />
            </SchedulingProvider>
          </LogoProvider>
        </WorkersProvider>
      </LanguageProvider>
    </MemoryRouter>,
  );
}

describe('WorkOrderCreator edit flow', () => {
  beforeEach(() => {
    localStorage.clear();
    window.scrollTo = vi.fn();
  });
  afterEach(cleanup);

  it('loads an order via Uredi and saving updates the existing row instead of adding one', async () => {
    const user = userEvent.setup();
    renderCreator();

    // RN-2026-080 is a routed demo order (Tokarenje -> Glodanje). Query the table cell — the same
    // order number also appears as an option in the parent-order selector.
    const row = screen.getByRole('cell', { name: 'RN-2026-080' }).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Uredi' }));

    expect(screen.getByText(/Uređujete nalog/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('RN-2026-080')).toBeInTheDocument();

    const productInput = screen.getByDisplayValue('Osovina');
    await user.clear(productInput);
    await user.type(productInput, 'Osovina V2');
    await user.click(screen.getByRole('button', { name: /Spremi izmjene/ }));

    // Success banner (plain or with scheduling warnings), and the same row was updated in place.
    await screen.findByText(/Radni nalog je ažuriran|spremljene uz upozorenja/);
    const saved = loadSavedJobs();
    expect(saved.filter((j) => j.order === 'RN-2026-080')).toHaveLength(1);
    const edited = saved.find((j) => j.order === 'RN-2026-080')!;
    expect(edited.id).toBe(59);
    expect(edited.product).toBe('Osovina V2');
    expect(screen.queryByText(/Uređujete nalog/)).not.toBeInTheDocument();
  });

  it('opens edit mode from a /workOrders?edit=<id> deep link', async () => {
    renderCreator('/workOrders?edit=59');
    expect(await screen.findByText(/Uređujete nalog/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('RN-2026-080')).toBeInTheDocument();
  });

  it('edits a step in place and reorders the route before saving', async () => {
    const user = userEvent.setup();
    renderCreator('/workOrders?edit=59');
    await screen.findByText(/Uređujete nalog/);

    // Change the Tokarenje step from 3h to 5h in place.
    await user.click(screen.getByRole('button', { name: 'Uredi korak "Tokarenje"' }));
    const hoursInput = screen.getByRole('spinbutton');
    await user.clear(hoursInput);
    await user.type(hoursInput, '5');
    await user.click(screen.getByRole('button', { name: /Spremi korak/ }));
    expect(screen.getByText('5 h')).toBeInTheDocument();

    // Move Glodanje ahead of Tokarenje.
    await user.click(screen.getByRole('button', { name: 'Pomakni "Glodanje" ranije' }));
    await user.click(screen.getByRole('button', { name: /Spremi izmjene/ }));
    await screen.findByText(/Radni nalog je ažuriran|spremljene uz upozorenja/);

    const edited = loadSavedJobs().find((j) => j.id === 59)!;
    expect(edited.operations!.map((op) => op.name)).toEqual(['Glodanje', 'Tokarenje']);
    expect(edited.operations!.find((op) => op.name === 'Tokarenje')!.hours).toBe(5);
    expect(edited.machine).toBe('CNC-1 → Tokarilica-1');
  });

  it('excludes the edited order and its descendants from the parent selector', async () => {
    renderCreator('/workOrders?edit=31'); // RN-2026-030-A: child of 30, parent of 32/33
    await screen.findByText(/Uređujete nalog/);

    const parentSelect = screen.getByRole('option', { name: '(bez nadređenog - glavni nalog)' }).closest('select')!;
    expect(within(parentSelect).getByRole('option', { name: 'RN-2026-030' })).toBeInTheDocument();
    expect(within(parentSelect).queryByRole('option', { name: 'RN-2026-030-A' })).toBeNull();
    expect(within(parentSelect).queryByRole('option', { name: 'RN-2026-030-A1' })).toBeNull();
    expect(within(parentSelect).queryByRole('option', { name: 'RN-2026-030-A2' })).toBeNull();
  });
});
