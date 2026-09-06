// 【2026-09-06 PR#4監査対応】keywords:import-gkp / keywords:gkp-dry-run 共通処理のテスト。
// --max-rakuten-keywordsの検証(正の整数のみ、100件が絶対上限)と、
// 出力先ディレクトリの排他作成(同時実行時の上書き競合防止)を検証する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateMaxRakutenKeywords,
  createExclusiveRunDir,
  sanitizeRunId,
  writeFailureMetadata,
  evaluateApiErrorRate,
} from "../cli/gkp-cli-common.js";
import { runResearch, runMapRakuten } from "../pipeline.js";
import { writeReports } from "../report.js";

test("--max-rakuten-keywords: 100は成功する(絶対上限ちょうど)", () => {
  const result = validateMaxRakutenKeywords("100");
  assert.equal(result.ok, true);
  assert.equal(result.value, 100);
});

test("--max-rakuten-keywords: 101は失敗する(絶対上限超過)", () => {
  const result = validateMaxRakutenKeywords("101");
  assert.equal(result.ok, false);
  assert.match(result.message, /絶対上限/);
});

test("--max-rakuten-keywords: 小数は失敗する", () => {
  const result = validateMaxRakutenKeywords("50.5");
  assert.equal(result.ok, false);
});

test("--max-rakuten-keywords: 0は失敗する", () => {
  const result = validateMaxRakutenKeywords("0");
  assert.equal(result.ok, false);
});

test("--max-rakuten-keywords: 負数は失敗する", () => {
  const result = validateMaxRakutenKeywords("-5");
  assert.equal(result.ok, false);
});

test("--max-rakuten-keywords: 未指定時は既定値100が使われ成功する", () => {
  const result = validateMaxRakutenKeywords(undefined);
  assert.equal(result.ok, true);
  assert.equal(result.value, 100);
});

test("--max-rakuten-keywords: 非数値文字列は失敗する", () => {
  const result = validateMaxRakutenKeywords("abc");
  assert.equal(result.ok, false);
});

test("sanitizeRunId: パス区切り等の危険な文字を除去する", () => {
  assert.equal(sanitizeRunId("2026-09-06T12:34:56.789+09:00"), "2026-09-06T12-34-56-789-09-00");
  assert.equal(sanitizeRunId("../../etc"), "------etc");
});

