// 【2026-09-05 GKP実データ監査対応】実データ検証で判明した具体的な問題を
// fixture化し、pipeline全体を通してテストする。

import { test } from "node:test";
import assert from "node:assert/strict";
import { runResearch, runMapRakuten } from "../pipeline.js";
import { evaluateDecision } from "../decision.js";

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

test("【監査対応】医療語彙を含む候補は楽天照合をスキップし、businessValidated=trueでもMEDICAL_REVIEW_REQUIREDとして承認候補にならない", async () => {
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

test("【監査対応】健康訴求語彙を含む候補もbusinessValidated=trueで承認候補にならない", async () => {
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

test("【監査対応】無効な楽天クエリ(助詞除去後に空)は楽天APIを呼ばずdecisionStatus=SUPPLY_NOT_EVALUATEDになる", async () => {
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
    assert.equal(mapped[0].decisionStatus, "SUPPLY_NOT_EVALUATED");
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
    assert.equal(mapped[0].decisionStatus, mapped[0].scoreBand, "rakutenSupplyStatus=ELIGIBLEの場合のみdecisionStatus=scoreBandになる");
    assert.equal(mapped[0].eligibleForApproval, true);
  });
});

// 【2026-09-05 マージ前最終監査対応】楽天商品供給ゲート(rakutenSupplyStatus)。
// 実データで「ELIGIBLE商品が1件しかない(INSUFFICIENT)候補が、スコアが十分高いという
// 理由だけでeligibleForApproval=trueになってしまう」バグが見つかったため、
// rakutenSupplyStatusを明示的なゲートとして固定する。
//
// 【2026-09-05 マージ前最終監査(2周目)対応】さらに、eligibleForApprovalだけでなく
// decisionStatus自体もscoreBandを名乗らないようにした(以前はrakutenLookupStatus=SUCCESS
// でありさえすれば、rakutenSupplyStatus=NO_MATCH/INSUFFICIENTでもdecisionStatus=scoreBand
// になっており、楽天商品供給が無い候補でもdecisionStatus=PRIORITYになり得るという
// 設計上の矛盾があった)。scoreBand自体は需要スコアからそのまま保持され、楽天供給状況では
// 書き換えられないことも合わせて確認する。

async function oneEligibleItemSearch() {
  return { items: [ELIGIBLE_ITEM], count: 1, source: "mock" }; // ELIGIBLE商品1件 → INSUFFICIENT
}

async function zeroItemSearch() {
  return { items: [], count: 0, source: "mock" }; // 商品0件 → NO_MATCH
}

// 高得点(scoreBand=PRIORITYまたはTEST)を安定して出す高需要キーワード。
const HIGH_DEMAND_KEYWORD = { keyword: "国産 無添加 ドッグフード", monthlySearches: 5000, competitionLevel: "LOW" };

test("【監査対応】rakutenSupplyStatus=INSUFFICIENT(ELIGIBLE商品1件、最低基準3件未満)は、scoreBandが高くてもdecisionStatus=SUPPLY_INSUFFICIENTになり、eligibleForApproval=falseになる", async () => {
  await withTempCsv([HIGH_DEMAND_KEYWORD], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const mapped = await runMapRakuten(researchResult, { searchFn: oneEligibleItemSearch });
    assert.equal(mapped[0].rakutenSupplyStatus, "INSUFFICIENT");
    assert.equal(mapped[0].businessValidated, true, "需要データは検証済みのまま");
    assert.ok(["PRIORITY", "TEST"].includes(mapped[0].scoreBand), "高需要キーワードのためscoreBandはPRIORITYまたはTESTのはず(前提条件)");
    // decisionStatusはscoreBandをそのまま名乗らず、専用のSUPPLY_INSUFFICIENTになる
    assert.equal(mapped[0].decisionStatus, "SUPPLY_INSUFFICIENT");
    assert.notEqual(mapped[0].decisionStatus, mapped[0].scoreBand);
    assert.equal(mapped[0].eligibleForApproval, false);
    assert.equal(mapped[0].eligibleForExport, false);
    assert.equal(mapped[0].eligibleForPublish, false);
    assert.ok(mapped[0].publishBlockReasons.some((r) => r.includes("SUPPLY_INSUFFICIENT")));
  });
});

test("【監査対応】rakutenSupplyStatus=NO_MATCH(商品0件)は、需要データ自体は高くてもdecisionStatus=SUPPLY_NO_MATCHになり、eligibleForApproval=falseになる", async () => {
  await withTempCsv([HIGH_DEMAND_KEYWORD], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const mapped = await runMapRakuten(researchResult, { searchFn: zeroItemSearch });
    assert.equal(mapped[0].rakutenSupplyStatus, "NO_MATCH");
    assert.equal(mapped[0].businessValidated, true);
    assert.ok(mapped[0].webKeywordScore.total >= 60, "高需要キーワードのためWebKeywordScore自体は一定以上高いはず(前提条件、商品0件のためbestProductQualityScoreが0になりscoreBand自体はREJECTになり得るが、その場合でも本テストの主眼はdecisionStatusがPRIORITYを名乗らないことの確認)");
    assert.equal(mapped[0].decisionStatus, "SUPPLY_NO_MATCH");
    assert.notEqual(mapped[0].decisionStatus, "PRIORITY", "楽天商品が0件ならdecisionStatus=PRIORITYには絶対にならない");
    assert.equal(mapped[0].eligibleForApproval, false);
  });
});

