import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { approvedSafetyBlobs, assertApprovedSafetyBlobs } from "./approved-safety-blobs.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const paths = [...approvedSafetyBlobs.keys()];

test("the approved blob list itself matches its reviewed Git blob", async () => {
  const bytes = await readFile(new URL("./approved-safety-blobs.js", import.meta.url));
  const id = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  assert.equal(id, "c3a18231bd289a5eedf228e5b0f4347f9dd873e4", "Unapproved change to the safety blob list");
});

for (const changed of [[paths[0]], [paths[1]], paths]) {
  test(`approved Git blobs reject edits to ${changed.join(" and ")}`, async (t) => {
    const fixture = await mkdtemp(join(tmpdir(), "safety-blobs-"));
    t.after(() => rm(fixture, { recursive: true, force: true }));
    for (const path of paths) {
      const target = join(fixture, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readFile(join(repo, path)));
    }
    assertApprovedSafetyBlobs(fixture);
    for (const path of changed) {
      const target = join(fixture, path);
      await writeFile(target, "\n// Unapproved fixture edit\n", { flag: "a" });
    }
    assert.throws(() => assertApprovedSafetyBlobs(fixture), /Unapproved safety blob/);
  });
}
