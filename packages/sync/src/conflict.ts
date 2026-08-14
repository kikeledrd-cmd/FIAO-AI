export type SyncConflictKind = "GENERIC_REVIEW";

export interface ConflictDescriptor {
  kind: SyncConflictKind;
  details: Record<string, unknown>;
}

export function conflict(kind: SyncConflictKind, details: Record<string, unknown>): ConflictDescriptor {
  return { kind, details };
}
