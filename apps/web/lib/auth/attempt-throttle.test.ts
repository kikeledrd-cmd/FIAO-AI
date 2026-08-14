import { describe, expect, it } from "vitest";
import { AttemptThrottle } from "./attempt-throttle";

describe("AttemptThrottle", () => {
  it("applies deterministic exponential backoff after the threshold", () => {
    const throttle = new AttemptThrottle({ threshold: 3, baseBackoffMs: 500, maxBackoffMs: 8_000 });
    const now = 1_000;

    throttle.recordFailure("phone", now);
    throttle.recordFailure("phone", now);
    expect(throttle.remainingMs("phone", now)).toBe(0);

    throttle.recordFailure("phone", now);
    expect(throttle.remainingMs("phone", now)).toBe(500);
    expect(throttle.remainingMs("phone", now + 500)).toBe(0);

    throttle.recordFailure("phone", now + 500);
    expect(throttle.remainingMs("phone", now + 500)).toBe(1_000);
  });

  it("bounds retained keys to prevent unbounded memory growth", () => {
    const throttle = new AttemptThrottle({ threshold: 1, baseBackoffMs: 500, maxEntries: 2 });
    throttle.recordFailure("one", 0);
    throttle.recordFailure("two", 0);
    throttle.recordFailure("three", 0);

    expect(throttle.remainingMs("one", 0)).toBe(0);
    expect(throttle.remainingMs("two", 0)).toBe(500);
    expect(throttle.remainingMs("three", 0)).toBe(500);
  });
});
