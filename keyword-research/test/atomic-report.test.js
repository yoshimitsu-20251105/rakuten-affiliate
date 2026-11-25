import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomicReport } from "../../lib/atomic-report.js";

test("report commits one complete generation and rejects competing writers", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "atomic-report-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const results = await Promise.allSettled(["a", "b"].map((id) =>
    writeAtomicReport(root, "same-id", { "report.md": id, "report.json": { id } })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "EEXIST");
  const id = await readFile(join(root, "same-id", "report.md"), "utf8");
  assert.deepEqual(JSON.parse(await readFile(join(root, "same-id", "report.json"), "utf8")), { id });
  await assert.rejects(writeAtomicReport(root, "same-id", { "report.md": "changed" }), { code: "EEXIST" });
  assert.equal(await readFile(join(root, "same-id", "report.md"), "utf8"), id);
  assert.deepEqual(await readdir(root), ["same-id"]);
});

test("failed staging leaves no visible run and existing empty runs are protected", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "atomic-report-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(writeAtomicReport(root, "failed", { "ok.md": "ok", "absent/test": "fail" }), { code: "ENOENT" });
  assert.deepEqual(await readdir(root), []);
  await mkdir(join(root, "reserved"));
  await assert.rejects(writeAtomicReport(root, "reserved", { "report.md": "changed" }), { code: "EEXIST" });
  assert.deepEqual(await readdir(join(root, "reserved")), []);
});
