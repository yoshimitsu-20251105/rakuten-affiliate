// 【2026-09-07 Phase 3B対応】テスト専用の共有フィクスチャビルダー。
// source run / レビュー資料 / 楽天商品補完データ / 商品公開承認ファイルは互いにhashで
// 結びついているため、各テストファイルで個別に組み立てると際限なく重複する。
// ここで一括して、実際のモジュール(loadSourceRun等)がそのまま読み込める実ファイルとして
// 一時ディレクトリへ書き出す。テスト実行のたびに使い捨てる(commitしない、実データも使わない)。

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256File, computeCandidateSetHash, computePublicationReviewHash } from "../../hash-utils.js";

export const DOG_KEYWORD = "シニア 犬 豚肉";
export const DOG_SLUG = "senior-dog-pork";
export const DOG_TITLE = "シニア犬向け豚肉ドッグフードおすすめランキング比較";
export const DOG_REQUIRED_ATTRS_STR = "species:dog | lifeStage:senior | productType:staple | ingredient:pork";
export const DOG_REQUIRED_ATTRS = ["species:dog", "lifeStage:senior", "productType:staple", "ingredient:pork"];

export const CAT_KEYWORD = "キャットフード グレインフリー";
export const CAT_SLUG = "grain-free-cat-food";
export const CAT_TITLE = "猫用グレインフリーキャットフードおすすめランキング比較";
export const CAT_REQUIRED_ATTRS_STR = "species:cat | productType:staple | feature:grain-free";
export const CAT_REQUIRED_ATTRS = ["species:cat", "productType:staple", "feature:grain-free"];

const ARTIFACT_FILENAMES = ["keyword-scores.csv", "keyword-candidates.csv", "rakuten-matches.csv", "rakuten-items.json"];

const SCORES_HEADER =
  "originalKeyword,normalizedKeyword,rakutenQuery,businessValidated,scoreBand_simulationOnly,decisionStatus,safetyStatus,queryQualityStatus,rakutenLookupStatus,rakutenSupplyStatus,eligibleForApproval,eligibleForExport,eligibleForPublish,validationFailureReasons,dataSource,sourceProvider,isSynthetic,demand,purchaseIntent,adsCompetitionGap_notSeoCompetition,trendAndStability,rakutenSupplyFit,clusterFit,webKeywordScoreTotal,confidence,bestProductQualityScore,finalPriority,reasons";
const CANDIDATES_HEADER =
  "originalKeyword,normalizedKeyword,rakutenQuery,keywordVariants,cluster,intent,safetyStatus,queryQualityStatus,variantCount,mergeReason,sourceProvider,isSynthetic,periodStart,periodEnd,monthlySearches,searchVolumeVariance,competitionLevel,trendIndex,lowTopOfPageBid_monetizationOnly,highTopOfPageBid_monetizationOnly";
const MATCHES_HEADER =
  "originalKeyword,normalizedKeyword,rakutenQuery,itemCode,status,matchScore,requiredAttributes,matchedAttributes,missingAttributes,conflictingAttributes,dataSource,reasons";

