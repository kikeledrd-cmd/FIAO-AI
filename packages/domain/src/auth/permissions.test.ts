import { describe, expect, it } from "vitest";
import { can } from "./permissions";

describe("can", () => {
  it("allows owner and cashier to read and sync", () => {
    for (const role of ["OWNER", "CASHIER"] as const) {
      expect(can(role, "APP_READ")).toBe(true);
      expect(can(role, "SYNC_PUSH")).toBe(true);
      expect(can(role, "SYNC_PULL")).toBe(true);
    }
  });

  it("reserves OWNER_PROTECTED for an owner", () => {
    expect(can("OWNER", "OWNER_PROTECTED")).toBe(true);
    expect(can("CASHIER", "OWNER_PROTECTED")).toBe(false);
  });
});
