// 【2026-09-07 Phase 3A対応 / PR#5監査対応で全面改訂】オーケストレーション層(buildPilotDrafts)のテスト。
// 条件を1つでも満たさない候補が1件でもあれば、全件生成せず失敗として扱うことを検証する。
//
// artifactHashes/candidateSetHashは実ファイルから再計算されるため、フィクスチャは
// 実際に書き込んだファイル内容から算出したハッシュを使う(pilot-draft-source-run.test.jsと同じ方針)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPilotDrafts } from "../pilot-draft-build.js";
import { sha256File, computeCandidateSetHash } from "../hash-utils.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");
const ARTIFACT_FILENAMES = ["keyword-scores.csv", "keyword-candidates.csv", "rakuten-matches.csv", "rakuten-items.json"];
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

function eligibleMatchRow(keyword, itemCode, overrides = {}) {
  return {
    originalKeyword: keyword,
    normalizedKeyword: keyword,
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

function safeItem(itemCode, overrides = {}) {
  return {
    itemCode,
    // 【2026-09-07 PR#6対応】商品関連性ゲート(itemName優先)がKEYWORDのspecies:dogを
    // itemNameから確認できることを要求するため、既定のitemNameに「犬用」を含める。
    itemName: `犬用テスト商品${itemCode}`,
    catchcopy: "国産原料使用の人気商品です",
    itemPrice: 1000,
    reviewAverage: 4.5,
    reviewCount: 100,
    qualityScore: 80,
    ...overrides,
  };
}

async function writeCsv(dir, filename, header, rows) {
  const lines = rows.map((r) => header.split(",").map((h) => r[h] ?? "").join(","));
  await writeFile(join(dir, filename), [header, ...lines].join("\n") + "\n", "utf-8");
}

/**
 * source run一式(4成果物ファイル + run-metadata.json)を実際に書き込み、
 * artifactHashes/candidateSetHashを実ファイルから計算して埋め込む。
 * @returns {Promise<{ dir: string, runId: string, executedAt: string, candidateSetHash: string }>}
 */
async function buildSourceRunDir({
  scoresRows = [scoreRow()],
  candidatesRows,
  matchesRows,
  itemsByKeyword,
  metadataOverrides = {},
  runId = "live-2026-09-07",
  executedAt = "2026-09-01T00:00:00.000Z",
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), "pilot-build-sourcerun-"));

  const resolvedCandidatesRows =
    candidatesRows ?? scoresRows.map((r) => ({ originalKeyword: r.originalKeyword, normalizedKeyword: r.normalizedKeyword, cluster: "シニア犬フード", monthlySearches: "500" }));
  const resolvedMatchesRows = matchesRows ?? [
    eligibleMatchRow(KEYWORD, "shop:1"),
    eligibleMatchRow(KEYWORD, "shop:2"),
    eligibleMatchRow(KEYWORD, "shop:3"),
  ];
  const resolvedItemsByKeyword = itemsByKeyword ?? { [KEYWORD]: [safeItem("shop:1"), safeItem("shop:2"), safeItem("shop:3")] };

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
    resolvedCandidatesRows
  );
  await writeCsv(
    dir,
    "rakuten-matches.csv",
    "originalKeyword,normalizedKeyword,rakutenQuery,itemCode,status,matchScore,requiredAttributes,matchedAttributes,missingAttributes,conflictingAttributes,dataSource,reasons",
    resolvedMatchesRows
  );
  await writeFile(join(dir, "rakuten-items.json"), JSON.stringify(resolvedItemsByKeyword), "utf-8");

  const artifactHashes = {};
  for (const filename of ARTIFACT_FILENAMES) {
    artifactHashes[filename] = await sha256File(join(dir, filename));
  }
  const candidateSetHash = computeCandidateSetHash(scoresRows.map((r) => ({ originalKeyword: r.originalKeyword })));

  const metadata = {
    runId,
    status: "completed",
    commandMode: "gkp-dry-run",
    rakutenSource: "live",
    sourceProvider: "google_keyword_planner",
    executedAt,
    searchSourceCounts: { live: scoresRows.length },
    resultCounts: { apiErrorCount: 0, apiErrorRate: 0, attemptedCount: scoresRows.length },
    selectedCount: scoresRows.length,
    candidateCount: scoresRows.length,
    candidateSetHash,
    artifactHashes,
    ...metadataOverrides,
  };
  await writeFile(join(dir, "run-metadata.json"), JSON.stringify(metadata), "utf-8");

  return { dir, runId, executedAt, candidateSetHash };
}

