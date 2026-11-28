import { readFileSync } from "node:fs";
import { buildExperimentReport } from "./report.js";

try {
  if (process.argv.length !== 3) throw new Error("Expected one input file");
  const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
  process.stdout.write(JSON.stringify(buildExperimentReport(input), null, 2) + "\n");
} catch {
  process.stderr.write("Experiment report rejected: check the input file and measurement scope.\n");
  process.exitCode = 1;
}
