import type { DedupeResult, OutreachContact } from "../types/index.js";

/**
 * Normalize an email for comparison: lowercase + trim.
 * Returns empty string for falsy input so it never enters the dedupe set.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Remove duplicate contacts by normalized email address.
 * First occurrence wins; subsequent duplicates are dropped.
 */
export function dedupeByEmail(contacts: OutreachContact[]): DedupeResult {
  const seen = new Set<string>();
  const unique: OutreachContact[] = [];

  for (const contact of contacts) {
    const key = normalizeEmail(contact.email);

    if (key === "" || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(contact);
  }

  return {
    unique,
    removedCount: contacts.length - unique.length,
  };
}
