import { readFileSync } from "node:fs";
import { buildExperimentReport } from "./report.js";
import { collectGoogleRows, createWifClients } from "./google-live.js";

try {
  if (process.argv.length !== 3 || process.env.EXPERIMENT_GOOGLE_LIVE !== "true" ||
      !process.env.EXPERIMENT_GOOGLE_ACCESS_TOKEN?.trim()) throw new Error("LIVE_GATE_CLOSED");
  const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const { experimentId, targetUrl, startDate, endDate, asOf, day0, baseline, finalThrough } = input;
  const scope = { experimentId, targetUrl, startDate, endDate, asOf, day0, baseline, finalThrough };
  buildExperimentReport({ ...scope, rows: [] });
  const result = await collectGoogleRows({ ...scope, clients: createWifClients(process.env.EXPERIMENT_GOOGLE_ACCESS_TOKEN) });
  process.stderr.write(JSON.stringify(result.status) + "\n");
  if (!result.ok) {
    process.exitCode = 1;
  } else {
    process.stdout.write(JSON.stringify({
      ...buildExperimentReport({ ...scope, rows: result.rows }),
      dataOrigin: "GOOGLE_LIVE",
      sources: result.status,
      googleDateBasis: { gsc: "America/Los_Angeles", ga4: "PROPERTY_TIME_ZONE" },
    }, null, 2) + "\n");
  }
} catch {
  process.stderr.write("Google live collection stopped. Check live opt-in, token, input and response format.\n");
  process.exitCode = 1;
}
