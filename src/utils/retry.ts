import { sleep } from "./delay.js";

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Override default retryability check. Return true to retry. */
  shouldRetry?: (error: unknown) => boolean;
  /** Called before each retry attempt (1-indexed). */
  onRetry?: (attempt: number, error: unknown) => void;
}

const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;
const JITTER_MAX_MS = 200;

/** HTTP status codes that indicate a transient, retryable failure. */
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

interface HttpErrorLike {
  response?: { status?: number };
  code?: string;
}

function isHttpErrorLike(error: unknown): error is HttpErrorLike {
  return typeof error === "object" && error !== null;
}

function getStatusCode(error: unknown): number | undefined {
  if (!isHttpErrorLike(error)) return undefined;
  return error.response?.status;
}

function isNetworkError(error: unknown): boolean {
  if (!isHttpErrorLike(error)) return false;
  const networkCodes = ["ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND"];
  return error.code !== undefined && networkCodes.includes(error.code);
}

/**
 * Default retryability: network errors and HTTP 429/502/503/504.
 * Does NOT retry 400/401/403/404. Those won't succeed on retry.
 */
export function isRetryableError(error: unknown): boolean {
  if (isNetworkError(error)) return true;

  const status = getStatusCode(error);
  if (status !== undefined) {
    return RETRYABLE_STATUS_CODES.has(status);
  }

  return false;
}

function calculateBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
  return Math.min(exponential + jitter, maxDelayMs);
}

/**
 * Execute an async function with exponential backoff retry.
 *
 * Backoff: baseDelay * 2^attempt + random jitter (0–200ms).
 * Retries only on transient failures (rate limits, 5xx, network errors).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    maxAttempts,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    shouldRetry = isRetryableError,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === maxAttempts - 1;
      if (isLastAttempt || !shouldRetry(error)) {
        throw error;
      }

      const delayMs = calculateBackoff(attempt, baseDelayMs, maxDelayMs);
      onRetry?.(attempt + 1, error);
      await sleep(delayMs);
    }
  }

  // Unreachable if maxAttempts >= 1, but satisfies TypeScript
  throw lastError;
}
