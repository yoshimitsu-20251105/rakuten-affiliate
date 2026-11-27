import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const privateRoots = new Set([
  "reports/learning-engine/runs", "reports/experiment-selector", "reports/acquisition-planner",
  "reports/market-scanner", "reports/opportunity-scorer", "reports/funnel-measurement/report-runs",
]);

export function assertReportRoot(root, approved = privateRoots) {
  const subpath = relative(repository, resolve(root)).replaceAll("\\", "/");
  if (!isAbsolute(subpath) && subpath !== ".." && !subpath.startsWith("../") && !approved.has(subpath)) {
    throw new Error("Report output must use its private directory or an external temporary directory");
  }
}

// Reserve the ID beside the destination. Windows cannot rename a directory
// onto the empty destination directory used by the previous reservation.
export async function writeAtomicReport(root, runId, files) {
  assertReportRoot(root);
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("Invalid report run ID");
  const lock = join(root, `.lock-${runId}`);
  const destination = join(root, runId);
  await mkdir(lock, { mode: 0o700 });
  try {
    const existing = await lstat(destination).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (existing) throw Object.assign(new Error("EEXIST: Report run already exists"), { code: "EEXIST" });

    const staging = await mkdtemp(join(root, ".pending-"));
    try {
      for (const [name, value] of Object.entries(files)) {
        const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
        await writeFile(join(staging, name), text, { flag: "wx", mode: 0o600, flush: true });
      }
      // Each file is fsynced and closed before the single same-parent rename.
      await rename(staging, destination);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  } finally {
    await rm(lock, { recursive: true });
  }
}