test("【監査対応】rakutenLookupStatus=NOT_RUNの候補はrakutenSupplyStatus=NOT_EVALUATEDになり、decisionStatus=SUPPLY_NOT_EVALUATEDになり(PRIORITYにはならない)、eligibleForApproval=falseになる", async () => {
  // safetyStatus=SAFE・queryQualityStatus=VALIDだが、助詞のみのため楽天クエリが無効(空)になり
  // rakutenLookupStatus=NOT_RUNになるケース(医療・健康訴求語ではないことをここで独立に確認する)。
  await withTempCsv([{ keyword: "の に", monthlySearches: 5000, competitionLevel: "LOW" }], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    assert.equal(researchResult.candidates[0].safetyStatus, "SAFE", "医療・健康訴求語が原因のNOT_RUNではないことの前提条件");
    const mapped = await runMapRakuten(researchResult, { searchFn: alwaysSucceedSearch });
    assert.equal(mapped[0].rakutenLookupStatus, "NOT_RUN");
    assert.equal(mapped[0].rakutenSupplyStatus, "NOT_EVALUATED");
    assert.equal(mapped[0].decisionStatus, "SUPPLY_NOT_EVALUATED");
    assert.notEqual(mapped[0].decisionStatus, "PRIORITY");
    assert.equal(mapped[0].eligibleForApproval, false);
  });
});

test("【監査対応】rakutenLookupStatus=API_ERRORの候補はrakutenSupplyStatus=NOT_EVALUATEDになり、businessValidated=trueを維持しつつdecisionStatus=SUPPLY_LOOKUP_ERROR(scoreBandが高くてもPRIORITYにはならない)、eligibleForApproval=falseになる", async () => {
  await withTempCsv([{ keyword: "国産 の キャットフード", monthlySearches: 5000, competitionLevel: "LOW" }], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const failingSearch = async () => {
      throw new Error("楽天APIエラー: wrong_parameter keyword is not valid");
    };
    const mapped = await runMapRakuten(researchResult, { searchFn: failingSearch });
    assert.equal(mapped[0].rakutenLookupStatus, "API_ERROR");
    assert.equal(mapped[0].rakutenSupplyStatus, "NOT_EVALUATED");
    assert.equal(mapped[0].businessValidated, true);
    assert.equal(mapped[0].decisionStatus, "SUPPLY_LOOKUP_ERROR");
    assert.notEqual(mapped[0].decisionStatus, "PRIORITY");
    assert.equal(mapped[0].eligibleForApproval, false);
  });
});

