import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthRepository } from "@fiao/database";
import { ACTIVE_BRANCH_COOKIE_NAME, requireSession } from "@/lib/session/current-session";

export const runtime = "nodejs";

const switchBranchSchema = z.object({
  branchId: z.string().min(1).max(64)
});

export async function POST(request: Request) {
  const parsed = switchBranchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BRANCH" }, { status: 400 });
  }

  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const repository = new AuthRepository();
  let access;
  try {
    access = await repository.verifyBranchAccess(session.userId, parsed.data.branchId);
  } catch {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (access.ownerId !== session.ownerId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const response = NextResponse.json({ activeBranchId: parsed.data.branchId });
  response.cookies.set(ACTIVE_BRANCH_COOKIE_NAME, parsed.data.branchId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  });
  return response;
}
