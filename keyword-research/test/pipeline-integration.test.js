// 統合テスト: fixture → 正規化 → intent → cluster → 楽天mock → scoring → report の一連処理。
// 楽天APIは実ネットワークを使わず、注入したmock検索関数を使う(外部認証なしでテストが通ること)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { runResearch, runMapRakuten } from "../pipeline.js";
import { writeReports } from "../report.js";
import { isPublishEligible } from "../approval.js";

const RAKUTEN_FIXTURE = JSON.parse(
  await readFile(new URL("../fixtures/rakuten-items.fixture.json", import.meta.url), "utf-8")
);

async function mockSearch(keyword) {
  // キーワードのトークンが半分以上含まれる商品だけを返す簡易mock(実ネットワーク不要)
  const tokens = keyword.split(" ").filter(Boolean);
  const items = RAKUTEN_FIXTURE.filter((item) => {
    const text = `${item.itemName} ${item.catchcopy}`;
    const hit = tokens.filter((t) => text.includes(t)).length;
    return tokens.length === 0 || hit / tokens.length >= 0.34;
  });
  return { items, count: items.length, source: "mock" };
}

test("fixture→正規化→intent→cluster→楽天mock→scoringの一連処理が例外なく完走する", async () => {
  const researchResult = await runResearch({}); // manualCsvPath未指定 → fixtureソースを使用
  assert.ok(researchResult.candidates.length > 0);

  const mapped = await runMapRakuten(researchResult, { searchFn: mockSearch, usedFixtureFallback: false });
  assert.equal(mapped.length, researchResult.candidates.length);

  for (const c of mapped) {
    assert.ok(["PRIORITY", "TEST", "OBSERVE", "REJECT"].includes(c.scoreBand));
    assert.ok(["PRIORITY", "TEST", "OBSERVE", "REJECT", "UNVALIDATED"].includes(c.decisionStatus));
    assert.ok(typeof c.finalPriority === "number");
  }
});

test("医療関連キーワードは楽天照合をスキップし、常にREJECTになる(自動公開禁止)", async () => {
  const researchResult = await runResearch({});
  const mapped = await runMapRakuten(researchResult, { searchFn: mockSearch });
  const medical = mapped.find((c) => c.intent === "MEDICAL_REVIEW_REQUIRED");
  assert.ok(medical, "fixtureに医療関連キーワードが含まれている前提");
  assert.equal(medical.scoreBand, "REJECT");
  assert.equal(medical.decisionStatus, "UNVALIDATED");
  assert.equal(medical.eligibleForApproval, false);
  assert.equal(medical.rakuten.searchSource, "skipped");
});

test("国産無添加ドッグフードクラスターの候補は楽天ELIGIBLE商品が見つかる(fixture同士の整合性)", async () => {
  const researchResult = await runResearch({});
  const mapped = await runMapRakuten(researchResult, { searchFn: mockSearch });
  const target = mapped.find((c) => c.cluster.clusterId === "domestic-additive-free-dog-food" && c.canonicalKeyword.length < 30);
  assert.ok(target);
  assert.ok(target.rakuten.eligibleCount >= 1);
});

test("一部キーワードの楽天API呼び出しが失敗しても、他のキーワードは部分成功する", async () => {
  const researchResult = await runResearch({});
  let calls = 0;
  const flakySearch = async (keyword) => {
    calls++;
    if (calls === 2) throw new Error("楽天APIエラー: 一時的なタイムアウト");
    return mockSearch(keyword);
  };
  const mapped = await runMapRakuten(researchResult, { searchFn: flakySearch });
  const failed = mapped.filter((c) => c.rakuten.searchSource === "error");
  const succeeded = mapped.filter((c) => c.rakuten.searchSource === "mock");
  assert.ok(failed.length >= 1, "1件は失敗している想定");
  assert.ok(succeeded.length >= 1, "他のキーワードは成功している想定(部分成功)");
  assert.equal(failed[0].scoreBand, "REJECT"); // 失敗したものを誤ってPRIORITY等にしない
  assert.equal(failed[0].decisionStatus, "UNVALIDATED");
});

test("レポート生成(summary.md + 5種CSV)が一時ディレクトリに出力される", async () => {
  const researchResult = await runResearch({});
  const mapped = await runMapRakuten(researchResult, { searchFn: mockSearch });
  const outDir = `keyword-research/output/__test-report-${Date.now()}`;
  const { summaryPath } = await writeReports(
    { candidates: mapped, sourceMetas: researchResult.sourceMetas, config: researchResult.config },
    { outDir, mode: "dry-run", runId: "test" }
  );
  const files = await readdir(outDir);
  assert.ok(files.includes("summary.md"));
  assert.ok(files.includes("keyword-candidates.csv"));
  assert.ok(files.includes("keyword-scores.csv"));
  assert.ok(files.includes("rakuten-matches.csv"));
  assert.ok(files.includes("needs-review.csv"));
  assert.ok(files.includes("rejected.csv"));
  const summary = await readFile(summaryPath, "utf-8");
  assert.match(summary, /dry-runのため/);

  await rm(outDir, { recursive: true, force: true });
});

test("dry-run実行前後で本番ファイル(articles-data.json)が変更されない", async () => {
  const prodFile = new URL("../../articles-data.json", import.meta.url);
  const before = await stat(prodFile);

  const researchResult = await runResearch({});
  await runMapRakuten(researchResult, { searchFn: mockSearch });

  const after = await stat(prodFile);
  assert.equal(before.mtimeMs, after.mtimeMs);
  assert.equal(before.size, after.size);
});

test("未承認のキーワードはpublish相当のフィルタを通過しない(承認ゲートの統合確認)", async () => {
  const researchResult = await runResearch({});
  const mapped = await runMapRakuten(researchResult, { searchFn: mockSearch });

  const canonicalApprovedSet = new Set(); // 何も承認していない状態

  const passed = mapped.filter((c) => {
    const check = isPublishEligible(
      {
        canonicalKeyword: c.canonicalKeyword,
        matchStatus: c.rakuten.eligibleCount > 0 ? "ELIGIBLE" : "REJECTED",
        intent: c.intent,
        hasQualityScore: c.bestProductQualityScore > 0,
        businessValidated: c.businessValidated,
      },
      canonicalApprovedSet
    );
    return check.eligible;
  });

  assert.equal(passed.length, 0, "承認ファイルが空なら1件も公開対象にならない");
});
