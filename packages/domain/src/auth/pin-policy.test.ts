import { describe, expect, it } from "vitest";
import { validatePin } from "./pin-policy";

describe("PIN policy", () => {
  it.each(["1234", "12345", "123456"])("accepts %s", (pin) => {
    expect(validatePin(pin)).toBe(true);
  });

  it.each(["123", "1234567", "12a4", ""])("rejects %s", (pin) => {
    expect(validatePin(pin)).toBe(false);
  });
});
