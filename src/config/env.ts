import dotenv from "dotenv";

dotenv.config();

/** Typed, validated application configuration. */
export interface AppConfig {
  oceanApiKey: string;
  prospeoApiKey: string;
  brevoApiKey: string;
  brevoSenderEmail: string;
  brevoSenderName: string;
  companyLimit: number;
  contactsPerCompany: number;
  apiDelayMs: number;
  retryMaxAttempts: number;
}

const REQUIRED_VARS = [
  "OCEAN_API_KEY",
  "PROSPEO_API_KEY",
  "BREVO_API_KEY",
  "BREVO_SENDER_EMAIL",
  "BREVO_SENDER_NAME",
] as const;

const DEFAULTS = {
  COMPANY_LIMIT: 10,
  CONTACTS_PER_COMPANY: 1,
  API_DELAY_MS: 1000,
  RETRY_MAX_ATTEMPTS: 3,
} as const;

const LIMITS = {
  COMPANY_LIMIT: { min: 1, max: 100 },
  CONTACTS_PER_COMPANY: { min: 1, max: 10 },
  API_DELAY_MS: { min: 0, max: 10_000 },
  RETRY_MAX_ATTEMPTS: { min: 1, max: 10 },
} as const;

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  bounds: { min: number; max: number },
  name: string,
): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(
      `Invalid ${name}: "${raw}" is not a number. Expected integer between ${bounds.min} and ${bounds.max}.`,
    );
  }

  if (parsed < bounds.min || parsed > bounds.max) {
    throw new Error(
      `Invalid ${name}: ${parsed} is out of range. Expected ${bounds.min}–${bounds.max}.`,
    );
  }

  return parsed;
}

function validateRequired(vars: readonly string[]): void {
  const missing = vars.filter((key) => {
    const value = process.env[key];
    return value === undefined || value.trim() === "";
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n  ${missing.join("\n  ")}\n\nCopy .env.example to .env and fill in your API keys.`,
    );
  }
}

/**
 * Load and validate all configuration from environment variables.
 * Throws immediately on missing required vars or invalid numeric values.
 */
export function loadConfig(): AppConfig {
  validateRequired(REQUIRED_VARS);

  return {
    oceanApiKey: process.env.OCEAN_API_KEY!.trim(),
    prospeoApiKey: process.env.PROSPEO_API_KEY!.trim(),
    brevoApiKey: process.env.BREVO_API_KEY!.trim(),
    brevoSenderEmail: process.env.BREVO_SENDER_EMAIL!.trim(),
    brevoSenderName: process.env.BREVO_SENDER_NAME!.trim(),
    companyLimit: parsePositiveInt(
      process.env.COMPANY_LIMIT,
      DEFAULTS.COMPANY_LIMIT,
      LIMITS.COMPANY_LIMIT,
      "COMPANY_LIMIT",
    ),
    contactsPerCompany: parsePositiveInt(
      process.env.CONTACTS_PER_COMPANY,
      DEFAULTS.CONTACTS_PER_COMPANY,
      LIMITS.CONTACTS_PER_COMPANY,
      "CONTACTS_PER_COMPANY",
    ),
    apiDelayMs: parsePositiveInt(
      process.env.API_DELAY_MS,
      DEFAULTS.API_DELAY_MS,
      LIMITS.API_DELAY_MS,
      "API_DELAY_MS",
    ),
    retryMaxAttempts: parsePositiveInt(
      process.env.RETRY_MAX_ATTEMPTS,
      DEFAULTS.RETRY_MAX_ATTEMPTS,
      LIMITS.RETRY_MAX_ATTEMPTS,
      "RETRY_MAX_ATTEMPTS",
    ),
  };
}
