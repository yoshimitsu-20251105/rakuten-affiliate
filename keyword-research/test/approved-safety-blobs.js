import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const approvedSafetyBlobs = new Map([
  ["daily-audit/policy.js", "df1af5c1e06f8c2a7b177117630a1bd9394d04ff"],
  ["keyword-research/test/revenue-protection-helpers.js", "4ce9d8ffcaa1cd9ad9f0603c4b164773ed5e7cb4"],
]);

export function assertApprovedSafetyBlobs(repo) {
  for (const [path, expected] of approvedSafetyBlobs) {
    const bytes = readFileSync(join(repo, path));
    const actual = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(actual, expected, `Unapproved safety blob: ${path}`);
  }
}
