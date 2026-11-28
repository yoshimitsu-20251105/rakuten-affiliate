import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const approvedSafetyBlobs = new Map([
  ["daily-audit/policy.js", "4e8e76abce6c45e0d608ede03571c2ed49372195"],
  ["keyword-research/test/revenue-protection-helpers.js", "4ce9d8ffcaa1cd9ad9f0603c4b164773ed5e7cb4"],
]);

export function assertApprovedSafetyBlobs(repo) {
  for (const [path, expected] of approvedSafetyBlobs) {
    const bytes = readFileSync(join(repo, path));
    const actual = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(actual, expected, `Unapproved safety blob: ${path}`);
  }
}
