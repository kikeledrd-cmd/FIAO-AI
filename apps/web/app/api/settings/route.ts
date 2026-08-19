import { createSettingsHandler } from "./handler";

export const runtime = "nodejs";

const handler = createSettingsHandler();

export const GET = handler.get;
export const PUT = handler.put;
