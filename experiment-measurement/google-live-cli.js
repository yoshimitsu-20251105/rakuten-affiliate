import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildExperimentReport, ReportValidationError } from "./report.js";
import { collectGoogleRows, createWifClients, ResponseValidationError } from "./google-live.js";

export async function runGoogleLiveCli({
  args = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  createClients = createWifClients,
} = {}) {
  let stage = "AUTH_ERROR";
  try {
    const token = env.EXPERIMENT_GOOGLE_ACCESS_TOKEN;
    if (env.EXPERIMENT_GOOGLE_LIVE !== "true" || !token?.trim()) throw new Error("LIVE_GATE_CLOSED");
    stage = "REPORT_VALIDATION_ERROR";
    if (args.length !== 1) throw new Error("INVALID_ARGUMENTS");
    const { experimentId, targetUrl, startDate, endDate, asOf, day0, baseline, finalThrough } =
      JSON.parse(readFileSync(args[0], "utf8"));
    const scope = { experimentId, targetUrl, startDate, endDate, asOf, day0, baseline, finalThrough };
    buildExperimentReport({ ...scope, rows: [] });

    stage = "AUTH_ERROR";
    const clients = createClients(token);
    stage = "FETCH_ERROR";
    const result = await collectGoogleRows({ ...scope, clients });
    stderr.write(JSON.stringify(result.status) + "\n");
    if (!result.ok) {
      const statuses = Object.values(result.status);
      if (statuses.includes("INVALID_RESPONSE")) stage = "RESPONSE_VALIDATION_ERROR";
      else if (statuses.some((s) => s === "UNAUTHENTICATED" || s === "PERMISSION_DENIED")) stage = "AUTH_ERROR";
      stderr.write(JSON.stringify({
        error: stage,
        ...(result.invalidResponseReasons ? { reasons: result.invalidResponseReasons } : {}),
      }) + "\n");
      return 1;
    }

    stage = "REPORT_GENERATION_ERROR";
    const report = buildExperimentReport({ ...scope, rows: result.rows });
    stdout.write(JSON.stringify({
      ...report,
      dataOrigin: "GOOGLE_LIVE",
      sources: result.status,
      googleDateBasis: { gsc: "America/Los_Angeles", ga4: "PROPERTY_TIME_ZONE" },
    }, null, 2) + "\n");
    return 0;
  } catch (error) {
    const responseError = error instanceof ResponseValidationError;
    const reportError = error instanceof ReportValidationError;
    stderr.write(JSON.stringify({
      error: responseError ? "RESPONSE_VALIDATION_ERROR" : reportError ? "REPORT_VALIDATION_ERROR" : stage,
      ...(responseError ? { reason: error.message } : reportError ? { reason: error.code } : {}),
    }) + "\n");
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await runGoogleLiveCli();
}
