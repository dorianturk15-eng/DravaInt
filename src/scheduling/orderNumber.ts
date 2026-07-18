/**
 * Suggest the next work-order id following the shop's RN-YYYY-NNN convention.
 *
 * The sequence is scoped to the current year and restarts at 001 each January.
 * Sub-orders share their parent's sequence block (RN-2026-030, RN-2026-030-A1,
 * RN-2026-030-B2 are all sequence 30), so only the first numeric block after the
 * year counts toward the maximum. Orders in other formats are ignored — the
 * suggestion never blocks a planner from typing a custom id.
 */
export function suggestOrderNumber(existingOrders: string[], now = new Date()): string {
  const year = now.getFullYear();
  const pattern = new RegExp(`^RN-${year}-(\\d+)`, 'i');
  let maxSequence = 0;
  for (const order of existingOrders) {
    const match = pattern.exec(order.trim());
    if (match) maxSequence = Math.max(maxSequence, parseInt(match[1], 10));
  }
  return `RN-${year}-${String(maxSequence + 1).padStart(3, '0')}`;
}
