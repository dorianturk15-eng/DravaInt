import { describe, expect, it } from 'vitest';
import { isStrongPassword, loginEmailFor } from './AuthContext';

describe('password policy', () => {
  it('requires length, upper/lowercase, number, and symbol', () => {
    expect(isStrongPassword('short')).toBe(false);
    expect(isStrongPassword('alllowercase1!')).toBe(false);
    expect(isStrongPassword('NoNumber!')).toBe(false);
    expect(isStrongPassword('DravaInt!2026')).toBe(true);
  });
});

describe('loginEmailFor', () => {
  it('uses a typed email as-is (normalized), ignoring any resolver result', () => {
    expect(loginEmailFor('Admin@Company.com', null)).toBe('admin@company.com');
    expect(loginEmailFor('  user@x.io  ', 'other@x.io')).toBe('user@x.io');
  });

  it('resolves a username to the real email returned by the RPC', () => {
    // The whole point of the fix: a username maps to its actual mailbox, even when that
    // is not the <username>@dravaint.local convention.
    expect(loginEmailFor('admin', 'boss@gmail.com')).toBe('boss@gmail.com');
    expect(loginEmailFor('IvanH', 'ivan.horvat@dravaint.local')).toBe('ivan.horvat@dravaint.local');
  });

  it('falls back to <username>@dravaint.local only when the RPC has no answer', () => {
    expect(loginEmailFor('worker7', null)).toBe('worker7@dravaint.local');
    expect(loginEmailFor('worker7', '')).toBe('worker7@dravaint.local');
    expect(loginEmailFor('Worker7', '   ')).toBe('worker7@dravaint.local');
  });
});
