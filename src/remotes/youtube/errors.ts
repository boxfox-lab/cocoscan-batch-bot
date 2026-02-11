import axios from "axios";

export class QuotaExceededError extends Error {
  constructor(apiKey?: string) {
    const masked = apiKey ? apiKey.substring(0, 10) + "..." : "unknown";
    super(`YouTube API quota exceeded (key: ${masked})`);
    this.name = "QuotaExceededError";
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (error.response?.status !== 403) return false;

  const errors = error.response?.data?.error?.errors;
  if (!Array.isArray(errors)) return false;

  return errors.some(
    (e: { reason?: string }) =>
      e.reason === "quotaExceeded" || e.reason === "dailyLimitExceeded",
  );
}
