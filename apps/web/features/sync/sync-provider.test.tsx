import "fake-indexeddb/auto";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncProvider, useSync } from "./sync-provider";
import { offlineDb } from "@/lib/offline/db";

function Probe() {
  const { status, sync } = useSync();
  return <button onClick={() => void sync()}>{status}</button>;
}

describe("SyncProvider", () => {
  afterEach(async () => {
    await offlineDb.pendingOperations.clear();
    await offlineDb.syncConflicts.clear();
  });

  it("surfaces conflict status after a sync result creates local review work", async () => {
    const branchId = "33333333-3333-4333-8333-333333333333";
    await offlineDb.syncConflicts.put({
      id: "c1",
      ownerId: "22222222-2222-4222-8222-222222222222",
      operationId: "11111111-1111-4111-8111-111111111111",
      branchId,
      kind: "CONFLICT",
      envelope: {
        operationId: "11111111-1111-4111-8111-111111111111",
        type: "NOOP",
        ownerId: "22222222-2222-4222-8222-222222222222",
        branchId,
        actorUserId: "55555555-5555-4555-8555-555555555555",
        deviceId: "66666666-6666-4666-8666-666666666666",
        occurredAt: new Date().toISOString(),
        baseCursor: null,
        payload: {},
        queuedAt: new Date().toISOString()
      },
      result: {
        operationId: "11111111-1111-4111-8111-111111111111",
        status: "ACCEPTED_WITH_CONFLICT",
        conflictId: "c1",
        latestCursor: "1"
      },
      createdAt: new Date().toISOString()
    });

    render(<SyncProvider branchId={branchId} syncRunner={vi.fn(async () => ({ pushed: 0, accepted: 0, conflicts: 1, rejected: 0, pulled: 0, cursor: "1" }))}><Probe /></SyncProvider>);
    await act(async () => {});
    expect(await screen.findByRole("button", { name: "CONFLICT" })).toBeVisible();
  });
});
