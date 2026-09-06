// 【2026-09-07 Phase 3A対応】オーケストレーション層(buildPilotDrafts)のテスト。
// 条件を1つでも満たさない候補が1件でもあれば、全件生成せず失敗として扱うことを検証する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPilotDrafts } from "../pilot-draft-build.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");

const VALID_METADATA = {
  runId: "live-2026-09-07",
  status: "completed",
  rakutenSource: "live",
  searchSourceCounts: { live: 2 },
  resultCounts: { apiErrorCount: 0, attemptedCount: 2, apiErrorRate: 0 },
  candidateSetHash: "test-hash-001",
};

function scoreRow(overrides = {}) {
  return {
    originalKeyword: "シニア 犬 豚肉",
    normalizedKeyword: "シニア 犬 豚肉",
    businessValidated: "true",
    decisionStatus: "PRIORITY",
    scoreBand_simulationOnly: "PRIORITY",
    eligibleForApproval: "true",
    safetyStatus: "SAFE",
    queryQualityStatus: "VALID",
    rakutenLookupStatus: "SUCCESS",
    rakutenSupplyStatus: "ELIGIBLE",
    finalPriority: "77",
    webKeywordScoreTotal: "74",
    bestProductQualityScore: "80",
    ...overrides,
  };
}

async function writeCsv(dir, filename, header, rows) {
  const lines = rows.map((r) => header.split(",").map((h) => r[h] ?? "").join(","));
  await writeFile(join(dir, filename), [header, ...lines].join("\n") + "\n", "utf-8");
}

async function buildSourceRunDir({ metadata = VALID_METADATA, scoresRows = [scoreRow()], matchStatuses = ["ELIGIBLE", "ELIGIBLE", "ELIGIBLE"], itemsByKeyword } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "pilot-build-sourcerun-"));
  await writeFile(join(dir, "run-metadata.json"), JSON.stringify(metadata), "utf-8");
  await writeCsv(
    dir,
    "keyword-scores.csv",
    "originalKeyword,normalizedKeyword,rakutenQuery,businessValidated,scoreBand_simulationOnly,decisionStatus,safetyStatus,queryQualityStatus,rakutenLookupStatus,rakutenSupplyStatus,eligibleForApproval,eligibleForExport,eligibleForPublish,validationFailureReasons,dataSource,sourceProvider,isSynthetic,demand,purchaseIntent,adsCompetitionGap_notSeoCompetition,trendAndStability,rakutenSupplyFit,clusterFit,webKeywordScoreTotal,confidence,bestProductQualityScore,finalPriority,reasons",
    scoresRows
  );
  await writeCsv(
    dir,
    "keyword-candidates.csv",
    "originalKeyword,normalizedKeyword,rakutenQuery,keywordVariants,cluster,intent,safetyStatus,queryQualityStatus,variantCount,mergeReason,sourceProvider,isSynthetic,periodStart,periodEnd,monthlySearches,searchVolumeVariance,competitionLevel,trendIndex,lowTopOfPageBid_monetizationOnly,highTopOfPageBid_monetizationOnly",
    scoresRows.map((r) => ({ originalKeyword: r.originalKeyword, normalizedKeyword: r.normalizedKeyword, cluster: "シニア犬フード", monthlySearches: "500" }))
  );
  const matchRows = matchStatuses.map((status, i) => ({
    originalKeyword: scoresRows[0]?.originalKeyword ?? "",
    normalizedKeyword: scoresRows[0]?.normalizedKeyword ?? "",
    itemCode: `shop:${i}`,
    status,
    matchedAttributes: status === "ELIGIBLE" ? "species:dog | feature:domestic" : "",
  }));
  await writeCsv(
    dir,
    "rakuten-matches.csv",
    "originalKeyword,normalizedKeyword,rakutenQuery,itemCode,status,matchScore,requiredAttributes,matchedAttributes,missingAttributes,conflictingAttributes,dataSource,reasons",
    matchRows
  );
  await writeFile(
    join(dir, "rakuten-items.json"),
    JSON.stringify(
      itemsByKeyword ?? {
        [scoresRows[0]?.normalizedKeyword ?? ""]: matchStatuses
          .filter((s) => s === "ELIGIBLE")
          .map((_, i) => ({ itemCode: `shop:${i}`, itemName: `テスト商品${i}`, itemPrice: 1000 + i, reviewAverage: 4.5, reviewCount: 100, qualityScore: 80 })),
      }
    ),
    "utf-8"
  );
  return dir;
}

