import { deviceRevokeRequestSchema } from "@fiao/contracts/settings";
import { DeviceRepository } from "@fiao/database";
import { NextResponse } from "next/server";
import { requireSession, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

export function createDeviceRevokeHandler(dependencies?: { repository?: DeviceRepository }) {
  const repository = dependencies?.repository ?? new DeviceRepository();

  return async function deviceRevoke(request: Request): Promise<NextResponse> {
    try {
      const session = await requireSession();
      if (session.role !== "OWNER") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      const parsed = deviceRevokeRequestSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

      const revoked = await repository.revoke(session.ownerId, parsed.data.deviceId);
      if (!revoked) return NextResponse.json({ error: "DEVICE_NOT_FOUND" }, { status: 404 });
      return NextResponse.json({ ok: true });
    } catch (error) {
      if (error instanceof SessionRequiredError) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
      throw error;
    }
  };
}
