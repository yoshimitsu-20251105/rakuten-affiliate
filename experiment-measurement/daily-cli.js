import { createWifClients } from "./google-live.js";
import { readFileSync } from "node:fs";
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
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const start = read("../strategy/experiment-reviews/2026-11-29/senior-cat-internal-link-start.json");
  if (!config || ["experimentId", "targetUrl", "day0"].some((key) => config[key] !== start[key])) {
    throw new Error("START_REGISTER_MISMATCH");
  }
  const historical = read("../strategy/experiments.json").items.find(
    (item) => item.experimentId === "exp-2026-10-05-senior-cat-food",
  );
  const success = historical?.successThreshold?.impressionsCumulative;
  const falsification = historical?.killThreshold?.impressionsCumulativeAtReviewDate;
  if (!Number.isSafeInteger(success) || !Number.isSafeInteger(falsification) || success <= falsification) {
    throw new Error("APPROVED_THRESHOLDS_REQUIRED");
  }
  const status = await runDailyMeasurement({
    config, storage, approvedReview: { date: start.reviewDate, success, falsification }, now: new Date(), collect: (scope) => collectDailyGoogleRows({ ...scope, clients }),
  });
  process.stdout.write(`Daily measurement: ${status}\n`);
} catch {
  process.stderr.write("DAILY_MEASUREMENT_FAILED\n");
  process.exitCode = 1;
}