async function writeApprovalFile(dir, overrides = {}) {
  const approval = {
    version: 1,
    sourceRunId: "live-2026-09-07",
    candidateSetHash: "test-hash-001",
    approvedBy: "human",
    approvedAt: "2026-09-07T00:00:00.000Z",
    keywords: [{ normalizedKeyword: "シニア 犬 豚肉", title: "テストタイトル", slug: "test-slug-unique-xyz", action: "CREATE" }],
    ...overrides,
  };
  const filePath = join(dir, "approval.json");
  await writeFile(filePath, JSON.stringify(approval), "utf-8");
  return filePath;
}

test("すべてのゲートを満たす場合は生成に成功する", async () => {
  const sourceRunDir = await buildSourceRunDir();
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-build-approval-"));
  try {
    const approvedFilePath = await writeApprovalFile(approvalDir);
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.drafts.length, 1);
    assert.equal(result.drafts[0].slug, "test-slug-unique-xyz");
    assert.match(result.drafts[0].html, /DRAFT/);
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
  }
});

test("candidateSetHashが一致しない場合は全件拒否する", async () => {
  const sourceRunDir = await buildSourceRunDir();
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-build-approval-"));
  try {
    const approvedFilePath = await writeApprovalFile(approvalDir, { candidateSetHash: "wrong-hash" });
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /candidateSetHash/);
    assert.equal(result.drafts, undefined);
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
  }
});

test("source runのstatusがfailedの場合は全件拒否する", async () => {
  const sourceRunDir = await buildSourceRunDir({ metadata: { ...VALID_METADATA, status: "failed" } });
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-build-approval-"));
  try {
    const approvedFilePath = await writeApprovalFile(approvalDir);
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, false);
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
  }
});

test("楽天ELIGIBLE商品が3件未満(供給不足)の場合は全件拒否する", async () => {
  const sourceRunDir = await buildSourceRunDir({ matchStatuses: ["ELIGIBLE", "REJECTED", "REJECTED"] });
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-build-approval-"));
  try {
    const approvedFilePath = await writeApprovalFile(approvalDir);
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /最低基準/);
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
  }
});

test("safetyStatusがSAFEでない場合は全件拒否する", async () => {
  const sourceRunDir = await buildSourceRunDir({ scoresRows: [scoreRow({ safetyStatus: "MEDICAL_REVIEW_REQUIRED" })] });
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-build-approval-"));
  try {
    const approvedFilePath = await writeApprovalFile(approvalDir);
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /SAFE/);
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
  }
});

test("decisionStatusがPRIORITYでない場合は全件拒否する", async () => {
  const sourceRunDir = await buildSourceRunDir({ scoresRows: [scoreRow({ decisionStatus: "TEST" })] });
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-build-approval-"));
  try {
    const approvedFilePath = await writeApprovalFile(approvalDir);
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /PRIORITY/);
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
  }
});

test("既存パイプライン設定と検索意図が重複する候補は全件拒否する(実データでの重複検出)", async () => {
  const sourceRunDir = await buildSourceRunDir({
    scoresRows: [scoreRow({ originalKeyword: "シニア 犬 フード", normalizedKeyword: "シニア 犬 フード" })],
  });
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-build-approval-"));
  try {
    const approvedFilePath = await writeApprovalFile(approvalDir, {
      keywords: [{ normalizedKeyword: "シニア 犬 フード", title: "テスト", slug: "senior-dog-food-test", action: "CREATE" }],
    });
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /検索意図が既存の設定済みキーワード/);
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
  }
});

test("承認ファイルに存在するがsource runに存在しないキーワードは全件拒否する", async () => {
  const sourceRunDir = await buildSourceRunDir();
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-build-approval-"));
  try {
    const approvedFilePath = await writeApprovalFile(approvalDir, {
      keywords: [{ normalizedKeyword: "存在しないキーワード", title: "テスト", slug: "nonexistent-test", action: "CREATE" }],
    });
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /見つかりません/);
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
  }
});

test("2件承認し、1件だけがゲート違反の場合でも全件拒否する(部分生成しない)", async () => {
  const sourceRunDir = await buildSourceRunDir({
    scoresRows: [scoreRow(), scoreRow({ originalKeyword: "キャットフード グレインフリー", normalizedKeyword: "キャットフード グレインフリー", decisionStatus: "TEST" })],
  });
  // matchesRowsは1件目のキーワードにしか紐付いていないため、2件目は0件になり(供給不足でも失敗するはず)
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-build-approval-"));
  try {
    const approvedFilePath = await writeApprovalFile(approvalDir, {
      keywords: [
        { normalizedKeyword: "シニア 犬 豚肉", title: "OK候補", slug: "ok-candidate-test", action: "CREATE" },
        { normalizedKeyword: "キャットフード グレインフリー", title: "NG候補", slug: "ng-candidate-test", action: "CREATE" },
      ],
    });
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, false, "1件でも違反があれば全体を失敗にする");
    assert.equal(result.drafts, undefined, "部分的にdraftsを返さない");
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
  }
});
