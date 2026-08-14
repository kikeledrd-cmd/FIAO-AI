import { databaseClient } from "@fiao/database/client";

export const testDb = databaseClient;

export async function resetDatabase(): Promise<void> {
  await testDb.$transaction([
    testDb.syncConflict.deleteMany(),
    testDb.syncChange.deleteMany(),
    testDb.auditEvent.deleteMany(),
    testDb.ownerAuthorization.deleteMany(),
    testDb.session.deleteMany(),
    testDb.clientOperation.deleteMany(),
    testDb.device.deleteMany(),
    testDb.userBranch.deleteMany(),
    testDb.user.deleteMany(),
    testDb.branch.deleteMany(),
    testDb.ownerAccount.deleteMany()
  ]);
}
