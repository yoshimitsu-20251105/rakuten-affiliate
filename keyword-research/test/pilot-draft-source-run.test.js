// 【2026-09-07 Phase 3A対応】source run(保存済みkeywords:gkp-dry-run結果)の
// 読込・run単位ゲート検証・候補データ結合のテスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSourceRun, validateSourceRunMetadata } from "../pilot-draft-source-run.js";

function validMetadata(overrides = {}) {
  return {
    runId: "live-2026-09-07",
    status: "completed",
    rakutenSource: "live",
    searchSourceCounts: { live: 100 },
    resultCounts: { apiErrorCount: 0, attemptedCount: 100, apiErrorRate: 0 },
    candidateSetHash: "abc123",
    ...overrides,
  };
}

async function withSourceRunDir({ metadata, scoresRows, candidatesRows, matchesRows, itemsByKeyword } = {}, fn) {
  const dir = await mkdtemp(join(tmpdir(), "pilot-sourcerun-"));
  await writeFile(join(dir, "run-metadata.json"), JSON.stringify(metadata ?? validMetadata()), "utf-8");

  const scoresHeader =
    "originalKeyword,normalizedKeyword,rakutenQuery,businessValidated,scoreBand_simulationOnly,decisionStatus,safetyStatus,queryQualityStatus,rakutenLookupStatus,rakutenSupplyStatus,eligibleForApproval,eligibleForExport,eligibleForPublish,validationFailureReasons,dataSource,sourceProvider,isSynthetic,demand,purchaseIntent,adsCompetitionGap_notSeoCompetition,trendAndStability,rakutenSupplyFit,clusterFit,webKeywordScoreTotal,confidence,bestProductQualityScore,finalPriority,reasons";
  const scoresLines = (scoresRows ?? []).map((r) => scoresHeader.split(",").map((h) => r[h] ?? "").join(","));
  await writeFile(join(dir, "keyword-scores.csv"), [scoresHeader, ...scoresLines].join("\n") + "\n", "utf-8");

  const candidatesHeader =
    "originalKeyword,normalizedKeyword,rakutenQuery,keywordVariants,cluster,intent,safetyStatus,queryQualityStatus,variantCount,mergeReason,sourceProvider,isSynthetic,periodStart,periodEnd,monthlySearches,searchVolumeVariance,competitionLevel,trendIndex,lowTopOfPageBid_monetizationOnly,highTopOfPageBid_monetizationOnly";
  const candidatesLines = (candidatesRows ?? []).map((r) => candidatesHeader.split(",").map((h) => r[h] ?? "").join(","));
  await writeFile(join(dir, "keyword-candidates.csv"), [candidatesHeader, ...candidatesLines].join("\n") + "\n", "utf-8");

  const matchesHeader =
    "originalKeyword,normalizedKeyword,rakutenQuery,itemCode,status,matchScore,requiredAttributes,matchedAttributes,missingAttributes,conflictingAttributes,dataSource,reasons";
  const matchesLines = (matchesRows ?? []).map((r) => matchesHeader.split(",").map((h) => r[h] ?? "").join(","));
  await writeFile(join(dir, "rakuten-matches.csv"), [matchesHeader, ...matchesLines].join("\n") + "\n", "utf-8");

  await writeFile(join(dir, "rakuten-items.json"), JSON.stringify(itemsByKeyword ?? {}), "utf-8");

  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("validateSourceRunMetadata: 全条件を満たすrunはvalid=true", () => {
  const result = validateSourceRunMetadata(validMetadata());
  assert.equal(result.valid, true, result.errors.join(", "));
});

test("validateSourceRunMetadata: statusが無い(旧run)場合はvalid=false", () => {
  const meta = validMetadata();
  delete meta.status;
  const result = validateSourceRunMetadata(meta);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /completed/);
});

test("validateSourceRunMetadata: status=failedはvalid=false", () => {
  const result = validateSourceRunMetadata(validMetadata({ status: "failed" }));
  assert.equal(result.valid, false);
});

