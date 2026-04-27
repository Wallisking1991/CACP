export interface FixedWindowRateLimiterOptions {
  windowMs: number;
  limit: number;
}

interface Bucket {
  windowStart: number;
  count: number;
}

export class FixedWindowRateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private readonly options: FixedWindowRateLimiterOptions) {}

  allow(key: string, now = Date.now()): boolean {
    const existing = this.buckets.get(key);
    if (!existing || now - existing.windowStart >= this.options.windowMs) {
      this.buckets.set(key, { windowStart: now, count: 1 });
      return true;
    }
    if (existing.count >= this.options.limit) return false;
    existing.count += 1;
    return true;
  }
}
