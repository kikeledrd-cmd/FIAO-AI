import { databaseClient } from "@fiao/database/client";

export const testDb = databaseClient;

const TABLES = [
  "SyncConflict",
  "SyncChange",
  "ClientOperation",
  "AuditEvent",
  "OwnerAuthorization",
  "Session",
  "Device",
  "UserBranch",
  "User",
  "Branch",
  "OwnerAccount"
] as const;

export async function resetDatabase(): Promise<void> {
  // TRUNCATE ... CASCADE evita errores de orden de FKs y deja la DB limpia.
  await testDb.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`
  );
}
