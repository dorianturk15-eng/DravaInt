import { describe, expect, it } from 'vitest';
import { suggestOrderNumber } from './orderNumber';

const NOW = new Date('2026-07-18T10:00:00');

describe('suggestOrderNumber', () => {
  it('starts at 001 for an empty database', () => {
    expect(suggestOrderNumber([], NOW)).toBe('RN-2026-001');
  });

  it('increments past the highest sequence of the current year', () => {
    expect(suggestOrderNumber(['RN-2026-021', 'RN-2026-014', 'RN-2026-070'], NOW)).toBe('RN-2026-071');
  });

  it('treats sub-orders as part of their parent sequence block', () => {
    expect(suggestOrderNumber(['RN-2026-030', 'RN-2026-030-A1', 'RN-2026-030-B2'], NOW)).toBe('RN-2026-031');
  });

  it('ignores orders from other years and other formats', () => {
    expect(suggestOrderNumber(['RN-2025-998', 'XYZ-500', 'RN-2026-002'], NOW)).toBe('RN-2026-003');
  });

  it('keeps counting without padding overflow past 999', () => {
    expect(suggestOrderNumber(['RN-2026-999'], NOW)).toBe('RN-2026-1000');
  });

  it('is case-insensitive and tolerates whitespace', () => {
    expect(suggestOrderNumber(['  rn-2026-005  '], NOW)).toBe('RN-2026-006');
  });
});
