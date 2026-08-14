import { describe, expect, it } from "vitest";
import { centsToPesos, normalizePhoneDO, pesosToCents } from "@fiao/contracts/common";

describe("money", () => {
  it("converts pesos without floating point", () => {
    expect(pesosToCents("530.50")).toBe(53050n);
    expect(centsToPesos(53050n)).toBe("530.50");
  });

  it.each(["1.001", "-1", "1,20", "", "abc"])("rejects invalid pesos %s", (input) => {
    expect(() => pesosToCents(input)).toThrow("INVALID_MONEY");
  });
});

describe("Dominican phone normalization", () => {
  it.each([
    ["809-555-0123", "+18095550123"],
    ["(829) 555-0123", "+18295550123"],
    ["1 849 555 0123", "+18495550123"],
    ["+1 809 555 0123", "+18095550123"],
  ])("normalizes %s", (raw, expected) => {
    expect(normalizePhoneDO(raw)).toBe(expected);
  });

  it.each(["2125550123", "+1809555ABCD", "809555012", ""])("rejects %s", (raw) => {
    expect(() => normalizePhoneDO(raw)).toThrow("INVALID_PHONE");
  });
});
