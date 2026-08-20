import { AnalyticsRepository } from "@fiao/database";
import { createLoginHandler } from "./handler";

export const runtime = "nodejs";

const analytics = new AnalyticsRepository();

export const POST = createLoginHandler({
  recordEvent: (input) => analytics.record(input)
});
