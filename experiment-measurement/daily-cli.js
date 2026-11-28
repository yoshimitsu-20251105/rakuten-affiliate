import { createWifClients } from "./google-live.js";
import { collectDailyGoogleRows } from "./daily-google.js";
import { runDailyMeasurement } from "./daily.js";
import { createPrivateObjectStore } from "./private-storage.js";

try {
  if (process.env.DAILY_MEASUREMENT_LIVE !== "true") throw new Error("LIVE_GATE_CLOSED");
  const clients = createWifClients(process.env.EXPERIMENT_GOOGLE_ACCESS_TOKEN);
  const storage = createPrivateObjectStore({
    bucket: process.env.DAILY_MEASUREMENT_BUCKET,
    accessToken: process.env.DAILY_STORAGE_ACCESS_TOKEN,
  });
  const config = await storage.read("config/active-experiment.json");
  const status = await runDailyMeasurement({
    config, storage, now: new Date(), collect: (scope) => collectDailyGoogleRows({ ...scope, clients }),
  });
  process.stdout.write(`Daily measurement: ${status}\n`);
} catch {
  process.stderr.write("DAILY_MEASUREMENT_FAILED\n");
  process.exitCode = 1;
}