test("validateSourceRunMetadata: rakutenSource=fixtureはvalid=false", () => {
  const result = validateSourceRunMetadata(validMetadata({ rakutenSource: "fixture" }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /live/);
});

test("validateSourceRunMetadata: rakutenSource=nullはvalid=false", () => {
  const result = validateSourceRunMetadata(validMetadata({ rakutenSource: null }));
  assert.equal(result.valid, false);
});

test("validateSourceRunMetadata: searchSourceCountsにfixtureが含まれる場合はvalid=false", () => {
  const result = validateSourceRunMetadata(validMetadata({ searchSourceCounts: { live: 90, fixture: 10 } }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /fixture/);
});

test("validateSourceRunMetadata: API_ERRORが1件以上あればvalid=false", () => {
  const result = validateSourceRunMetadata(validMetadata({ resultCounts: { apiErrorCount: 1, attemptedCount: 100, apiErrorRate: 0.01 } }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /apiErrorCount/);
});

test("validateSourceRunMetadata: candidateSetHashが無い場合はvalid=false", () => {
  const meta = validMetadata();
  delete meta.candidateSetHash;
  const result = validateSourceRunMetadata(meta);
  assert.equal(result.valid, false);
});

test("loadSourceRun: 存在しないディレクトリはエラーになる", async () => {
  const result = await loadSourceRun("/definitely/does/not/exist");
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /見つかりません/);
});

test("loadSourceRun: 正常なrunは候補データを正しく結合する(ELIGIBLE件数・matchedAttributes含む)", async () => {
  await withSourceRunDir(
    {
      scoresRows: [
        {
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
        },
      ],
      candidatesRows: [
        { originalKeyword: "シニア 犬 豚肉", normalizedKeyword: "シニア 犬 豚肉", cluster: "シニア犬フード", monthlySearches: "500", competitionLevel: "LOW" },
      ],
      matchesRows: [
        { originalKeyword: "シニア 犬 豚肉", normalizedKeyword: "シニア 犬 豚肉", itemCode: "shop:1", status: "ELIGIBLE", matchedAttributes: "species:dog | feature:domestic" },
        { originalKeyword: "シニア 犬 豚肉", normalizedKeyword: "シニア 犬 豚肉", itemCode: "shop:2", status: "ELIGIBLE", matchedAttributes: "species:dog | feature:domestic" },
        { originalKeyword: "シニア 犬 豚肉", normalizedKeyword: "シニア 犬 豚肉", itemCode: "shop:3", status: "ELIGIBLE", matchedAttributes: "species:dog | feature:domestic" },
        { originalKeyword: "シニア 犬 豚肉", normalizedKeyword: "シニア 犬 豚肉", itemCode: "shop:4", status: "REJECTED", matchedAttributes: "" },
      ],
      itemsByKeyword: { "シニア 犬 豚肉": [{ itemCode: "shop:1", itemName: "テスト商品" }] },
    },
    async (dir) => {
      const result = await loadSourceRun(dir);
      assert.equal(result.valid, true, result.errors.join(", "));
      const c = result.candidatesByKeyword.get("シニア 犬 豚肉");
      assert.ok(c);
      assert.equal(c.businessValidated, true);
      assert.equal(c.decisionStatus, "PRIORITY");
      assert.equal(c.eligibleForApproval, true);
      assert.equal(c.eligibleItemCount, 3, "ELIGIBLE(3件)のみカウントし、REJECTEDは含めない");
      assert.deepEqual(c.matchedAttributes, ["species:dog", "feature:domestic"]);
      assert.equal(c.eligibleItems.length, 1);
      assert.equal(c.eligibleItems[0].itemName, "テスト商品");
    }
  );
});

test("loadSourceRun: run-metadataがゲート条件を満たさない場合、候補データを結合せずvalid=falseを返す", async () => {
  await withSourceRunDir({ metadata: validMetadata({ status: "failed" }) }, async (dir) => {
    const result = await loadSourceRun(dir);
    assert.equal(result.valid, false);
    assert.equal(result.candidatesByKeyword, null);
  });
});