test("【監査対応】rakutenSupplyStatus=ELIGIBLE(最低3件以上)のみがeligibleForApproval=trueになり得る(3件ちょうどの境界値)。ELIGIBLEに到達して初めてscoreBandによる判定へ進む", async () => {
  await withTempCsv([HIGH_DEMAND_KEYWORD], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const threeItemsSearch = async () => ({ items: [ELIGIBLE_ITEM, ELIGIBLE_ITEM, ELIGIBLE_ITEM], count: 3, source: "mock" });
    const mapped = await runMapRakuten(researchResult, { searchFn: threeItemsSearch });
    assert.equal(mapped[0].rakutenSupplyStatus, "ELIGIBLE");
    assert.equal(mapped[0].decisionStatus, mapped[0].scoreBand, "ELIGIBLEの場合のみdecisionStatus=scoreBandになる");
    assert.equal(mapped[0].eligibleForApproval, true);
  });
});

test("【監査対応】rakutenSupplyStatus=ELIGIBLEでもscoreBand=REJECT(需要が低い)なら承認不可のまま", async () => {
  await withTempCsv([{ keyword: "国産 無添加 ドッグフード", monthlySearches: 1, competitionLevel: "HIGH" }], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    const moderateQualityItem = { ...ELIGIBLE_ITEM, reviewAverage: 3.5, reviewCount: 20 };
    const threeItemsSearch = async () => ({ items: [moderateQualityItem, moderateQualityItem, moderateQualityItem], count: 3, source: "mock" });
    const mapped = await runMapRakuten(researchResult, { searchFn: threeItemsSearch });
    assert.equal(mapped[0].rakutenSupplyStatus, "ELIGIBLE", "楽天商品供給は十分(前提条件)");
    assert.ok(mapped[0].bestProductQualityScore > 0, "Quality Score自体は計算できている(前提条件、REJECTの原因が需要スコアの低さであることを切り分ける)");
    assert.equal(mapped[0].scoreBand, "REJECT");
    assert.equal(mapped[0].decisionStatus, "REJECT");
    assert.equal(mapped[0].eligibleForApproval, false);
  });
});

test("【監査対応】scoreBandは楽天供給状態(rakutenSupplyStatus)によって書き換えられない(同一の楽天商品品質ならINSUFFICIENT/ELIGIBLEでscoreBandは同じ値のまま)", async () => {
  await withTempCsv([HIGH_DEMAND_KEYWORD], async (csvPath) => {
    const researchResult = await runResearch({ manualCsvPath: csvPath });
    // 同一のELIGIBLE_ITEM(同じQuality Score)を1件だけ返す(INSUFFICIENT)か3件返す(ELIGIBLE)かの
    // 違いだけにする。bestProductQualityScoreは変わらないため、需要データから算出される
    // scoreBand自体も変わらないはずである(decisionStatusだけが分岐する)。
    const eligibleMapped = await runMapRakuten(researchResult, {
      searchFn: async () => ({ items: [ELIGIBLE_ITEM, ELIGIBLE_ITEM, ELIGIBLE_ITEM], count: 3, source: "mock" }),
    });
    const insufficientMapped = await runMapRakuten(researchResult, { searchFn: oneEligibleItemSearch });
    // rakuten側の商品供給件数(1件 vs 3件)が異なっても、需要データから算出されるscoreBand自体は変わらない
    assert.equal(insufficientMapped[0].scoreBand, eligibleMapped[0].scoreBand);
    // decisionStatusはrakutenSupplyStatusに応じて別物になる(scoreBandとの分離の確認)
    assert.equal(eligibleMapped[0].decisionStatus, eligibleMapped[0].scoreBand);
    assert.equal(insufficientMapped[0].decisionStatus, "SUPPLY_INSUFFICIENT");
  });
});

test("【監査対応】decision.jsはscoreBandの値自体を一切書き換えない(戻り値にscoreBandキーを含まない。呼び出し側(pipeline.js)が保持する元の値がそのまま残る)", () => {
  const base = {
    businessValidated: true,
    scoreBand: "PRIORITY",
    intent: "CONDITION_PURCHASE",
    eligibleRakutenCount: 5,
    bestProductQualityScore: 80,
  };
  for (const rakutenSupplyStatus of ["ELIGIBLE", "INSUFFICIENT", "NO_MATCH"]) {
    const decision = evaluateDecision({ ...base, rakutenSupplyStatus });
    assert.ok(!Object.prototype.hasOwnProperty.call(decision, "scoreBand"), "evaluateDecisionの戻り値はscoreBandを含まない(=呼び出し側の値を上書きしない)");
  }
});
