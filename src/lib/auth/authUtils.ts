import type { ApprovedMember, CsvImportSummary } from '../types';

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function createSessionExpiry(hours = 48, from = new Date()) {
  return new Date(from.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function isSessionActive(expiresAt?: string) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() > Date.now());
}

export function replaceApprovedMembersFromRows(
  rows: Array<Record<string, unknown>>,
  previousMembers: ApprovedMember[],
): CsvImportSummary {
  const importedAt = new Date().toISOString();
  const seen = new Set<string>();
  const previous = new Set(previousMembers.filter((m) => m.active).map((m) => normalizeEmail(m.email)));
  const members: ApprovedMember[] = [];
  let duplicateEmailsSkipped = 0;
  let invalidRows = 0;

  rows.forEach((row) => {
    const rawEmail = String(row.email ?? row.Email ?? row.EMAIL ?? '').trim();
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) {
      invalidRows += 1;
      return;
    }
    if (seen.has(email)) {
      duplicateEmailsSkipped += 1;
      return;
    }
    seen.add(email);
    members.push({
      email,
      name: String(row.name ?? row.Name ?? '').trim() || undefined,
      skoolUsername: String(row.skoolUsername ?? row.username ?? row.Username ?? '').trim() || undefined,
      source: 'csv',
      active: true,
      importedAt,
      createdAt: previousMembers.find((m) => normalizeEmail(m.email) === email)?.createdAt ?? importedAt,
      updatedAt: importedAt,
    });
  });

  const next = new Set(members.map((m) => m.email));
  const previousMembersRemoved = [...previous].filter((email) => !next.has(email)).length;
  const newMembersAdded = members.filter((m) => !previous.has(m.email)).length;

  return {
    totalRowsFound: rows.length,
    validEmailsImported: members.length,
    duplicateEmailsSkipped,
    invalidRows,
    previousMembersRemoved,
    newMembersAdded,
    importedAt,
    members,
  };
}