async function writeApprovalFile(dir, sourceRun, overrides = {}) {
  const approval = {
    version: 1,
    sourceRunId: sourceRun.runId,
    candidateSetHash: sourceRun.candidateSetHash,
    approvedBy: "human",
    approvedAt: new Date(Date.now() - 60_000).toISOString(), // 常に「現在より過去」かつsource run実行後になるよう実行時刻基準にする
    keywords: [{ normalizedKeyword: KEYWORD, title: "テストタイトル", slug: "test-slug-unique-xyz", action: "CREATE" }],
    ...overrides,
  };
  const filePath = join(dir, "approval.json");
  await writeFile(filePath, JSON.stringify(approval), "utf-8");
  return filePath;
}

async function withDirs(sourceRunOptions, approvalOverrides, fn) {
  const sourceRun = await buildSourceRunDir(sourceRunOptions);
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-build-approval-"));
  try {
    const approvedFilePath = await writeApprovalFile(approvalDir, sourceRun, approvalOverrides);
    return await fn({ sourceRunDir: sourceRun.dir, approvedFilePath });
  } finally {
    await rm(sourceRun.dir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
  }
}

test("すべてのゲートを満たす場合は生成に成功する", async () => {
  await withDirs({}, {}, async ({ sourceRunDir, approvedFilePath }) => {
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.drafts.length, 1);
    assert.equal(result.drafts[0].slug, "test-slug-unique-xyz");
    assert.match(result.drafts[0].html, /DRAFT/);
  });
});

test("candidateSetHashが一致しない場合は全件拒否する", async () => {
  await withDirs({}, { candidateSetHash: "wrong-hash" }, async ({ sourceRunDir, approvedFilePath }) => {
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /candidateSetHash/);
    assert.equal(result.drafts, undefined);
  });
});

test("source runのstatusがfailedの場合は全件拒否する", async () => {
  await withDirs({ metadataOverrides: { status: "failed" } }, {}, async ({ sourceRunDir, approvedFilePath }) => {
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, false);
  });
});

test("楽天ELIGIBLE商品が3件未満(供給不足)の場合は全件拒否する", async () => {
  await withDirs(
    {
      matchesRows: [eligibleMatchRow(KEYWORD, "shop:1")],
      itemsByKeyword: { [KEYWORD]: [safeItem("shop:1")] },
    },
    {},
    async ({ sourceRunDir, approvedFilePath }) => {
      const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
      assert.equal(result.ok, false);
      assert.match(result.errors.join(""), /最低基準/);
    }
  );
});

test("safetyStatusがSAFEでない場合は全件拒否する", async () => {
  await withDirs({ scoresRows: [scoreRow({ safetyStatus: "MEDICAL_REVIEW_REQUIRED" })] }, {}, async ({ sourceRunDir, approvedFilePath }) => {
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /SAFE/);
  });
});

test("decisionStatusがPRIORITYでない場合は全件拒否する", async () => {
  await withDirs({ scoresRows: [scoreRow({ decisionStatus: "TEST" })] }, {}, async ({ sourceRunDir, approvedFilePath }) => {
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /PRIORITY/);
  });
});

test("既存パイプライン設定と検索意図が重複する候補は全件拒否する(実データでの重複検出)", async () => {
  const keyword = "シニア 犬 フード";
  await withDirs(
    {
      scoresRows: [scoreRow({ originalKeyword: keyword, normalizedKeyword: keyword })],
      matchesRows: [eligibleMatchRow(keyword, "shop:1"), eligibleMatchRow(keyword, "shop:2"), eligibleMatchRow(keyword, "shop:3")],
      itemsByKeyword: { [keyword]: [safeItem("shop:1"), safeItem("shop:2"), safeItem("shop:3")] },
    },
    { keywords: [{ normalizedKeyword: keyword, title: "テスト", slug: "senior-dog-food-test", action: "CREATE" }] },
    async ({ sourceRunDir, approvedFilePath }) => {
      const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
      assert.equal(result.ok, false);
      assert.match(result.errors.join(""), /検索意図が既存の設定済みキーワード/);
    }
  );
});

