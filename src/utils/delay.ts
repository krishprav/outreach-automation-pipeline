/**
 * Pause execution for a given number of milliseconds.
 * Used between API calls to avoid rate-limiting.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
