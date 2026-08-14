import { AuthRepository } from "@fiao/database";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACTIVE_BRANCH_COOKIE_NAME, hashSessionToken, SESSION_COOKIE_NAME } from "@/lib/session/current-session";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (rawToken) {
    const repository = new AuthRepository();
    await repository.revokeSessionByTokenHash(hashSessionToken(rawToken), new Date());
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", expires: new Date(0) });
  response.cookies.set(ACTIVE_BRANCH_COOKIE_NAME, "", { path: "/", expires: new Date(0) });
  return response;
}