test("createExclusiveRunDir: 存在しないディレクトリを作成できる", async () => {
  const root = await mkdtemp(join(tmpdir(), "gkp-exclusive-"));
  try {
    const target = join(root, "run-1");
    await createExclusiveRunDir(target, root);
    const entries = await readdir(root);
    assert.ok(entries.includes("run-1"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createExclusiveRunDir: 既に存在するディレクトリへは作成できず、分かりやすいエラーになる", async () => {
  const root = await mkdtemp(join(tmpdir(), "gkp-exclusive-"));
  try {
    const target = join(root, "run-1");
    await createExclusiveRunDir(target, root);
    await assert.rejects(() => createExclusiveRunDir(target, root), /既に存在します/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createExclusiveRunDir: 同時に2つ作成しようとした場合、片方だけ成功し片方はエラーになる(競合防止)", async () => {
  const root = await mkdtemp(join(tmpdir(), "gkp-exclusive-"));
  try {
    const target = join(root, "same-run-id");
    const results = await Promise.allSettled([
      createExclusiveRunDir(target, root),
      createExclusiveRunDir(target, root),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "同時実行では片方だけ成功すること");
    assert.equal(rejected.length, 1, "もう片方は既に存在するエラーになること");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evaluateApiErrorRate: 異常率が閾値を超えるとexceeded=trueになる", () => {
  const mapped = [
    { rakutenLookupStatus: "API_ERROR" },
    { rakutenLookupStatus: "API_ERROR" },
    { rakutenLookupStatus: "SUCCESS" },
  ];
  const result = evaluateApiErrorRate(mapped, 0.5);
  assert.equal(result.apiErrorCount, 2);
  assert.equal(result.attemptedCount, 3);
  assert.ok(Math.abs(result.apiErrorRate - 2 / 3) < 1e-9);
  assert.equal(result.exceeded, true);
});

test("evaluateApiErrorRate: 閾値以下ならexceeded=falseになる", () => {
  const mapped = [{ rakutenLookupStatus: "API_ERROR" }, { rakutenLookupStatus: "SUCCESS" }, { rakutenLookupStatus: "SUCCESS" }];
  const result = evaluateApiErrorRate(mapped, 0.5);
  assert.equal(result.exceeded, false);
});

test("evaluateApiErrorRate: NOT_RUN(楽天照合対象外)は分母から除外する", () => {
  const mapped = [{ rakutenLookupStatus: "NOT_RUN" }, { rakutenLookupStatus: "NOT_RUN" }, { rakutenLookupStatus: "API_ERROR" }];
  const result = evaluateApiErrorRate(mapped, 0.5);
  assert.equal(result.attemptedCount, 1);
  assert.equal(result.apiErrorRate, 1);
  assert.equal(result.exceeded, true);
});

test("楽天APIが持続的に失敗する場合(fetchをmock)、run-metadata.jsonのstatusがfailedになる(gkp-dry-run.jsと同じ経路)", async () => {
  const { mkdtemp, writeFile: writeFileP, rm: rmP } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "gkp-apierror-"));
  const csvPath = join(dir, "test.csv");
  const csvHeader =
    "keyword,monthlySearches,competitionLevel,competitionIndex,lowTopOfPageBid,highTopOfPageBid,impressions,clicks,ctr,averagePosition,trendIndex,country,language,periodStart,periodEnd,sourceProvider,isSynthetic,rawReference";
  const csvRow =
    "国産 無添加 ドッグフード,5000,LOW,10,,,,,,,,JP,ja,2025-08-01,2026-07-31,google_keyword_planner,false,test";
  await writeFileP(csvPath, `${csvHeader}\n${csvRow}\n`, "utf-8");

  const outDir = join(dir, "report");
  try {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    // fetchそのものではなく、このコードベースの既存のモック境界(searchFn)で
    // 「楽天APIが持続的に失敗する」状況を再現する(rakuten-match.js内部でfetchを
    // 直接モックする場合と等価に、search()呼び出しが常に例外を投げる状況を作る)。
    const alwaysFailingSearch = async () => {
      throw new Error("楽天APIエラー: HTTP 500");
    };
    const mapped = await runMapRakuten(researchResult, { searchFn: alwaysFailingSearch });

    const errorEval = evaluateApiErrorRate(mapped, 0.5);
    assert.equal(errorEval.exceeded, true, "全件API_ERRORのため閾値を超えるはず");

    await writeReports(
      { candidates: mapped, sourceMetas: researchResult.sourceMetas, config: researchResult.config },
      { outDir, mode: "test", runId: "test", status: errorEval.exceeded ? "failed" : "completed" }
    );

    const { readFile } = await import("node:fs/promises");
    const metadata = JSON.parse(await readFile(join(outDir, "run-metadata.json"), "utf-8"));
    assert.equal(metadata.status, "failed");
  } finally {
    await rmP(dir, { recursive: true, force: true });
  }
});

test("writeFailureMetadata: 部分的に書き出されたファイルを削除し、status=failedのメタデータだけを残す", async () => {
  const root = await mkdtemp(join(tmpdir(), "gkp-failmeta-"));
  try {
    const outDir = join(root, "run-1");
    await createExclusiveRunDir(outDir, root);
    const { writeFile } = await import("node:fs/promises");
    // 途中まで書き出された想定のCSVを用意しておく
    await writeFile(join(outDir, "converted-all.csv"), "dummy", "utf-8");

    await writeFailureMetadata(outDir, "run-1", "import-gkp", new Error("テスト失敗"));

    const entries = await readdir(outDir);
    assert.deepEqual(entries, ["run-metadata.json"], "失敗時はrun-metadata.jsonだけが残ること");
    const { readFile } = await import("node:fs/promises");
    const metadata = JSON.parse(await readFile(join(outDir, "run-metadata.json"), "utf-8"));
    assert.equal(metadata.status, "failed");
    assert.equal(metadata.error, "テスト失敗");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