test("承認ファイルに存在するがsource runに存在しないキーワードは全件拒否する", async () => {
  await withDirs(
    {},
    { keywords: [{ normalizedKeyword: "存在しないキーワード", title: "テスト", slug: "nonexistent-test", action: "CREATE" }] },
    async ({ sourceRunDir, approvedFilePath }) => {
      const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
      assert.equal(result.ok, false);
      assert.match(result.errors.join(""), /見つかりません/);
    }
  );
});

test("2件承認し、1件だけがゲート違反の場合でも全件拒否する(部分生成しない)", async () => {
  const otherKeyword = "キャットフード グレインフリー";
  await withDirs(
    { scoresRows: [scoreRow(), scoreRow({ originalKeyword: otherKeyword, normalizedKeyword: otherKeyword, decisionStatus: "TEST" })] },
    {
      keywords: [
        { normalizedKeyword: KEYWORD, title: "OK候補", slug: "ok-candidate-test", action: "CREATE" },
        { normalizedKeyword: otherKeyword, title: "NG候補", slug: "ng-candidate-test", action: "CREATE" },
      ],
    },
    async ({ sourceRunDir, approvedFilePath }) => {
      const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
      assert.equal(result.ok, false, "1件でも違反があれば全体を失敗にする");
      assert.equal(result.drafts, undefined, "部分的にdraftsを返さない");
    }
  );
});

// --- 2026-09-07 PR#5監査対応: データ整合性・商品安全・数値検証・承認時刻の新規ゲート ---

test("【監査対応】ELIGIBLE照合と商品表示データのitemCodeが不一致の場合は全件拒否する", async () => {
  await withDirs(
    {
      matchesRows: [eligibleMatchRow(KEYWORD, "shop:1"), eligibleMatchRow(KEYWORD, "shop:2"), eligibleMatchRow(KEYWORD, "shop:3")],
      itemsByKeyword: { [KEYWORD]: [safeItem("shop:1")] }, // 表示商品は1件だけ(不整合)
    },
    {},
    async ({ sourceRunDir, approvedFilePath }) => {
      const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
      assert.equal(result.ok, false);
      assert.match(result.errors.join(""), /データ整合性|itemCodeが一致しません/);
    }
  );
});

test("【監査対応・回帰テスト13】医療・健康表現を含む商品は表示候補から除外される(除外後も3件以上残れば生成成功)", async () => {
  await withDirs(
    {
      matchesRows: [
        eligibleMatchRow(KEYWORD, "shop:1"),
        eligibleMatchRow(KEYWORD, "shop:2"),
        eligibleMatchRow(KEYWORD, "shop:3"),
        eligibleMatchRow(KEYWORD, "shop:4"),
      ],
      itemsByKeyword: {
        [KEYWORD]: [
          safeItem("shop:1"),
          safeItem("shop:2"),
          safeItem("shop:3"),
          safeItem("shop:4", { itemName: "食べれば病気が治るフード", catchcopy: "" }), // MEDICAL_TERMS「治る」「病気」を含む
        ],
      },
    },
    {},
    async ({ sourceRunDir, approvedFilePath }) => {
      const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      assert.equal(result.drafts.length, 1);
      assert.doesNotMatch(result.drafts[0].html, /食べれば病気が治る/);
      assert.match(result.validationReportLines.join("\n"), /安全確認.*1件を除外/);
    }
  );
});

test("【監査対応・回帰テスト14】安全確認で除外した結果3件未満になる場合は全件拒否する", async () => {
  await withDirs(
    {
      matchesRows: [eligibleMatchRow(KEYWORD, "shop:1"), eligibleMatchRow(KEYWORD, "shop:2"), eligibleMatchRow(KEYWORD, "shop:3")],
      itemsByKeyword: {
        [KEYWORD]: [
          safeItem("shop:1"),
          safeItem("shop:2", { itemName: "食べれば病気が治るフード" }), // 医療表現で除外される
          safeItem("shop:3", { itemName: "関節の健康にダイエット効果", catchcopy: "" }), // 健康訴求語で除外される
        ],
      },
    },
    {},
    async ({ sourceRunDir, approvedFilePath }) => {
      const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
      assert.equal(result.ok, false);
      assert.match(result.errors.join(""), /最低基準/);
    }
  );
});

