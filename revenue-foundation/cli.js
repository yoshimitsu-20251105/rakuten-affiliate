import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildRadar, radarScorerContext } from "./radar.js";
import { evaluateQuality } from "./quality-gate.js";
import { buildLegacyInventory } from "./inventory.js";
import { validateInputs } from "../opportunity-scorer/model.js";

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
async function main() {
  const [command, input, scannerPath, extra] = process.argv.slice(2);
  if (extra) throw Error("Too many arguments");
  if (command === "inventory" && !input) return buildLegacyInventory(fileURLToPath(new URL("../docs/", import.meta.url)));
  if (command === "quality" && input) {
    const verifiedEvidence = scannerPath ? await json(scannerPath) : [];
    return evaluateQuality(await json(input), { verifiedEvidence });
  }
  if (command === "radar" && input && !scannerPath) return buildRadar(await json(input));
  if (command === "scorer-context" && input && scannerPath) {
    const scanner = await json(scannerPath);
    const context = radarScorerContext(scanner, buildRadar(await json(input)));
    validateInputs(scanner, context);
    return context;
  }
  throw Error("Expected inventory, quality <input> [verified-register], radar <input>, or scorer-context <radar-input> <scanner-report>");
}

main().then((result) => console.log(JSON.stringify(result, null, 2))).catch(() => {
  console.error("[revenue-foundation] Invalid command, input contract, or file");
  process.exitCode = 1;
});
