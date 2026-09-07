// 【2026-09-07 Phase 3A対応 / PR#5監査対応で全面改訂】source run(保存済みkeywords:gkp-dry-run結果)の
// 読込・run単位ゲート検証・候補データ結合のテスト。
//
// 監査で判明した「rakuten-matches.csvのELIGIBLE行数だけで最低3商品を判定しており、
// 実際に表示するrakuten-items.jsonの商品と一切突き合わせていなかった」欠陥を修正した
// pilot-draft-source-run.jsを検証する。artifactHashes/candidateSetHashは実ファイルから
// 再計算されるため、フィクスチャは実際に書き込んだファイル内容から算出したハッシュを使う。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSourceRun, validateSourceRunMetadata, MIN_ELIGIBLE_ITEMS } from "../pilot-draft-source-run.js";
import { sha256File, computeCandidateSetHash } from "../hash-utils.js";

const ARTIFACT_FILENAMES = ["keyword-scores.csv", "keyword-candidates.csv", "rakuten-matches.csv", "rakuten-items.json"];

const SCORES_HEADER =
  "originalKeyword,normalizedKeyword,rakutenQuery,businessValidated,scoreBand_simulationOnly,decisionStatus,safetyStatus,queryQualityStatus,rakutenLookupStatus,rakutenSupplyStatus,eligibleForApproval,eligibleForExport,eligibleForPublish,validationFailureReasons,dataSource,sourceProvider,isSynthetic,demand,purchaseIntent,adsCompetitionGap_notSeoCompetition,trendAndStability,rakutenSupplyFit,clusterFit,webKeywordScoreTotal,confidence,bestProductQualityScore,finalPriority,reasons";
const CANDIDATES_HEADER =
  "originalKeyword,normalizedKeyword,rakutenQuery,keywordVariants,cluster,intent,safetyStatus,queryQualityStatus,variantCount,mergeReason,sourceProvider,isSynthetic,periodStart,periodEnd,monthlySearches,searchVolumeVariance,competitionLevel,trendIndex,lowTopOfPageBid_monetizationOnly,highTopOfPageBid_monetizationOnly";
const MATCHES_HEADER =
  "originalKeyword,normalizedKeyword,rakutenQuery,itemCode,status,matchScore,requiredAttributes,matchedAttributes,missingAttributes,conflictingAttributes,dataSource,reasons";

// --- 正常系フィクスチャの基本部品 ---

const KEYWORD = "シニア 犬 豚肉";
const REQUIRED_ATTRS = "species:dog | feature:domestic";

