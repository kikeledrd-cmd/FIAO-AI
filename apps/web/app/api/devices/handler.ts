import { DeviceRepository } from "@fiao/database";
import { NextResponse } from "next/server";
import { requireSession, SessionRequiredError } from "@/lib/session/current-session";

export const runtime = "nodejs";

export function createDevicesHandler(dependencies?: { repository?: DeviceRepository }) {
  const repository = dependencies?.repository ?? new DeviceRepository();

  return async function devices(): Promise<NextResponse> {
    try {
      const session = await requireSession();
      if (session.role !== "OWNER") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      const items = await repository.listByOwner(session.ownerId);
      return NextResponse.json({ devices: items });
    } catch (error) {
      if (error instanceof SessionRequiredError) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
      throw error;
    }
  };
}
