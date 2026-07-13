import { describe, expect, it } from 'vitest';
import { isStrongPassword } from './AuthContext';

describe('password policy', () => {
  it('requires length, upper/lowercase, number, and symbol', () => {
    expect(isStrongPassword('short')).toBe(false);
    expect(isStrongPassword('alllowercase1!')).toBe(false);
    expect(isStrongPassword('NoNumber!')).toBe(false);
    expect(isStrongPassword('DravaInt!2026')).toBe(true);
  });
});
