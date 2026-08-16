import { createOwnerAuthorizeHandler } from "./handler";

export const runtime = "nodejs";

export const POST = createOwnerAuthorizeHandler();
