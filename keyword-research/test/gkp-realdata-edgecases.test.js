// 【2026-09-05 GKP実データ監査対応】実データ検証で判明した具体的な問題を
// fixture化し、pipeline全体を通してテストする。

import { test } from "node:test";
import assert from "node:assert/strict";
import { runResearch, runMapRakuten } from "../pipeline.js";

function makeCsvContent(rows) {
  const header =
    "keyword,monthlySearches,competitionLevel,competitionIndex,lowTopOfPageBid,highTopOfPageBid,impressions,clicks,ctr,averagePosition,trendIndex,country,language,periodStart,periodEnd,sourceProvider,isSynthetic,rawReference";
  const lines = rows.map(
    (r) =>
      `${r.keyword},${r.monthlySearches},${r.competitionLevel ?? "LOW"},${r.competitionIndex ?? 50},,,,,,,,JP,ja,2025-08-01,2026-07-31,google_keyword_planner,false,test`
  );
  return [header, ...lines].join("\n") + "\n";
}

async function withTempCsv(rows, fn) {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "gkp-edgecase-"));
  const filePath = join(dir, "test.csv");
  await writeFile(filePath, makeCsvContent(rows), "utf-8");
  try {
    return await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ELIGIBLE_ITEM = {
  itemCode: "shop:1",
  itemName: "国産 無添加 ドッグフード 犬用",
  catchcopy: "",
  itemCaption: "",
  reviewAverage: 4.5,
  reviewCount: 300,
};

async function alwaysSucceedSearch() {
  return { items: [ELIGIBLE_ITEM, ELIGIBLE_ITEM, ELIGIBLE_ITEM], count: 3, source: "mock" };
}

test("【監査対応】楽天APIエラーでもbusinessValidated=trueが維持される(以前は無条件でfalseに上書きされていた)", async () => {
  await withTempCsv([{ keyword: "シニア 犬 の 餌", monthlySearches: 500 }], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const failingSearch = async () => {
      throw new Error("楽天APIエラー: wrong_parameter keyword is not valid");
    };
    const mapped = await runMapRakuten(researchResult, { searchFn: failingSearch });
    assert.equal(mapped.length, 1);
    // rakutenQueryが助詞除去済みで有効なため実際にsearch()が呼ばれ、そこでエラーになる想定
    assert.equal(mapped[0].businessValidated, true, "需要データ自体は検証済みのまま維持される");
    assert.equal(mapped[0].rakutenLookupStatus, "API_ERROR");
    assert.equal(mapped[0].rakutenSupplyStatus, "NOT_EVALUATED");
    assert.equal(mapped[0].decisionStatus, "SUPPLY_LOOKUP_ERROR");
    assert.ok(!mapped[0].publishBlockReasons.includes("BUSINESS_DATA_NOT_VALIDATED"), "BUSINESS_DATA_NOT_VALIDATEDを付与しない");
    assert.ok(mapped[0].publishBlockReasons.includes("RAKUTEN_LOOKUP_ERROR"));
  });
});

test("【監査対応】APIエラー候補は承認・出力・掲載不可(businessValidated=trueでも)", async () => {
  await withTempCsv([{ keyword: "国産 の キャットフード", monthlySearches: 1000 }], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const failingSearch = async () => {
      throw new Error("楽天APIエラー: wrong_parameter keyword is not valid");
    };
    const mapped = await runMapRakuten(researchResult, { searchFn: failingSearch });
    assert.equal(mapped[0].businessValidated, true);
    assert.equal(mapped[0].eligibleForApproval, false);
    assert.equal(mapped[0].eligibleForExport, false);
    assert.equal(mapped[0].eligibleForPublish, false);
  });
});

test("【監査対応】originalKeywordがpipeline全体を通して保持される(書き換えられない)", async () => {
  await withTempCsv([{ keyword: "国産 無 添加 ドッグフード", monthlySearches: 500 }], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const candidate = researchResult.candidates[0];
    assert.equal(candidate.originalKeyword, "国産 無 添加 ドッグフード");
    const mapped = await runMapRakuten(researchResult, { searchFn: alwaysSucceedSearch });
    assert.equal(mapped[0].originalKeyword, "国産 無 添加 ドッグフード", "map-rakuten後もoriginalKeywordは変わらない");
    // normalizedKeywordは分割語が統合されている(originalKeywordとは異なる)
    assert.ok(mapped[0].normalizedKeyword.split(" ").includes("無添加"));
  });
});