test("【監査対応・回帰テスト15】seller由来のcatchcopyは生成されたHTMLへ一切出力されない", async () => {
  const secretCatchcopy = "これは絶対に表示してはいけない販売者コピーXYZ123";
  await withDirs(
    { itemsByKeyword: { [KEYWORD]: [safeItem("shop:1", { catchcopy: secretCatchcopy }), safeItem("shop:2"), safeItem("shop:3")] } },
    {},
    async ({ sourceRunDir, approvedFilePath }) => {
      const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      assert.doesNotMatch(result.drafts[0].html, /XYZ123/);
    }
  );
});

test("【監査対応・回帰テスト16】qualityScoreが不正な値(範囲外)の場合は全件拒否する", async () => {
  await withDirs(
    { itemsByKeyword: { [KEYWORD]: [safeItem("shop:1", { qualityScore: 999 }), safeItem("shop:2"), safeItem("shop:3")] } },
    {},
    async ({ sourceRunDir, approvedFilePath }) => {
      const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
      assert.equal(result.ok, false);
      assert.match(result.errors.join(""), /qualityScoreが不正/);
    }
  );
});

test("【監査対応】itemPriceが負数(不正値)の場合は全件拒否する", async () => {
  await withDirs(
    { itemsByKeyword: { [KEYWORD]: [safeItem("shop:1", { itemPrice: -500 }), safeItem("shop:2"), safeItem("shop:3")] } },
    {},
    async ({ sourceRunDir, approvedFilePath }) => {
      const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
      assert.equal(result.ok, false);
      assert.match(result.errors.join(""), /itemPriceが不正/);
    }
  );
});

test("【監査対応】承認ファイルのapprovedAtがsource runのexecutedAtより前の場合は全件拒否する", async () => {
  const sourceRun = await buildSourceRunDir({ executedAt: new Date().toISOString() });
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-build-approval-"));
  try {
    const beforeExecutedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1時間前(source run実行より前)
    const approvedFilePath = await writeApprovalFile(approvalDir, sourceRun, { approvedAt: beforeExecutedAt });
    const result = await buildPilotDrafts({ sourceRunDir: sourceRun.dir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /executedAt/);
  } finally {
    await rm(sourceRun.dir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
  }
});

test("【監査対応】docs/rankingsが存在しないprojectRootの場合は全件拒否する(重複検出フェイルクローズ)", async () => {
  await withDirs({}, {}, async ({ sourceRunDir, approvedFilePath }) => {
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: "/definitely/does/not/exist" });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /重複検出|見つかりません/);
  });
});

test("【監査対応】表示される商品はpageReadyItems(Quality Score降順・最大5件)である", async () => {
  await withDirs(
    {
      matchesRows: [
        eligibleMatchRow(KEYWORD, "shop:1"),
        eligibleMatchRow(KEYWORD, "shop:2"),
        eligibleMatchRow(KEYWORD, "shop:3"),
        eligibleMatchRow(KEYWORD, "shop:4"),
      ],
      itemsByKeyword: {
        [KEYWORD]: [
          safeItem("shop:1", { qualityScore: 60 }),
          safeItem("shop:2", { qualityScore: 90 }),
          safeItem("shop:3", { qualityScore: 75 }),
          safeItem("shop:4", { qualityScore: 85 }),
        ],
      },
    },
    {},
    async ({ sourceRunDir, approvedFilePath }) => {
      const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      const html = result.drafts[0].html;
      // itemCode自体はHTMLへ出力しないため、順序はqualityScore値の出現順で確認する
      const scoreOrder = [...html.matchAll(/(\d+)<span class="score-max">/g)].map((m) => Number(m[1]));
      assert.deepEqual(scoreOrder, [90, 85, 75, 60]);
    }
  );
});

// =====================================================================
// 2026-09-07 PR#6対応: 商品関連性ゲート(猫用ランキングへの犬用商品混入防止)
// =====================================================================
// 2026-09-07にPhase 3A下書き「キャットフード グレインフリー」で、犬用おやつが
// Quality Score 98で1位表示される誤判定が実際に発生した実例をもとにした回帰テスト。

const CAT_KEYWORD = "キャットフード グレインフリー";
const CAT_REQUIRED_ATTRS = "species:cat | productType:staple | feature:grain-free";

