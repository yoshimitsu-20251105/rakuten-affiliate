// strategy/cli/validate.js の validateExperimentLifecycle() を検証する。
// 「RUNNINGなのに未公開」「PLANNEDなのに実測baselineが確定済み扱い」等の矛盾を
// 防ぐための意味的検証(スキーマのtype/enumだけでは防げない整合性)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateExperimentLifecycle } from "../cli/validate.js";

const SITE_URL = "https://example.test/site";

function baseExperiment(overrides = {}) {
  return {
    experimentId: "exp-test-1",
    title: "test",
    hypothesis: "test",
    falsificationCondition: "test",
    targetUrls: [],
    targetKeywords: [],
    trafficSource: null,
    monetizationSource: null,
    startDate: null,
    reviewDate: null,
    baseline: null,
    successThreshold: null,
    killThreshold: null,
    metrics: null,
    result: null,
    decision: null,
    learnings: [],
    status: "PLANNED",
    ...overrides,
  };
}

test("PLANNED: startDate/reviewDate/baselineが全てnullなら問題なし", () => {
  const errors = validateExperimentLifecycle([baseExperiment()], { projectRoot: "/tmp/does-not-matter/", siteUrl: SITE_URL });
  assert.deepEqual(errors, []);
});

test("PLANNED: startDateが設定済みの場合はエラー(ページ作成日と実験開始日の混同を防ぐ)", () => {
  const errors = validateExperimentLifecycle([baseExperiment({ startDate: "2026-10-05" })], { projectRoot: "/tmp/does-not-matter/", siteUrl: SITE_URL });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /startDateはnullである必要があります/);
});

test("PLANNED: reviewDateが設定済みの場合はエラー", () => {
  const errors = validateExperimentLifecycle([baseExperiment({ reviewDate: "2026-11-04" })], { projectRoot: "/tmp/does-not-matter/", siteUrl: SITE_URL });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /reviewDateはnullである必要があります/);
});

test("PLANNED: baselineが確定済みの場合はエラー(未公開のため実測できない)", () => {
  const errors = validateExperimentLifecycle([baseExperiment({ baseline: { impressions: 0 } })], { projectRoot: "/tmp/does-not-matter/", siteUrl: SITE_URL });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /baselineはnullである必要があります/);
});

test("RUNNING: startDateが無い場合はエラー", () => {
  const errors = validateExperimentLifecycle(
    [baseExperiment({ status: "RUNNING", targetUrls: [`${SITE_URL}/rankings/does-not-matter.html`] })],
    { projectRoot: "/tmp/does-not-matter/", siteUrl: SITE_URL }
  );
  assert.ok(errors.some((e) => e.includes("startDate")));
});

test("RUNNING: targetUrlsが空の場合はエラー", () => {
  const errors = validateExperimentLifecycle(
    [baseExperiment({ status: "RUNNING", startDate: "2026-09-10", targetUrls: [] })],
    { projectRoot: "/tmp/does-not-matter/", siteUrl: SITE_URL }
  );
  assert.ok(errors.some((e) => e.includes("targetUrls")));
});

test("RUNNING: targetUrlsが指すファイルが実在しない場合はエラー(未公開の可能性)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "strategy-lifecycle-test-"));
  try {
    const projectRoot = `${dir.replace(/\\/g, "/")}/`;
    const errors = validateExperimentLifecycle(
      [
        baseExperiment({
          status: "RUNNING",
          startDate: "2026-09-10",
          targetUrls: [`${SITE_URL}/rankings/senior-cat-food.html`],
        }),
      ],
      { projectRoot, siteUrl: SITE_URL }
    );
    assert.ok(errors.some((e) => e.includes("対象ファイルが存在しません")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("RUNNING: targetUrlsが指すファイルが実在する場合は問題なし(本番公開の裏付けあり)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "strategy-lifecycle-test-"));
  try {
    await mkdir(join(dir, "docs", "rankings"), { recursive: true });
    await writeFile(join(dir, "docs", "rankings", "senior-dog-pork.html"), "<html></html>", "utf-8");
    const projectRoot = `${dir.replace(/\\/g, "/")}/`;
    const errors = validateExperimentLifecycle(
      [
        baseExperiment({
          status: "RUNNING",
          startDate: "2026-09-10",
          targetUrls: [`${SITE_URL}/rankings/senior-dog-pork.html`],
        }),
      ],
      { projectRoot, siteUrl: SITE_URL }
    );
    assert.deepEqual(errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const status of ["SUCCESS", "FAILED", "INCONCLUSIVE", "STOPPED"]) {
  test(`終了状態(${status}): result/decision/metricsが揃っていない場合はエラー`, () => {
    const errors = validateExperimentLifecycle([baseExperiment({ status })], { projectRoot: "/tmp/does-not-matter/", siteUrl: SITE_URL });
    assert.ok(errors.some((e) => e.includes("result") && e.includes("必須")));
    assert.ok(errors.some((e) => e.includes("decision") && e.includes("必須")));
    assert.ok(errors.some((e) => e.includes("metrics")));
  });

  test(`終了状態(${status}): result/decision/metricsが揃っていれば問題なし`, () => {
    const errors = validateExperimentLifecycle(
      [
        baseExperiment({
          status,
          result: status === "SUCCESS" ? "SUCCESS" : status === "FAILED" ? "FAILED" : "INCONCLUSIVE",
          decision: "HOLD",
          metrics: [{ metric: "search_console_impressions", value: 5, sourceType: "api", source: "google_search_console_data_api", observedAt: "2026-10-10" }],
        }),
      ],
      { projectRoot: "/tmp/does-not-matter/", siteUrl: SITE_URL }
    );
    assert.deepEqual(errors, []);
  });
}

test("実際のstrategy/experiments.jsonは全てのライフサイクル検証をパスする(回帰防止)", async () => {
  const { validateAll } = await import("../cli/validate.js");
  const { fileResults } = validateAll();
  assert.equal(fileResults["experiments.json"].valid, true, fileResults["experiments.json"].errors.join("\n"));
});