function scoreRow(overrides = {}) {
  return {
    originalKeyword: KEYWORD,
    normalizedKeyword: KEYWORD,
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

function candidateRow(overrides = {}) {
  return { originalKeyword: KEYWORD, normalizedKeyword: KEYWORD, cluster: "シニア犬フード", monthlySearches: "500", competitionLevel: "LOW", ...overrides };
}

function eligibleMatchRow(itemCode, overrides = {}) {
  return {
    originalKeyword: KEYWORD,
    normalizedKeyword: KEYWORD,
    itemCode,
    status: "ELIGIBLE",
    matchScore: "100",
    requiredAttributes: REQUIRED_ATTRS,
    matchedAttributes: REQUIRED_ATTRS,
    missingAttributes: "",
    conflictingAttributes: "",
    ...overrides,
  };
}

function item(itemCode, overrides = {}) {
  return { itemCode, itemName: `テスト商品${itemCode}`, catchcopy: "", itemPrice: 1000, reviewAverage: 4.5, reviewCount: 10, qualityScore: 80, ...overrides };
}

// --- run-metadata単体検証(validateSourceRunMetadata)のテスト用フィクスチャ ---
// (ファイルを実際には書き込まないため、artifactHashesの値は任意の非空文字列でよい)

function validMetadata(overrides = {}) {
  return {
    runId: "live-2026-09-07",
    status: "completed",
    commandMode: "gkp-dry-run",
    rakutenSource: "live",
    sourceProvider: "google_keyword_planner",
    executedAt: "2026-09-01T00:00:00.000Z",
    searchSourceCounts: { live: 100 },
    resultCounts: { apiErrorCount: 0, apiErrorRate: 0, attemptedCount: 100 },
    selectedCount: 100,
    candidateCount: 100,
    candidateSetHash: "abc123",
    artifactHashes: {
      "keyword-scores.csv": "hash1",
      "keyword-candidates.csv": "hash2",
      "rakuten-matches.csv": "hash3",
      "rakuten-items.json": "hash4",
    },
    ...overrides,
  };
}

// --- loadSourceRun統合テスト用: 実ファイルを書き込み、実ハッシュから
//     run-metadata.jsonを組み立てるフィクスチャヘルパー ---

async function writeArtifacts(dir, { scoresRows = [], candidatesRows = [], matchesRows = [], itemsByKeyword = {} } = {}) {
  const scoresLines = scoresRows.map((r) => SCORES_HEADER.split(",").map((h) => r[h] ?? "").join(","));
  await writeFile(join(dir, "keyword-scores.csv"), [SCORES_HEADER, ...scoresLines].join("\n") + "\n", "utf-8");

  const candidatesLines = candidatesRows.map((r) => CANDIDATES_HEADER.split(",").map((h) => r[h] ?? "").join(","));
  await writeFile(join(dir, "keyword-candidates.csv"), [CANDIDATES_HEADER, ...candidatesLines].join("\n") + "\n", "utf-8");

  const matchesLines = matchesRows.map((r) => MATCHES_HEADER.split(",").map((h) => r[h] ?? "").join(","));
  await writeFile(join(dir, "rakuten-matches.csv"), [MATCHES_HEADER, ...matchesLines].join("\n") + "\n", "utf-8");

  await writeFile(join(dir, "rakuten-items.json"), JSON.stringify(itemsByKeyword), "utf-8");

  const artifactHashes = {};
  for (const filename of ARTIFACT_FILENAMES) {
    artifactHashes[filename] = await sha256File(join(dir, filename));
  }
  const candidateSetHash = computeCandidateSetHash(scoresRows.map((r) => ({ originalKeyword: r.originalKeyword })));
  return { artifactHashes, candidateSetHash, scoresRowCount: scoresRows.length };
}

/**
 * @param {{
 *   scoresRows?: any[], candidatesRows?: any[], matchesRows?: any[], itemsByKeyword?: any,
 *   metadata?: object | ((defaults: object) => object),
 *   tamperAfterWrite?: (dir: string) => Promise<void>,
 * }} fixture
 */
async function withSourceRunDir(fixture, fn) {
  const dir = await mkdtemp(join(tmpdir(), "pilot-sourcerun-"));
  try {
    const { artifactHashes, candidateSetHash, scoresRowCount } = await writeArtifacts(dir, fixture);
    const defaultMetadata = {
      runId: "live-2026-09-07",
      status: "completed",
      commandMode: "gkp-dry-run",
      rakutenSource: "live",
      sourceProvider: "google_keyword_planner",
      executedAt: "2026-09-01T00:00:00.000Z",
      searchSourceCounts: { live: scoresRowCount },
      resultCounts: { apiErrorCount: 0, apiErrorRate: 0, attemptedCount: scoresRowCount },
      selectedCount: scoresRowCount,
      candidateCount: scoresRowCount,
      candidateSetHash,
      artifactHashes,
    };
    const metadata =
      typeof fixture.metadata === "function" ? fixture.metadata(defaultMetadata) : { ...defaultMetadata, ...(fixture.metadata ?? {}) };
    await writeFile(join(dir, "run-metadata.json"), JSON.stringify(metadata), "utf-8");
    if (fixture.tamperAfterWrite) await fixture.tamperAfterWrite(dir);
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// =====================================================================
// validateSourceRunMetadata: 単体テスト
// =====================================================================

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

test("validateSourceRunMetadata: commandModeがgkp-dry-run以外はvalid=false", () => {
  const result = validateSourceRunMetadata(validMetadata({ commandMode: "keywords:export-approved" }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /gkp-dry-run/);
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

test("validateSourceRunMetadata: sourceProviderがgoogle_keyword_planner以外はvalid=false", () => {
  const result = validateSourceRunMetadata(validMetadata({ sourceProvider: "manual_csv" }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /google_keyword_planner/);
});

test("validateSourceRunMetadata: executedAtが有効なISO日時でない場合はvalid=false", () => {
  const result = validateSourceRunMetadata(validMetadata({ executedAt: "2026年9月1日" }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /ISO日時/);
});

test("validateSourceRunMetadata: runIdが空文字の場合はvalid=false", () => {
  const result = validateSourceRunMetadata(validMetadata({ runId: "" }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /runId/);
});

test("validateSourceRunMetadata: searchSourceCountsにfixtureが含まれる場合はvalid=false", () => {
  const result = validateSourceRunMetadata(validMetadata({ searchSourceCounts: { live: 90, fixture: 10 } }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /fixture|live/);
});

test("【回帰テスト9】searchSourceCounts={live:99,error:1}はvalid=false", () => {
  const result = validateSourceRunMetadata(
    validMetadata({ searchSourceCounts: { live: 99, error: 1 }, resultCounts: { apiErrorCount: 0, apiErrorRate: 0, attemptedCount: 99 } })
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /searchSourceCounts/);
});

test("【回帰テスト10】searchSourceCounts={live:99,skipped:1}はvalid=false", () => {
  const result = validateSourceRunMetadata(
    validMetadata({ searchSourceCounts: { live: 99, skipped: 1 }, resultCounts: { apiErrorCount: 0, apiErrorRate: 0, attemptedCount: 99 } })
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /searchSourceCounts/);
});

test("validateSourceRunMetadata: API_ERRORが1件以上あればvalid=false", () => {
  const result = validateSourceRunMetadata(validMetadata({ resultCounts: { apiErrorCount: 1, attemptedCount: 100, apiErrorRate: 0.01 } }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /apiErrorCount/);
});

test("validateSourceRunMetadata: apiErrorRateが0でない場合はvalid=false", () => {
  const result = validateSourceRunMetadata(validMetadata({ resultCounts: { apiErrorCount: 0, attemptedCount: 100, apiErrorRate: 0.02 } }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /apiErrorRate/);
});

test("validateSourceRunMetadata: attemptedCountが正整数でない場合はvalid=false", () => {
  const result = validateSourceRunMetadata(validMetadata({ resultCounts: { apiErrorCount: 0, attemptedCount: 0, apiErrorRate: 0 } }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /attemptedCount/);
});

test("【回帰テスト11】live件数・attemptedCount・selectedCount・candidateCountが一致しない場合はvalid=false", () => {
  const result = validateSourceRunMetadata(validMetadata({ selectedCount: 99 }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /件数が一致しません/);
});

test("validateSourceRunMetadata: keyword-scores.csv実データ行数が一致しない場合はvalid=false", () => {
  const result = validateSourceRunMetadata(validMetadata(), { scoresRowCount: 50 });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /件数が一致しません/);
});

test("【回帰テスト7】artifactHashesが記録されていない(旧run)場合はvalid=false", () => {
  const meta = validMetadata();
  delete meta.artifactHashes;
  const result = validateSourceRunMetadata(meta);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /artifactHashes/);
});

test("validateSourceRunMetadata: artifactHashesに不足しているファイルがある場合はvalid=false", () => {
  const meta = validMetadata();
  delete meta.artifactHashes["rakuten-items.json"];
  const result = validateSourceRunMetadata(meta);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /rakuten-items\.json/);
});

test("validateSourceRunMetadata: candidateSetHashが無い場合はvalid=false", () => {
  const meta = validMetadata();
  delete meta.candidateSetHash;
  const result = validateSourceRunMetadata(meta);
  assert.equal(result.valid, false);
});

// =====================================================================
// loadSourceRun: 統合テスト
// =====================================================================

test("loadSourceRun: 存在しないディレクトリはエラーになる", async () => {
  const result = await loadSourceRun("/definitely/does/not/exist");
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /見つかりません/);
});

test("loadSourceRun: 正常なrunは候補データを正しく結合する(ELIGIBLE件数・照合済み商品を突き合わせ)", async () => {
  await withSourceRunDir(
    {
      scoresRows: [scoreRow()],
      candidatesRows: [candidateRow()],
      matchesRows: [
        eligibleMatchRow("shop:1"),
        eligibleMatchRow("shop:2"),
        eligibleMatchRow("shop:3"),
        { originalKeyword: KEYWORD, normalizedKeyword: KEYWORD, itemCode: "shop:4", status: "REJECTED" },
      ],
      itemsByKeyword: { [KEYWORD]: [item("shop:1"), item("shop:2"), item("shop:3")] },
    },
    async (dir) => {
      const result = await loadSourceRun(dir);
      assert.equal(result.valid, true, result.errors.join(", "));
      const c = result.candidatesByKeyword.get(KEYWORD);
      assert.ok(c);
      assert.equal(c.businessValidated, true);
      assert.equal(c.decisionStatus, "PRIORITY");
      assert.equal(c.eligibleForApproval, true);
      assert.deepEqual(c.dataIntegrityErrors, []);
      assert.equal(c.eligibleItemCount, 3, "ELIGIBLE(3件)かつ商品表示データと一致する分だけカウントする");
      assert.deepEqual(c.requiredAttributes, ["species:dog", "feature:domestic"]);
      assert.deepEqual(c.matchedAttributes, ["species:dog", "feature:domestic"]);
      assert.equal(c.eligibleItems.length, 3);
      assert.deepEqual(new Set(c.eligibleItems.map((i) => i.itemCode)), new Set(["shop:1", "shop:2", "shop:3"]));
    }
  );
});

test("loadSourceRun: run-metadataがゲート条件を満たさない場合、候補データを結合せずvalid=falseを返す", async () => {
  await withSourceRunDir(
    {
      scoresRows: [scoreRow()],
      candidatesRows: [candidateRow()],
      matchesRows: [eligibleMatchRow("shop:1")],
      itemsByKeyword: { [KEYWORD]: [item("shop:1")] },
      metadata: (defaults) => ({ ...defaults, status: "failed" }),
    },
    async (dir) => {
      const result = await loadSourceRun(dir);
      assert.equal(result.valid, false);
      assert.equal(result.candidatesByKeyword, null);
    }
  );
});

test("【回帰テスト1】ELIGIBLE照合3件・表示商品1件(不整合)は候補が拒否対象になる", async () => {
  await withSourceRunDir(
    {
      scoresRows: [scoreRow()],
      candidatesRows: [candidateRow()],
      matchesRows: [eligibleMatchRow("shop:1"), eligibleMatchRow("shop:2"), eligibleMatchRow("shop:3")],
      itemsByKeyword: { [KEYWORD]: [item("shop:1")] }, // 商品は1件だけ
    },
    async (dir) => {
      const result = await loadSourceRun(dir);
      assert.equal(result.valid, true, result.errors.join(", ")); // source run自体(メタデータ・ハッシュ)は正しい
      const c = result.candidatesByKeyword.get(KEYWORD);
      assert.ok(c.dataIntegrityErrors.length > 0, "照合結果と表示データの不一致がdataIntegrityErrorsに記録される");
      assert.match(c.dataIntegrityErrors.join(""), /itemCodeが一致しません/);
      assert.equal(c.eligibleItemCount, 0, "不整合時はeligibleItemCountを0にし、生成候補から除外する");
      assert.equal(c.eligibleItems.length, 0);
    }
  );
});

test("【回帰テスト2】ELIGIBLE照合3件・別itemCodeの商品3件(完全に不一致)は候補が拒否対象になる", async () => {
  await withSourceRunDir(
    {
      scoresRows: [scoreRow()],
      candidatesRows: [candidateRow()],
      matchesRows: [eligibleMatchRow("shop:1"), eligibleMatchRow("shop:2"), eligibleMatchRow("shop:3")],
      itemsByKeyword: { [KEYWORD]: [item("shop:4"), item("shop:5"), item("shop:6")] },
    },
    async (dir) => {
      const result = await loadSourceRun(dir);
      assert.equal(result.valid, true, result.errors.join(", "));
      const c = result.candidatesByKeyword.get(KEYWORD);
      assert.ok(c.dataIntegrityErrors.length > 0);
      assert.match(c.dataIntegrityErrors.join(""), /itemCodeが一致しません/);
      assert.equal(c.eligibleItemCount, 0);
    }
  );
});

test("【回帰テスト3】rakuten-items.json内でitemCodeが重複している場合は候補が拒否対象になる", async () => {
  await withSourceRunDir(
    {
      scoresRows: [scoreRow()],
      candidatesRows: [candidateRow()],
      matchesRows: [eligibleMatchRow("shop:1"), eligibleMatchRow("shop:2"), eligibleMatchRow("shop:3")],
      itemsByKeyword: { [KEYWORD]: [item("shop:1"), item("shop:1"), item("shop:2"), item("shop:3")] }, // shop:1が重複
    },
    async (dir) => {
      const result = await loadSourceRun(dir);
      assert.equal(result.valid, true, result.errors.join(", "));
      const c = result.candidatesByKeyword.get(KEYWORD);
      assert.ok(c.dataIntegrityErrors.length > 0);
      assert.match(c.dataIntegrityErrors.join(""), /rakuten-items\.json内でitemCodeが重複/);
      assert.equal(c.eligibleItemCount, 0);
    }
  );
});

test("【回帰テスト4】rakuten-matches.csv内でELIGIBLEなitemCodeが重複している場合は候補が拒否対象になる", async () => {
  await withSourceRunDir(
    {
      scoresRows: [scoreRow()],
      candidatesRows: [candidateRow()],
      matchesRows: [eligibleMatchRow("shop:1"), eligibleMatchRow("shop:1"), eligibleMatchRow("shop:2"), eligibleMatchRow("shop:3")], // shop:1が重複
      itemsByKeyword: { [KEYWORD]: [item("shop:1"), item("shop:2"), item("shop:3")] },
    },
    async (dir) => {
      const result = await loadSourceRun(dir);
      assert.equal(result.valid, true, result.errors.join(", "));
      const c = result.candidatesByKeyword.get(KEYWORD);
      assert.ok(c.dataIntegrityErrors.length > 0);
      assert.match(c.dataIntegrityErrors.join(""), /rakuten-matches\.csv内でELIGIBLEなitemCodeが重複/);
      assert.equal(c.eligibleItemCount, 0);
    }
  );
});

test("【回帰テスト5】ELIGIBLE行間でrequiredAttributesが一致しない場合は候補が拒否対象になる", async () => {
  await withSourceRunDir(
    {
      scoresRows: [scoreRow()],
      candidatesRows: [candidateRow()],
      matchesRows: [
        eligibleMatchRow("shop:1", { requiredAttributes: "species:dog | feature:domestic", matchedAttributes: "species:dog | feature:domestic" }),
        eligibleMatchRow("shop:2", { requiredAttributes: "species:cat", matchedAttributes: "species:cat" }),
      ],
      itemsByKeyword: { [KEYWORD]: [item("shop:1"), item("shop:2")] }, // itemCode自体は完全一致させる
    },
    async (dir) => {
      const result = await loadSourceRun(dir);
      assert.equal(result.valid, true, result.errors.join(", "));
      const c = result.candidatesByKeyword.get(KEYWORD);
      assert.ok(c.dataIntegrityErrors.length > 0);
      assert.match(c.dataIntegrityErrors.join(""), /requiredAttributesが一致しません/);
      assert.equal(c.eligibleItemCount, 0);
    }
  );
});

test("validateSourceRunMetadata経由: ELIGIBLE行にmissingAttributesが記録されている場合は候補が拒否対象になる", async () => {
  await withSourceRunDir(
    {
      scoresRows: [scoreRow()],
      candidatesRows: [candidateRow()],
      matchesRows: [eligibleMatchRow("shop:1", { missingAttributes: "feature:grain-free" })],
      itemsByKeyword: { [KEYWORD]: [item("shop:1")] },
    },
    async (dir) => {
      const result = await loadSourceRun(dir);
      const c = result.candidatesByKeyword.get(KEYWORD);
      assert.ok(c.dataIntegrityErrors.length > 0);
      assert.match(c.dataIntegrityErrors.join(""), /missingAttributes/);
    }
  );
});

test("loadSourceRun: ELIGIBLE行のmatchScoreが100でない場合は候補が拒否対象になる", async () => {
  await withSourceRunDir(
    {
      scoresRows: [scoreRow()],
      candidatesRows: [candidateRow()],
      matchesRows: [eligibleMatchRow("shop:1", { matchScore: "90" })],
      itemsByKeyword: { [KEYWORD]: [item("shop:1")] },
    },
    async (dir) => {
      const result = await loadSourceRun(dir);
      const c = result.candidatesByKeyword.get(KEYWORD);
      assert.ok(c.dataIntegrityErrors.length > 0);
      assert.match(c.dataIntegrityErrors.join(""), /matchScoreが100ではありません/);
    }
  );
});

test("loadSourceRun: keyword-scores.csv内でnormalizedKeywordが重複している場合はvalid=falseを返す", async () => {
  await withSourceRunDir(
    {
      scoresRows: [scoreRow(), scoreRow()],
      candidatesRows: [candidateRow()],
      matchesRows: [eligibleMatchRow("shop:1"), eligibleMatchRow("shop:2"), eligibleMatchRow("shop:3")],
      itemsByKeyword: { [KEYWORD]: [item("shop:1"), item("shop:2"), item("shop:3")] },
    },
    async (dir) => {
      const result = await loadSourceRun(dir);
      assert.equal(result.valid, false);
      assert.match(result.errors.join(""), /normalizedKeywordが重複/);
    }
  );
});

test(`loadSourceRun: 表示可能商品が${MIN_ELIGIBLE_ITEMS}件未満でも読込自体は成功し、件数チェックは呼び出し側(pilot-draft-build.js)のゲートに委ねる`, async () => {
  await withSourceRunDir(
    {
      scoresRows: [scoreRow()],
      candidatesRows: [candidateRow()],
      matchesRows: [eligibleMatchRow("shop:1"), eligibleMatchRow("shop:2")],
      itemsByKeyword: { [KEYWORD]: [item("shop:1"), item("shop:2")] },
    },
    async (dir) => {
      const result = await loadSourceRun(dir);
      assert.equal(result.valid, true, result.errors.join(", "));
      const c = result.candidatesByKeyword.get(KEYWORD);
      assert.deepEqual(c.dataIntegrityErrors, []);
      assert.equal(c.eligibleItemCount, 2);
      assert.ok(c.eligibleItemCount < MIN_ELIGIBLE_ITEMS);
    }
  );
});

// --- 【回帰テスト6】artifact対象4ファイルをそれぞれ改変すると、いずれもハッシュ不一致で拒否される ---

const VALID_FIXTURE = {
  scoresRows: [scoreRow()],
  candidatesRows: [candidateRow()],
  matchesRows: [eligibleMatchRow("shop:1"), eligibleMatchRow("shop:2"), eligibleMatchRow("shop:3")],
  itemsByKeyword: { [KEYWORD]: [item("shop:1"), item("shop:2"), item("shop:3")] },
};

for (const targetFilename of ARTIFACT_FILENAMES) {
  test(`【回帰テスト6】${targetFilename}を保存後に改変するとハッシュ不一致で拒否される`, async () => {
    await withSourceRunDir(
      {
        ...VALID_FIXTURE,
        tamperAfterWrite: async (dir) => {
          const path = join(dir, targetFilename);
          const { readFile } = await import("node:fs/promises");
          const original = await readFile(path, "utf-8");
          // rakuten-items.jsonはJSONとして構文が壊れると別のエラー(パース失敗)を先に検出してしまうため、
          // 有効なJSONのまま値を書き換えることで、意図通りハッシュ不一致の経路を通す。
          const tampered = targetFilename.endsWith(".json")
            ? original.replace("shop:1", "shop:1-tampered")
            : original + "\n# tampered-after-hash-computed";
          await writeFile(path, tampered, "utf-8");
        },
      },
      async (dir) => {
        const result = await loadSourceRun(dir);
        assert.equal(result.valid, false);
        assert.match(result.errors.join(""), new RegExp(targetFilename.replace(".", "\\.")));
        assert.equal(result.candidatesByKeyword, null);
      }
    );
  });
}

test("【回帰テスト7(loadSourceRun経由)】artifactHashesが無い(旧run)場合はvalid=falseを返す", async () => {
  await withSourceRunDir(
    { ...VALID_FIXTURE, metadata: (defaults) => { const m = { ...defaults }; delete m.artifactHashes; return m; } },
    async (dir) => {
      const result = await loadSourceRun(dir);
      assert.equal(result.valid, false);
      assert.match(result.errors.join(""), /artifactHashes/);
      assert.equal(result.candidatesByKeyword, null);
    }
  );
});

test("【回帰テスト8】candidateSetHashの再計算結果が記録値と一致しない場合はvalid=falseを返す", async () => {
  await withSourceRunDir(
    { ...VALID_FIXTURE, metadata: (defaults) => ({ ...defaults, candidateSetHash: "tampered-or-wrong-hash-value" }) },
    async (dir) => {
      const result = await loadSourceRun(dir);
      assert.equal(result.valid, false);
      assert.match(result.errors.join(""), /candidateSetHash/);
      assert.equal(result.candidatesByKeyword, null);
    }
  );
});

test("【回帰テスト11(loadSourceRun経由)】件数メタデータが不一致の場合はvalid=falseを返す", async () => {
  await withSourceRunDir(
    { ...VALID_FIXTURE, metadata: (defaults) => ({ ...defaults, selectedCount: defaults.selectedCount + 5 }) },
    async (dir) => {
      const result = await loadSourceRun(dir);
      assert.equal(result.valid, false);
      assert.match(result.errors.join(""), /件数が一致しません/);
      assert.equal(result.candidatesByKeyword, null);
    }
  );
});
