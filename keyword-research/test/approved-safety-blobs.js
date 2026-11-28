import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const approvedSafetyBlobs = new Map([
  ["daily-audit/policy.js", "e1692438c486846e5ebf69f7fa8a1a2b8a671600"],
  ["keyword-research/test/revenue-protection-helpers.js", "4ce9d8ffcaa1cd9ad9f0603c4b164773ed5e7cb4"],
]);

export function assertApprovedSafetyBlobs(repo) {
  for (const [path, expected] of approvedSafetyBlobs) {
    const bytes = readFileSync(join(repo, path));
    const actual = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(actual, expected, `Unapproved safety blob: ${path}`);
  }
}
