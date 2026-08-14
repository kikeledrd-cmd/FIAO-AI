export interface AttemptThrottleOptions {
  threshold?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  maxEntries?: number;
}

interface AttemptEntry {
  failures: number;
  lockedUntil: number;
}

export class AttemptThrottle {
  private readonly entries = new Map<string, AttemptEntry>();
  private readonly threshold: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxEntries: number;

  constructor(options: AttemptThrottleOptions = {}) {
    this.threshold = options.threshold ?? 3;
    this.baseBackoffMs = options.baseBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 8_000;
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  remainingMs(key: string, now: number): number {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    return Math.max(0, entry.lockedUntil - now);
  }

  recordFailure(key: string, now: number): void {
    const previous = this.entries.get(key);
    const failures = (previous?.failures ?? 0) + 1;
    const exponent = Math.max(0, failures - this.threshold);
    const backoffMs = failures < this.threshold
      ? 0
      : Math.min(this.baseBackoffMs * 2 ** exponent, this.maxBackoffMs);

    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, { failures, lockedUntil: now + backoffMs });
    this.prune();
  }

  clear(key: string): void {
    this.entries.delete(key);
  }

  private prune(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) return;
      this.entries.delete(oldestKey);
    }
  }
}