test("【監査対応】rakutenQueryの加工(助詞除去)が需要データ(businessValidated/WebKeywordScore)へ影響しない", async () => {
  await withTempCsv(
    [
      { keyword: "シニア 犬 の 餌", monthlySearches: 500 },
      { keyword: "シニア 犬 餌", monthlySearches: 500 },
    ],
    async (csvPath) => {
      const researchResult = await runResearch({ manualCsvPath: csvPath });
      const mapped = await runMapRakuten(researchResult, { searchFn: alwaysSucceedSearch });
      // 助詞の有無で正規化キーが変わり別候補として扱われるが(意図的に統合しない)、
      // どちらもbusinessValidated=trueであり、rakutenQueryの有無で需要スコアの
      // demand/purchaseIntent成分自体は変わらないことを確認する
      const withParticle = mapped.find((c) => c.originalKeyword === "シニア 犬 の 餌");
      const withoutParticle = mapped.find((c) => c.originalKeyword === "シニア 犬 餌");
      assert.ok(withParticle && withoutParticle);
      assert.equal(withParticle.webKeywordScore.demand, withoutParticle.webKeywordScore.demand);
      assert.equal(withParticle.businessValidated, true);
      assert.equal(withoutParticle.businessValidated, true);
    }
  );
});

test("【監査対応】医療語彙を含む候補は楽天照合をスキップし、businessValidated=trueでもMEDICAL_REVIEW_REQUIREDとして自動承認不可", async () => {
  await withTempCsv([{ keyword: "シニア ドッグフード 腎臓", monthlySearches: 500 }], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const mapped = await runMapRakuten(researchResult, { searchFn: alwaysSucceedSearch });
    assert.equal(mapped[0].safetyStatus, "MEDICAL_REVIEW_REQUIRED");
    assert.equal(mapped[0].businessValidated, true, "需要データ自体は検証済み");
    assert.equal(mapped[0].decisionStatus, "MEDICAL_REVIEW_REQUIRED");
    assert.equal(mapped[0].eligibleForApproval, false);
    assert.equal(mapped[0].rakutenLookupStatus, "NOT_RUN", "医療関連のため楽天APIを呼び出さない");
  });
});

test("【監査対応】健康訴求語彙を含む候補もbusinessValidated=trueで自動承認不可", async () => {
  await withTempCsv([{ keyword: "シニア 犬 ダイエット フード", monthlySearches: 500 }], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const mapped = await runMapRakuten(researchResult, { searchFn: alwaysSucceedSearch });
    assert.equal(mapped[0].safetyStatus, "HEALTH_REVIEW_REQUIRED");
    assert.equal(mapped[0].decisionStatus, "HEALTH_REVIEW_REQUIRED");
    assert.equal(mapped[0].eligibleForApproval, false);
  });
});

test("【監査対応】不自然なキーワード(MALFORMED)は楽天照合をスキップし自動候補にならない", async () => {
  await withTempCsv([{ keyword: "11 12", monthlySearches: 500 }], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const mapped = await runMapRakuten(researchResult, { searchFn: alwaysSucceedSearch });
    assert.equal(mapped[0].queryQualityStatus, "MALFORMED");
    assert.equal(mapped[0].decisionStatus, "MALFORMED_KEYWORD");
    assert.equal(mapped[0].eligibleForApproval, false);
    assert.equal(mapped[0].rakutenLookupStatus, "NOT_RUN");
  });
});

test("【監査対応】無効な楽天クエリ(助詞除去後に空)は楽天APIを呼ばずINVALID_RAKUTEN_QUERYになる", async () => {
  await withTempCsv([{ keyword: "の に", monthlySearches: 500 }], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    let searchCalled = false;
    const trackingSearch = async () => {
      searchCalled = true;
      return alwaysSucceedSearch();
    };
    const mapped = await runMapRakuten(researchResult, { searchFn: trackingSearch });
    assert.equal(searchCalled, false, "楽天APIを呼び出していないこと");
    assert.equal(mapped[0].rakutenLookupStatus, "NOT_RUN");
    assert.equal(mapped[0].decisionStatus, "INVALID_RAKUTEN_QUERY");
    assert.equal(mapped[0].eligibleForApproval, false);
  });
});

test("正常系: businessValidated=true・safetyStatus=SAFE・queryQualityStatus=VALID・楽天ELIGIBLEな候補は承認可能になる", async () => {
  await withTempCsv([{ keyword: "国産 無添加 ドッグフード", monthlySearches: 5000, competitionLevel: "LOW" }], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const mapped = await runMapRakuten(researchResult, { searchFn: alwaysSucceedSearch });
    assert.equal(mapped[0].businessValidated, true);
    assert.equal(mapped[0].safetyStatus, "SAFE");
    assert.equal(mapped[0].queryQualityStatus, "VALID");
    assert.equal(mapped[0].rakutenLookupStatus, "SUCCESS");
    assert.equal(mapped[0].rakutenSupplyStatus, "ELIGIBLE");
    assert.equal(mapped[0].eligibleForApproval, true);
  });
});