// 2026-09-07 live source run(phase3a-live-2026-09-07-01)で実際に検出された商品
// (itemCode: firstact:10000037)。itemNameに「犬」「おやつ」「ジャーキー」等の
// 犬用おやつを示す語と、SEOキーワードとして「キャットフード」「猫」が併記されている。
const REAL_MISCLASSIFIED_ITEM = {
  itemCode: "firstact:10000037",
  itemName:
    "【累計7万袋突破】選べる5個セット | 送料無料 犬 おやつ 無添加 どっぐふーどる 国産 さつまいも ジャーキー 詰め合わせ ドッグフード 犬のおやつ ドックフード 犬おやつ 犬用 小分け オヤツ キャットフード 猫 犬のオヤツ ペットフード",
  catchcopy: "新おやつ追加 小粒 小分け 野菜 プレゼント どっぐふーどる 犬用 おやつ 食べきりサイズ よりどり選べる5種 ペットフード グルテンフリー グレインフリー 詰め合わせ ギフト",
  itemPrice: 2780,
  reviewAverage: 4.81,
  reviewCount: 1814,
  qualityScore: 98,
};

function catSourceRunOptions(catItems) {
  return {
    scoresRows: [scoreRow({ originalKeyword: CAT_KEYWORD, normalizedKeyword: CAT_KEYWORD })],
    matchesRows: catItems.map((item) => eligibleMatchRow(CAT_KEYWORD, item.itemCode, { requiredAttributes: CAT_REQUIRED_ATTRS, matchedAttributes: CAT_REQUIRED_ATTRS })),
    itemsByKeyword: { [CAT_KEYWORD]: catItems },
  };
}

function catApprovalOverrides() {
  return { keywords: [{ normalizedKeyword: CAT_KEYWORD, title: "猫用グレインフリーキャットフードおすすめランキング比較", slug: "grain-free-cat-food", action: "CREATE" }] };
}

function catItem(itemCode, overrides = {}) {
  return { itemCode, itemName: `猫用グレインフリーキャットフード${itemCode}`, catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, qualityScore: 80, ...overrides };
}

test("【回帰テスト・実例/テスト10,12】2026-09-07に実際に混入した犬用おやつはpageReadyItemsから除外され、残り3件で生成成功する", async () => {
  const catItems = [REAL_MISCLASSIFIED_ITEM, catItem("shop:1"), catItem("shop:2"), catItem("shop:3")];
  await withDirs(catSourceRunOptions(catItems), catApprovalOverrides(), async ({ sourceRunDir, approvedFilePath }) => {
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.drafts.length, 1);
    const html = result.drafts[0].html;
    assert.doesNotMatch(html, /ジャーキー|どっぐふーどる|犬のおやつ/, "犬用おやつが表示に含まれていないこと");
    assert.match(
      result.validationReportLines.join("\n"),
      /商品単位の関連性確認: 合計1件を除外/,
      "関連性ゲートによる除外がvalidation-reportへ記録されること"
    );
  });
});

test("【回帰テスト・テスト11】商品関連性確認による除外後2件になる場合は全件拒否する", async () => {
  // 犬用商品2件+猫用商品2件 → 犬用2件が除外され、残り2件(最低基準3件未満)で拒否される
  const catItems = [
    { ...REAL_MISCLASSIFIED_ITEM },
    { ...REAL_MISCLASSIFIED_ITEM, itemCode: "firstact:10000038" },
    catItem("shop:1"),
    catItem("shop:2"),
  ];
  await withDirs(catSourceRunOptions(catItems), catApprovalOverrides(), async ({ sourceRunDir, approvedFilePath }) => {
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /商品関連性確認.*最低基準/);
  });
});

test("【回帰テスト・テスト13】Quality Score 98でも商品関連性ゲートに矛盾する商品は採用されない", async () => {
  // REAL_MISCLASSIFIED_ITEMはqualityScore=98で他の猫用商品(80)より高いが、
  // 関連性ゲートで除外されるため、生成されたHTMLには一切現れない。
  const catItems = [REAL_MISCLASSIFIED_ITEM, catItem("shop:1", { qualityScore: 70 }), catItem("shop:2", { qualityScore: 75 }), catItem("shop:3", { qualityScore: 60 })];
  await withDirs(catSourceRunOptions(catItems), catApprovalOverrides(), async ({ sourceRunDir, approvedFilePath }) => {
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts[0].html;
    assert.doesNotMatch(html, />98<span class="score-max">/, "Quality Score 98(矛盾商品)がHTMLに出力されていないこと");
  });
});

