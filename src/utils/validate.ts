import type { OutreachContact } from "../types/index.js";

/** Practical email check. Not full RFC, but good enough before send. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (normalized === "") return false;
  return EMAIL_REGEX.test(normalized);
}

export interface FilterSendableResult {
  sendable: OutreachContact[];
  invalidCount: number;
}

/**
 * Remove contacts with empty or malformed emails before send.
 * Defense-in-depth after Prospeo enrichment and deduplication.
 */
export function filterSendableContacts(
  contacts: OutreachContact[],
): FilterSendableResult {
  const sendable: OutreachContact[] = [];
  let invalidCount = 0;

  for (const contact of contacts) {
    if (isValidEmail(contact.email)) {
      sendable.push(contact);
    } else {
      invalidCount++;
    }
  }

  return { sendable, invalidCount };
}
