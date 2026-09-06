// 【2026-09-06 正式CLI対応】楽天API照合へ渡す候補の安全な選出ロジックのテスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runResearch } from "../pipeline.js";
import { attachPreScore, selectCandidatesForRakuten, detectAnimalTypeFromKeyword } from "../gkp-selection.js";

function makeCsvContent(rows) {
  const header =
    "keyword,monthlySearches,competitionLevel,competitionIndex,lowTopOfPageBid,highTopOfPageBid,impressions,clicks,ctr,averagePosition,trendIndex,country,language,periodStart,periodEnd,sourceProvider,isSynthetic,rawReference";
  const lines = rows.map(
    (r) =>
      `${r.keyword},${r.monthlySearches},${r.competitionLevel ?? "LOW"},${r.competitionIndex ?? 10},,,,,,,,JP,ja,2025-08-01,2026-07-31,google_keyword_planner,false,test`
  );
  return [header, ...lines].join("\n") + "\n";
}

async function withTempCsv(rows, fn) {
  const dir = await mkdtemp(join(tmpdir(), "gkp-selection-"));
  const filePath = join(dir, "test.csv");
  await writeFile(filePath, makeCsvContent(rows), "utf-8");
  try {
    return await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("detectAnimalTypeFromKeyword: 犬語彙・猫語彙・両方・どちらでもない場合を正しく判定する", () => {
  assert.equal(detectAnimalTypeFromKeyword("国産 ドッグフード"), "dog");
  assert.equal(detectAnimalTypeFromKeyword("国産 キャットフード"), "cat");
  assert.equal(detectAnimalTypeFromKeyword("犬 猫 生活"), "ambiguous");
  assert.equal(detectAnimalTypeFromKeyword("送料無料"), "unknown");
});

test("businessValidated=falseの候補は選出プールから除外される", async () => {
  await withTempCsv([{ keyword: "国産 無添加 ドッグフード", monthlySearches: 5000 }], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const withPreScore = attachPreScore(researchResult.candidates, researchResult.config);
    // manual_csvはsourceProviderが"google_keyword_planner"でperiod等が揃っていればbusinessValidated=trueになるはずだが、
    // ここではsourceProviderを検証しない別ケースとして、意図的に出所を弱める
    const forcedInvalid = withPreScore.map((c) => ({ ...c, preScore: { ...c.preScore, businessValidated: false } }));
    const { selected, excluded } = selectCandidatesForRakuten(forcedInvalid);
    assert.equal(selected.length, 0);
    assert.equal(excluded.length, 1);
    assert.ok(excluded[0].reasons.includes("BUSINESS_DATA_NOT_VALIDATED"));
  });
});

test("医療関連語(safetyStatus=MEDICAL_REVIEW_REQUIRED)は選出プールから除外される", async () => {
  await withTempCsv([{ keyword: "シニア ドッグフード 腎臓", monthlySearches: 5000 }], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const withPreScore = attachPreScore(researchResult.candidates, researchResult.config);
    const { selected, excluded } = selectCandidatesForRakuten(withPreScore);
    assert.equal(selected.length, 0);
    assert.ok(excluded.some((e) => e.reasons.includes("MEDICAL_REVIEW_REQUIRED")));
  });
});

test("健康訴求語(safetyStatus=HEALTH_REVIEW_REQUIRED)は選出プールから除外される", async () => {
  await withTempCsv([{ keyword: "シニア 犬 ダイエット フード", monthlySearches: 5000 }], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const withPreScore = attachPreScore(researchResult.candidates, researchResult.config);
    const { selected, excluded } = selectCandidatesForRakuten(withPreScore);
    assert.equal(selected.length, 0);
    assert.ok(excluded.some((e) => e.reasons.includes("HEALTH_REVIEW_REQUIRED")));
  });
});

test("購入意図が無い(INFORMATIONAL等)候補は選出プールから除外される", async () => {
  await withTempCsv([{ keyword: "ドッグフード とは", monthlySearches: 5000 }], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const withPreScore = attachPreScore(researchResult.candidates, researchResult.config);
    const { selected, excluded } = selectCandidatesForRakuten(withPreScore);
    assert.equal(selected.length, 0);
    assert.ok(excluded.some((e) => e.reasons.includes("NO_PURCHASE_INTENT")));
  });
});

test("犬50件・猫50件を基本とし、--max-rakuten-keywordsで全体件数を制限する", async () => {
  const dogRows = Array.from({ length: 80 }, (_, i) => ({ keyword: `国産 無添加 ドッグフード ${i}`, monthlySearches: 500 + i }));
  const catRows = Array.from({ length: 80 }, (_, i) => ({ keyword: `国産 無添加 キャットフード ${i}`, monthlySearches: 500 + i }));
  await withTempCsv([...dogRows, ...catRows], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const withPreScore = attachPreScore(researchResult.candidates, researchResult.config);
    const { selected, poolStats } = selectCandidatesForRakuten(withPreScore, { maxKeywords: 100 });
    assert.equal(selected.length, 100);
    assert.equal(poolStats.selectedDogCount, 50);
    assert.equal(poolStats.selectedCatCount, 50);
  });
});

test("--max-rakuten-keywordsを100未満に設定すると、全948件を誤って一括照合しない(上限が効く)", async () => {
  const dogRows = Array.from({ length: 30 }, (_, i) => ({ keyword: `国産 無添加 ドッグフード ${i}`, monthlySearches: 500 + i }));
  await withTempCsv(dogRows, async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const withPreScore = attachPreScore(researchResult.candidates, researchResult.config);
    const { selected } = selectCandidatesForRakuten(withPreScore, { maxKeywords: 10 });
    assert.ok(selected.length <= 10, "上限を超えて選出しない");
  });
});

test("選出プールに健康訴求語・医療語が1件も残らない", async () => {
  const rows = [
    { keyword: "国産 無添加 ドッグフード", monthlySearches: 5000 },
    { keyword: "シニア ドッグフード 腎臓", monthlySearches: 5000 },
    { keyword: "シニア 犬 ダイエット フード", monthlySearches: 5000 },
  ];
  await withTempCsv(rows, async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const withPreScore = attachPreScore(researchResult.candidates, researchResult.config);
    const { selected } = selectCandidatesForRakuten(withPreScore);
    assert.equal(
      selected.filter((c) => c.safetyStatus !== "SAFE").length,
      0,
      "選出された候補は全てsafetyStatus=SAFEであること"
    );
  });
});

test("スコアの高い順に選出される(preScore.total降順)", async () => {
  const rows = [
    { keyword: "国産 無添加 ドッグフード 低需要", monthlySearches: 10 },
    { keyword: "国産 無添加 ドッグフード 高需要", monthlySearches: 40000 },
  ];
  await withTempCsv(rows, async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const withPreScore = attachPreScore(researchResult.candidates, researchResult.config);
    const { selected } = selectCandidatesForRakuten(withPreScore, { maxKeywords: 1, dogLimit: 1, catLimit: 0 });
    assert.equal(selected.length, 1);
    assert.ok(selected[0].originalKeyword.includes("高需要"), "スコアの高い候補が優先的に選出される");
  });
});
