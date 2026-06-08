/** Matches a valid domain: labels separated by dots, no protocol or path. */
const DOMAIN_REGEX =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/**
 * Normalize a raw domain input into a clean hostname.
 *
 * Handles common user input variants:
 *   "https://www.OpenAI.com/"  → "openai.com"
 *   "WWW.ACME.COM"             → "acme.com"
 *   "acme.com/path?q=1"        → "acme.com"
 *
 * Returns null if the input cannot be parsed into a valid domain.
 */
export function normalizeDomain(raw: string): string | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  let input = raw.trim().toLowerCase();

  // Strip protocol
  input = input.replace(/^https?:\/\//, "");

  // Strip path, query, hash, and port
  input = input.split("/")[0] ?? "";
  input = input.split("?")[0] ?? "";
  input = input.split("#")[0] ?? "";
  input = input.split(":")[0] ?? "";

  // Strip www. prefix
  input = input.replace(/^www\./, "");

  if (!DOMAIN_REGEX.test(input)) {
    return null;
  }

  return input;
}

/**
 * Normalize a domain or throw with a user-friendly error message.
 * Use at the CLI entry point where invalid input should be fatal.
 */
export function normalizeDomainOrThrow(raw: string): string {
  const domain = normalizeDomain(raw);

  if (domain === null) {
    throw new Error(
      `Invalid domain: "${raw}". Expected format like "linear.app" or "https://www.linear.app".`,
    );
  }

  return domain;
}
