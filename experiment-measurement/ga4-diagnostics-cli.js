import { createWifClients } from "./google-live.js";
import { createPrivateObjectStore } from "./private-storage.js";
import { collectGa4Diagnostics } from "./ga4-diagnostics.js";

try {
  if (process.env.GA4_DIAGNOSTICS_LIVE !== "true") throw new Error("LIVE_GATE_CLOSED");
  const storage = createPrivateObjectStore({
    bucket: process.env.DAILY_MEASUREMENT_BUCKET,
    accessToken: process.env.DAILY_STORAGE_ACCESS_TOKEN,
  });
  const { analyticsdata } = createWifClients(process.env.EXPERIMENT_GOOGLE_ACCESS_TOKEN);
  const report = await collectGa4Diagnostics({
    client: analyticsdata, now: new Date(), propertyTimezone: process.env.GA4_PROPERTY_TIMEZONE,
    confirmedThrough: process.env.GA4_CONFIRMED_THROUGH,
  });
  const status = await storage.create(`diagnostics/ga4/${report.range.endDate}.json`, report);
  process.stdout.write(`GA4 diagnostics: ${status}\n`);
} catch {
  process.stderr.write("GA4_DIAGNOSTICS_FAILED\n");
  process.exitCode = 1;
}
