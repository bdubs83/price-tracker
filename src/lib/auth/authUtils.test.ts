import { describe, expect, it } from 'vitest';
import { isValidEmail, normalizeEmail, replaceApprovedMembersFromRows } from './authUtils';

describe('auth utils', () => {
  it('normalizes email', () => {
    expect(normalizeEmail('  Test@Example.COM ')).toBe('test@example.com');
  });

  it('validates email shape', () => {
    expect(isValidEmail('member@example.com')).toBe(true);
    expect(isValidEmail('member example.com')).toBe(false);
  });

  it('replaces member CSV and reports duplicates/removals', () => {
    const summary = replaceApprovedMembersFromRows(
      [{ Email: 'NEW@example.com', Name: 'New' }, { Email: 'new@example.com' }, { Email: 'bad' }],
      [{ email: 'old@example.com', source: 'manual', active: true, createdAt: 'x', updatedAt: 'x' }],
    );

    expect(summary.validEmailsImported).toBe(1);
    expect(summary.duplicateEmailsSkipped).toBe(1);
    expect(summary.invalidRows).toBe(1);
    expect(summary.previousMembersRemoved).toBe(1);
    expect(summary.newMembersAdded).toBe(1);
  });
});
