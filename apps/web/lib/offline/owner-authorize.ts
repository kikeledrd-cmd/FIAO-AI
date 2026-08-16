import { apiJson } from "@/lib/api/client";

export interface OwnerAuthorizationResult {
  authorizationId: string;
  expiresAt: string;
}

/** Emite una OwnerAuthorization ligada a un operationId (TTL 5 min). */
export async function requestOwnerAuthorization(input: {
  branchId: string;
  purpose: "STOCK_ADJUSTMENT" | "SALE_REVERSAL";
  targetOperationId: string;
  pin: string;
}): Promise<OwnerAuthorizationResult> {
  return apiJson<OwnerAuthorizationResult>("/api/owner/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
}