export function scoreRow(keyword, overrides = {}) {
  return {
    originalKeyword: keyword,
    normalizedKeyword: keyword,
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

export function eligibleMatchRow(keyword, itemCode, requiredAttrs, overrides = {}) {
  return {
    originalKeyword: keyword,
    normalizedKeyword: keyword,
    rakutenQuery: keyword,
    itemCode,
    status: "ELIGIBLE",
    matchScore: "100",
    requiredAttributes: requiredAttrs,
    matchedAttributes: requiredAttrs,
    missingAttributes: "",
    conflictingAttributes: "",
    ...overrides,
  };
}

// findSameSeriesGroups()の類似度判定(2-gram Jaccard)に誤って引っかからないよう、
// デフォルトのitemNameはitemCodeごとに文全体の構成が十分異なる内容にする
// (単語を1つ差し替えるだけでは共通する2-gramが多く残り、閾値を超えてしまうため)。
const DOG_ITEM_NAME_TEMPLATES = [
  "アルファブランド 豚肉レシピ シニア犬用ごはん 国産素材使用",
  "ベータキッチン特製 老犬向け豚肉フード 小粒タイプ",
  "ガンマファーム直送 豚肉メインの高齢犬用総合栄養食",
  "デルタフーズ シニアドッグ用ポークディナー 消化にやさしい配合",
  "イプシロン工房謹製 豚肉たっぷりシニア犬ごはん セット",
];
const CAT_ITEM_NAME_TEMPLATES = [
  "ゼータキャット社製 穀物不使用キャットミール 室内猫向け",
  "イータフィーライン グレインフリーレシピ 全猫種対応フード",
  "シータニャン工房 グレインフリー配合 猫用総合栄養食",
  "カッパキャッツ特選 穀物フリーの猫ごはん 小粒タイプ",
  "ラムダフィーラー謹製 グレインフリーキャットミール セット",
];

function pickTemplate(templates, itemCode) {
  const idx = Math.abs(String(itemCode).split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % templates.length;
  return templates[idx];
}

export function dogItem(itemCode, overrides = {}) {
  return {
    itemCode,
    itemName: `${pickTemplate(DOG_ITEM_NAME_TEMPLATES, itemCode)}(${itemCode})`,
    catchcopy: "",
    itemPrice: 3000,
    reviewAverage: 4.5,
    reviewCount: 100,
    shopName: `DogShop-${itemCode}`,
    qualityScore: 80,
    ...overrides,
  };
}

export function catItem(itemCode, overrides = {}) {
  return {
    itemCode,
    itemName: `${pickTemplate(CAT_ITEM_NAME_TEMPLATES, itemCode)}(${itemCode})`,
    catchcopy: "",
    itemPrice: 3000,
    reviewAverage: 4.5,
    reviewCount: 100,
    shopName: `CatShop-${itemCode}`,
    qualityScore: 80,
    ...overrides,
  };
}

async function writeCsv(dir, filename, header, rows) {
  const lines = rows.map((r) => header.split(",").map((h) => r[h] ?? "").join(","));
  await writeFile(join(dir, filename), [header, ...lines].join("\n") + "\n", "utf-8");
}

/**
 * 共有のoutput root(gkp-runs/publication-reviews/publication-enrichmentが兄弟として
 * 並ぶ一時ディレクトリ)を作成する。
 */
export async function createOutputRoot() {
  // deriveOutputRoot()(output-paths.js)はパス内の「output」という文字通りのセグメントを
  // 手がかりに兄弟ディレクトリ(publication-reviews/publication-enrichment等)を導出するため、
  // 一時ディレクトリ自体も本番と同じ「.../output/」という名前のディレクトリにする。
  const base = await mkdtemp(join(tmpdir(), "phase3b-"));
  const root = join(base, "output");
  await mkdir(root, { recursive: true });
  return root.replace(/\\/g, "/") + "/";
}

/**
 * source run一式を実際に書き込み、artifactHashes/candidateSetHashを実ファイルから計算して埋め込む。
 * @returns {Promise<{ dir: string, runId: string, executedAt: string, candidateSetHash: string }>}
 */
export async function buildFixtureSourceRun(
  outputRoot,
  {
    dogItemCodes = ["shop:d1", "shop:d2", "shop:d3"],
    catItemCodes = ["shop:c1", "shop:c2", "shop:c3"],
    dogItemsOverride = null,
    catItemsOverride = null,
    runId = "phase3b-test-source-run",
    executedAt = "2026-09-01T00:00:00.000Z",
  } = {}
) {
  const dir = `${outputRoot}gkp-runs/${runId}/`;
  await mkdir(dir, { recursive: true });

  const scoresRows = [scoreRow(DOG_KEYWORD), scoreRow(CAT_KEYWORD)];
  await writeCsv(dir, "keyword-scores.csv", SCORES_HEADER, scoresRows);
  await writeCsv(dir, "keyword-candidates.csv", CANDIDATES_HEADER, [
    { originalKeyword: DOG_KEYWORD, normalizedKeyword: DOG_KEYWORD, cluster: "シニア犬フード", monthlySearches: "500" },
    { originalKeyword: CAT_KEYWORD, normalizedKeyword: CAT_KEYWORD, cluster: "グレインフリーペットフード", monthlySearches: "500" },
  ]);
  const matchesRows = [
    ...dogItemCodes.map((code) => eligibleMatchRow(DOG_KEYWORD, code, DOG_REQUIRED_ATTRS_STR)),
    ...catItemCodes.map((code) => eligibleMatchRow(CAT_KEYWORD, code, CAT_REQUIRED_ATTRS_STR)),
  ];
  await writeCsv(dir, "rakuten-matches.csv", MATCHES_HEADER, matchesRows);
  const itemsByKeyword = {
    [DOG_KEYWORD]: dogItemsOverride ?? dogItemCodes.map((code) => dogItem(code)),
    [CAT_KEYWORD]: catItemsOverride ?? catItemCodes.map((code) => catItem(code)),
  };
  await writeFile(join(dir, "rakuten-items.json"), JSON.stringify(itemsByKeyword), "utf-8");

  const artifactHashes = {};
  for (const f of ARTIFACT_FILENAMES) artifactHashes[f] = await sha256File(join(dir, f));
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
  };
  await writeFile(join(dir, "run-metadata.json"), JSON.stringify(metadata), "utf-8");

  return { dir, runId, executedAt, candidateSetHash };
}

/**
 * Phase 3Aキーワード承認ファイル(pilot-draft-approval.jsのスキーマ)を書き出す。
 */
export async function buildFixtureKeywordApprovalFile(outputRoot, sourceRun, overrides = {}) {
  const dir = `${outputRoot}approvals/`;
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "keyword-approval.json");
  const approval = {
    version: 1,
    sourceRunId: sourceRun.runId,
    candidateSetHash: sourceRun.candidateSetHash,
    approvedBy: "human",
    approvedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    keywords: [
      { normalizedKeyword: DOG_KEYWORD, title: DOG_TITLE, slug: DOG_SLUG, action: "CREATE" },
      { normalizedKeyword: CAT_KEYWORD, title: CAT_TITLE, slug: CAT_SLUG, action: "CREATE" },
    ],
    ...overrides,
  };
  await writeFile(filePath, JSON.stringify(approval), "utf-8");
  return { filePath, approval };
}

/**
 * 公開候補商品レビュー資料一式(publication-reviews/<runId>/)を書き出す。
 * dogCandidates/catCandidatesには、各itemCodeについて{itemCode, itemPrice, reviewAverage,
 * reviewCount, shopName, qualityScore, verifiedAttributes, needsFlavorSelectionNote}を渡す。
 */
export async function buildFixtureReviewRun(outputRoot, sourceRun, keywordApprovedFileHash, { dogCandidates, catCandidates, runId = "phase3b-test-review", executedAt } = {}) {
  const dir = `${outputRoot}publication-reviews/${runId}/`;
  await mkdir(dir, { recursive: true });

  const pages = [
    { slug: DOG_SLUG, normalizedKeyword: DOG_KEYWORD, title: DOG_TITLE, requiredAttributes: DOG_REQUIRED_ATTRS, candidates: dogCandidates },
    { slug: CAT_SLUG, normalizedKeyword: CAT_KEYWORD, title: CAT_TITLE, requiredAttributes: CAT_REQUIRED_ATTRS, candidates: catCandidates },
  ];
  const reviewHash = computePublicationReviewHash(pages.map((p) => ({ slug: p.slug, topCandidates: p.candidates })));

  const candidatesJson = {
    runId,
    sourceRunId: sourceRun.runId,
    candidateSetHash: sourceRun.candidateSetHash,
    keywordApprovedFileHash,
    reviewHash,
    pages,
  };
  await writeFile(join(dir, "publication-candidates.json"), JSON.stringify(candidatesJson, null, 2), "utf-8");

  const resolvedExecutedAt = executedAt ?? new Date(Date.now() - 10 * 60_000).toISOString();
  const metadata = {
    runId,
    executedAt: resolvedExecutedAt,
    commandMode: "prepare-publication-review",
    status: "completed",
    sourceRunId: sourceRun.runId,
    candidateSetHash: sourceRun.candidateSetHash,
    keywordApprovedFileHash,
    reviewHash,
    slugs: pages.map((p) => p.slug),
    candidateCountBySlug: Object.fromEntries(pages.map((p) => [p.slug, p.candidates.length])),
  };
  await writeFile(join(dir, "run-metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");

  return { dir, runId, executedAt: resolvedExecutedAt, reviewHash };
}

/**
 * 楽天商品補完データ一式(publication-enrichment/<runId>/)を書き出す。
 * dogEnrichedItems/catEnrichedItemsはpublication-enrichment.jsのallowlist形式の配列。
 */
export async function buildFixtureEnrichmentRun(
  outputRoot,
  sourceRun,
  publicationApprovedFileHash,
  { dogEnrichedItems, catEnrichedItems, runId = "phase3b-test-enrichment", rakutenSource = "live" } = {}
) {
  const dir = `${outputRoot}publication-enrichment/${runId}/`;
  await mkdir(dir, { recursive: true });

  const enrichmentItems = { [DOG_SLUG]: dogEnrichedItems, [CAT_SLUG]: catEnrichedItems };
  await writeFile(join(dir, "enrichment-items.json"), JSON.stringify(enrichmentItems, null, 2), "utf-8");

  const artifactHash = await sha256File(join(dir, "enrichment-items.json"));
  const metadata = {
    runId,
    executedAt: new Date().toISOString(),
    commandMode: "enrich-publication-products",
    status: "completed",
    rakutenSource,
    sourceRunId: sourceRun.runId,
    candidateSetHash: sourceRun.candidateSetHash,
    publicationApprovedFileHash,
    logicalRakutenQueryCount: 2,
    apiErrorCount: 0,
    slugs: [DOG_SLUG, CAT_SLUG],
    productCountBySlug: { [DOG_SLUG]: dogEnrichedItems.length, [CAT_SLUG]: catEnrichedItems.length },
    artifactHashes: { "enrichment-items.json": artifactHash },
  };
  await writeFile(join(dir, "run-metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");

  return { dir, runId };
}

export function enrichedItem(itemCode, overrides = {}) {
  return {
    itemCode,
    itemName: `テスト商品${itemCode}`,
    itemPrice: 3000,
    reviewAverage: 4.5,
    reviewCount: 100,
    itemUrl: `https://item.rakuten.co.jp/shop/${itemCode}/`,
    affiliateUrl: `https://hb.afl.rakuten.co.jp/hgc/abc/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fshop%2F${itemCode}%2F`,
    shopName: `Shop-${itemCode}`,
    imageUrl: "https://thumbnail.image.rakuten.co.jp/@0_mall/shop/cabinet/1.jpg",
    fetchedAt: "2026-09-07T12:00:00.000Z",
    sourceRunId: "phase3b-test-source-run",
    publicationApprovedFileHash: "placeholder",
    ...overrides,
  };
}

/**
 * 商品公開承認ファイル(publication-approval.jsのスキーマ)を書き出す。
 */
export async function buildFixturePublicationApprovalFile(
  outputRoot,
  sourceRun,
  keywordApprovedFileHash,
  reviewRun,
  { dogProducts, catProducts, reviewedBy = "test-reviewer", approvedAt, filename = "publication-approval.json" } = {}
) {
  const dir = `${outputRoot}publication-approvals/`;
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, filename);
  const approval = {
    schemaVersion: 1,
    sourceRunId: sourceRun.runId,
    candidateSetHash: sourceRun.candidateSetHash,
    keywordApprovedFileHash,
    reviewRunId: reviewRun.runId,
    approvedAt: approvedAt ?? new Date().toISOString(),
    reviewedBy,
    humanApproved: true,
    pages: [
      { normalizedKeyword: DOG_KEYWORD, slug: DOG_SLUG, title: DOG_TITLE, requiredAttributes: DOG_REQUIRED_ATTRS, products: dogProducts },
      { normalizedKeyword: CAT_KEYWORD, slug: CAT_SLUG, title: CAT_TITLE, requiredAttributes: CAT_REQUIRED_ATTRS, products: catProducts },
    ],
  };
  await writeFile(filePath, JSON.stringify(approval, null, 2), "utf-8");
  return { filePath, approval };
}

export function approvedProduct(itemCode, overrides = {}) {
  return { itemCode, displayName: `テスト表示名${itemCode}`, displayNote: null, humanApproved: true, ...overrides };
}
