import { describe, expect, it } from "vitest";
import { reduceFoundationChange } from "./local-reducer";

const change = {
  cursor: "10",
  ownerId: "22222222-2222-4222-8222-222222222222",
  branchId: "33333333-3333-4333-8333-333333333333",
  type: "NOOP",
  payload: { operationId: "11111111-1111-4111-8111-111111111111", type: "NOOP" },
  createdAt: "2026-08-13T20:00:00.000Z"
};

describe("reduceFoundationChange", () => {
  it("creates a stable branch-scoped projection row", () => {
    expect(reduceFoundationChange(change)).toMatchObject({
      key: `${change.ownerId}:${change.branchId}:NOOP:${change.payload.operationId}`,
      ownerId: change.ownerId,
      branchId: change.branchId,
      cursor: "10"
    });
  });

  it("rejects malformed foundation payloads", () => {
    expect(() => reduceFoundationChange({ ...change, payload: {} })).toThrow("INVALID_SYNC_CHANGE_PAYLOAD");
  });
});
