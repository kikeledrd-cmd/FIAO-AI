import { describe, expect, it } from "vitest";
import { FIAO_DOMAIN_VERSION } from "./index";

describe("domain package", () => {
  it("exports a version marker", () => {
    expect(FIAO_DOMAIN_VERSION).toBe("v1");
  });
});