test("【回帰テスト・テスト14】validation-reportにseller文言全文(itemName)が含まれない", async () => {
  const catItems = [REAL_MISCLASSIFIED_ITEM, catItem("shop:1"), catItem("shop:2"), catItem("shop:3")];
  await withDirs(catSourceRunOptions(catItems), catApprovalOverrides(), async ({ sourceRunDir, approvedFilePath }) => {
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const report = result.validationReportLines.join("\n");
    assert.doesNotMatch(report, /どっぐふーどる|ジャーキー|累計7万袋突破/, "seller由来の商品名全文がvalidation-reportへ記録されていないこと");
  });
});

// =====================================================================
// 2026-09-07 PR#6追加監査対応: 主食語・おやつ語併記商品の除外、validation-reportの個別記録
// =====================================================================

function ambiguousProductTypeItem(itemCode, overrides = {}) {
  // 主食語(キャットフード)・おやつ語(おやつ・ジャーキー)の両方をitemNameに含む猫用商品
  // (動物種は矛盾しないが、商品種別がSEOキーワード詰め込みで曖昧な実例パターン)。
  return { itemCode, itemName: `猫用 おやつ ジャーキー キャットフード ${itemCode}`, catchcopy: "", itemPrice: 2500, reviewAverage: 4.2, reviewCount: 50, qualityScore: 95, ...overrides };
}

test("【追加監査9】Phase 3A層でも主食語・おやつ語併記商品(AMBIGUOUS_PRODUCT_TYPE)が除外される", async () => {
  const catItems = [ambiguousProductTypeItem("shop:amb"), catItem("shop:1"), catItem("shop:2"), catItem("shop:3")];
  await withDirs(catSourceRunOptions(catItems), catApprovalOverrides(), async ({ sourceRunDir, approvedFilePath }) => {
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts[0].html;
    assert.doesNotMatch(html, />95<span class="score-max">/, "AMBIGUOUS_PRODUCT_TYPE商品(Quality Score 95)がHTMLに出力されていないこと");
    assert.match(result.validationReportLines.join("\n"), /AMBIGUOUS_PRODUCT_TYPE/);
  });
});

test("【追加監査10】validation-reportにitemCodeと理由コードが個別行として記録される", async () => {
  const catItems = [REAL_MISCLASSIFIED_ITEM, catItem("shop:1"), catItem("shop:2"), catItem("shop:3")];
  await withDirs(catSourceRunOptions(catItems), catApprovalOverrides(), async ({ sourceRunDir, approvedFilePath }) => {
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const report = result.validationReportLines.join("\n");
    assert.match(
      report,
      /商品関連性除外: keyword=キャットフード グレインフリー, itemCode=firstact:10000037, reasonCodes=.*AMBIGUOUS_SPECIES.*AMBIGUOUS_PRODUCT_TYPE|商品関連性除外: keyword=キャットフード グレインフリー, itemCode=firstact:10000037, reasonCodes=.*AMBIGUOUS_PRODUCT_TYPE.*AMBIGUOUS_SPECIES/,
      "itemCodeと理由コードが個別行として記録されること"
    );
  });
});

test("【追加監査11】validation-reportにitemName・catchcopy・店舗名が一切含まれない(除外区分の個別記録を含めて)", async () => {
  const catItems = [
    REAL_MISCLASSIFIED_ITEM,
    catItem("shop:1", { itemName: "治療効果のある猫用フードXYZSECRET1" }), // 安全除外対象(医療語彙「治療」を含む)
    catItem("shop:2"),
    catItem("shop:3"),
    catItem("shop:4"),
  ];
  await withDirs(catSourceRunOptions(catItems), catApprovalOverrides(), async ({ sourceRunDir, approvedFilePath }) => {
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const report = result.validationReportLines.join("\n");
    assert.doesNotMatch(report, /XYZSECRET1|どっぐふーどる|雑貨とペット用品/, "seller文言・店舗名が記録されていないこと");
    assert.match(report, /商品安全除外: keyword=.*itemCode=shop:1/, "安全除外もitemCode単位で個別記録されること");
  });
});

test("【追加監査12】商品関連性確認(AMBIGUOUS_PRODUCT_TYPE)による除外後2件になる場合は全件拒否する", async () => {
  const catItems = [ambiguousProductTypeItem("shop:amb1"), ambiguousProductTypeItem("shop:amb2"), catItem("shop:1"), catItem("shop:2")];
  await withDirs(catSourceRunOptions(catItems), catApprovalOverrides(), async ({ sourceRunDir, approvedFilePath }) => {
    const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot: PROJECT_ROOT });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /商品関連性確認.*最低基準/);
  });
});
