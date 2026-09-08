// 【2026-09-07 Phase 3B対応】公開前プレビュー生成オーケストレーション
// (publication-preview-build.js)のテスト。source run・商品公開承認ファイル・レビュー資料・
// 楽天商品補完データの4つをすべて読み取り専用で突き合わせ、hash不一致・最終ゲート違反・
// 店舗/シリーズ偏りを検証する。楽天APIは一切呼ばない(すべて事前構築したfixtureのみ使用)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { buildPublicationPreview } from "../publication-preview-build.js";
import {
  createOutputRoot,
  buildFixtureSourceRun,
  buildFixtureKeywordApprovalFile,
  buildFixtureReviewRun,
  buildFixtureEnrichmentRun,
  buildFixturePublicationApprovalFile,
  approvedProduct,
  enrichedItem,
  DOG_SLUG,
  CAT_SLUG,
} from "./helpers/phase3b-fixtures.js";

async function fileHash(filePath) {
  return createHash("sha256").update(await readFile(filePath, "utf-8"), "utf-8").digest("hex");
}

/**
 * デフォルトで全ゲートを満たす一式(source run/review/enrichment/公開承認)を組み立てる。
 * 各段の内容はoverridesで個別に上書きできる。
 */
async function setupFullFixture({
  sourceRunOverrides,
  dogCandidateOverrides = (c) => c,
  catCandidateOverrides = (c) => c,
  dogProductOverrides = (p) => p,
  catProductOverrides = (p) => p,
  dogEnrichedOverrides = (e) => e,
  catEnrichedOverrides = (e) => e,
  approvalOverrides = {},
  reviewOverrides = {},
} = {}) {
  const outputRoot = await createOutputRoot();
  const sourceRun = await buildFixtureSourceRun(outputRoot, sourceRunOverrides);
  const { filePath: keywordApprovalPath } = await buildFixtureKeywordApprovalFile(outputRoot, sourceRun);
  const keywordApprovedFileHash = await fileHash(keywordApprovalPath);

  const dogCandidates = ["shop:d1", "shop:d2", "shop:d3"].map((c) =>
    dogCandidateOverrides({ itemCode: c, itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: `S-${c}`, qualityScore: 80, verifiedAttributes: [], needsFlavorSelectionNote: false })
  );
  const catCandidates = ["shop:c1", "shop:c2", "shop:c3"].map((c) =>
    catCandidateOverrides({ itemCode: c, itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: `S-${c}`, qualityScore: 80, verifiedAttributes: [], needsFlavorSelectionNote: false })
  );
  const reviewRun = await buildFixtureReviewRun(outputRoot, sourceRun, keywordApprovedFileHash, { dogCandidates, catCandidates, ...reviewOverrides });

  const dogProducts = ["shop:d1", "shop:d2", "shop:d3"].map((c) => dogProductOverrides(approvedProduct(c)));
  const catProducts = ["shop:c1", "shop:c2", "shop:c3"].map((c) => catProductOverrides(approvedProduct(c)));
  const { filePath: pubApprovalPath } = await buildFixturePublicationApprovalFile(outputRoot, sourceRun, keywordApprovedFileHash, reviewRun, {
    dogProducts,
    catProducts,
    ...approvalOverrides,
  });
  const publicationApprovedFileHash = await fileHash(pubApprovalPath);

  const dogEnriched = ["shop:d1", "shop:d2", "shop:d3"].map((c) => dogEnrichedOverrides(enrichedItem(c, { sourceRunId: sourceRun.runId, publicationApprovedFileHash })));
  const catEnriched = ["shop:c1", "shop:c2", "shop:c3"].map((c) => catEnrichedOverrides(enrichedItem(c, { sourceRunId: sourceRun.runId, publicationApprovedFileHash })));
  const enrichmentRun = await buildFixtureEnrichmentRun(outputRoot, sourceRun, publicationApprovedFileHash, { dogEnrichedItems: dogEnriched, catEnrichedItems: catEnriched });

  return { outputRoot, sourceRun, pubApprovalPath, enrichmentRun };
}

async function cleanup(outputRoot) {
  await rm(outputRoot, { recursive: true, force: true });
}

test("すべてのゲートを満たす場合は生成に成功する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.drafts.length, 2);
    assert.ok(result.drafts.some((d) => d.slug === DOG_SLUG));
    assert.ok(result.drafts.some((d) => d.slug === CAT_SLUG));
  } finally {
    await cleanup(outputRoot);
  }
});

test("商品公開承認ファイルのcandidateSetHashがsource runと不一致なら拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    approvalOverrides: {},
  });
  // 承認ファイルを直接書き換えてcandidateSetHashを壊す
  const raw = JSON.parse(await readFile(pubApprovalPath, "utf-8"));
  raw.candidateSetHash = "tampered-hash";
  await writeFile(pubApprovalPath, JSON.stringify(raw), "utf-8");
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /candidateSetHash/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("レビュー資料のreviewHashが再計算結果と一致しない場合(改変)は拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  // レビュー資料の内容を後から改変(publicationReviewHash不一致を発生させる)
  const raw = JSON.parse(await readFile(pubApprovalPath, "utf-8"));
  const reviewRunDir = `${outputRoot}publication-reviews/${raw.reviewRunId}/`;
  const reviewCandidatesPath = `${reviewRunDir}publication-candidates.json`;
  const reviewRaw = JSON.parse(await readFile(reviewCandidatesPath, "utf-8"));
  reviewRaw.pages[0].candidates.push({ itemCode: "shop:tampered", itemPrice: 1, reviewAverage: 1, reviewCount: 1, shopName: "x", qualityScore: 1, verifiedAttributes: [], needsFlavorSelectionNote: false });
  await writeFile(reviewCandidatesPath, JSON.stringify(reviewRaw, null, 2), "utf-8");
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /reviewHash|publicationReviewHash/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("補完データのenrichmentArtifactHashが記録値と一致しない場合(改変)は拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  const itemsPath = `${enrichmentRun.dir}enrichment-items.json`;
  const raw = JSON.parse(await readFile(itemsPath, "utf-8"));
  raw[DOG_SLUG][0].itemPrice = 999999; // 保存後に改変
  await writeFile(itemsPath, JSON.stringify(raw, null, 2), "utf-8");
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /enrichmentArtifactHash|改変/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("補完データのrakutenSourceがliveでない(fixture混入)場合は拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  const metaPath = `${enrichmentRun.dir}run-metadata.json`;
  const raw = JSON.parse(await readFile(metaPath, "utf-8"));
  raw.rakutenSource = "fixture";
  await writeFile(metaPath, JSON.stringify(raw, null, 2), "utf-8");
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /rakutenSource|live/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("approvedAtがレビュー資料生成日時より前の場合は拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    approvalOverrides: { approvedAt: "2020-01-01T00:00:00.000Z" },
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /approvedAt/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("source runに存在しないitemCodeが承認されている場合は拒否する", async () => {
  // 承認ファイル構築の時点でsource runに無いitemCodeを含めておく(構築後にファイルを
  // 直接書き換えるとpublicationApprovedFileHashが変わってしまい、hash不一致エラーが
  // 先に発生してしまうため、fixture構築の入口で不整合を作る)。
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    dogProductOverrides: (p) => (p.itemCode === "shop:d1" ? { ...p, itemCode: "shop:does-not-exist" } : p),
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /source runに存在しません/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("楽天最新結果(補完データ)に存在しないitemCodeが承認されている場合は拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  const itemsPath = `${enrichmentRun.dir}enrichment-items.json`;
  const raw = JSON.parse(await readFile(itemsPath, "utf-8"));
  raw[DOG_SLUG] = raw[DOG_SLUG].filter((i) => i.itemCode !== "shop:d1");
  await writeFile(itemsPath, JSON.stringify(raw, null, 2), "utf-8");
  // enrichmentArtifactHashを再計算して整合させる(改変検知テストではなく、欠損データのテストのため)
  const { sha256File } = await import("../hash-utils.js");
  const metaPath = `${enrichmentRun.dir}run-metadata.json`;
  const meta = JSON.parse(await readFile(metaPath, "utf-8"));
  meta.artifactHashes["enrichment-items.json"] = await sha256File(itemsPath);
  await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /楽天最新結果/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("最終ゲートで動物種矛盾が再検出された場合は拒否する(defense in depth)", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    sourceRunOverrides: {
      dogItemsOverride: [
        { itemCode: "shop:d1", itemName: "猫用 グレインフリー キャットフード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S1", qualityScore: 80 },
        { itemCode: "shop:d2", itemName: "アルファブランド 豚肉レシピ シニア犬用ごはん", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S2", qualityScore: 80 },
        { itemCode: "shop:d3", itemName: "ベータキッチン特製 老犬向け豚肉フード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S3", qualityScore: 80 },
      ],
    },
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /商品関連性ゲート/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("最終ゲートで医療語彙が再検出された場合は拒否する(defense in depth)", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    sourceRunOverrides: {
      dogItemsOverride: [
        { itemCode: "shop:d1", itemName: "食べれば病気が治る豚肉シニア犬用ドッグフード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S1", qualityScore: 80 },
        { itemCode: "shop:d2", itemName: "アルファブランド 豚肉レシピ シニア犬用ごはん", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S2", qualityScore: 80 },
        { itemCode: "shop:d3", itemName: "ベータキッチン特製 老犬向け豚肉フード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S3", qualityScore: 80 },
      ],
    },
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /安全性ゲート|MEDICAL_REVIEW_REQUIRED/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("同一店舗が上限(2件)を超える場合は拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    dogEnrichedOverrides: (e) => ({ ...e, shopName: "同じ店" }),
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /同一店舗/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("同一シリーズ商品が3件以上の場合は拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    sourceRunOverrides: {
      dogItemsOverride: [
        { itemCode: "shop:d1", itemName: "グリーンプラス ドライフード ドッグフード チキン/ポーク/豚肉 1kg入 シニア犬用", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S1", qualityScore: 80 },
        { itemCode: "shop:d2", itemName: "グリーンプラス ドライフード ドッグフード ビーフ/豚肉 1kg入 シニア犬用", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S2", qualityScore: 79 },
        { itemCode: "shop:d3", itemName: "グリーンプラス ドライフード ドッグフード 魚/豚肉 1kg入 シニア犬用", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S3", qualityScore: 78 },
      ],
    },
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /同一シリーズ/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("生成されたHTMLはDRAFTバナー・noindex・画像・CTA・rel属性を含み、内部情報を含まない", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;

    assert.match(html, /DRAFT/);
    assert.match(html, /noindex,nofollow/);
    assert.match(html, /<img class="product-image"/);
    assert.match(html, /loading="lazy"/);
    assert.match(html, /width="128" height="128"/);
    assert.match(html, /rel="nofollow sponsored noopener"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /楽天市場で在庫・価格を確認してください/);

    assert.doesNotMatch(html, /シニア 犬 豚肉/); // normalizedKeyword
    assert.doesNotMatch(html, /WebKeywordScore/);
    assert.doesNotMatch(html, /FinalPriority/);
    assert.doesNotMatch(html, /candidateSetHash/);
    assert.doesNotMatch(html, /approvedFileHash/i);
    assert.doesNotMatch(html, /phase3b-test-source-run/); // sourceRunId
    assert.doesNotMatch(html, /\bqualityScore\b/i);
    assert.doesNotMatch(html, /2026-09-07T/); // ISO日時
    assert.match(html, /\d{4}年\d{1,2}月\d{1,2}日時点/); // 日本語日付
    assert.doesNotMatch(html, /<script/i);
  } finally {
    await cleanup(outputRoot);
  }
});

test("商品順位はQuality Score降順である", async () => {
  const scores = { "shop:d1": 60, "shop:d2": 90, "shop:d3": 75 };
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    sourceRunOverrides: {
      dogItemsOverride: [
        { itemCode: "shop:d1", itemName: "アルファブランド 豚肉レシピ シニア犬用ごはん", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S1", qualityScore: scores["shop:d1"] },
        { itemCode: "shop:d2", itemName: "ベータキッチン特製 老犬向け豚肉フード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S2", qualityScore: scores["shop:d2"] },
        { itemCode: "shop:d3", itemName: "ガンマファーム直送 豚肉メインの高齢犬用総合栄養食", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S3", qualityScore: scores["shop:d3"] },
      ],
    },
    dogProductOverrides: (p) => ({ ...p, displayName: `表示名-${p.itemCode}` }),
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    const idxD2 = html.indexOf("表示名-shop:d2"); // qualityScore 90(最高)
    const idxD3 = html.indexOf("表示名-shop:d3"); // qualityScore 75
    const idxD1 = html.indexOf("表示名-shop:d1"); // qualityScore 60(最低)
    assert.ok(idxD2 < idxD3 && idxD3 < idxD1, "Quality Score降順で並んでいること");
  } finally {
    await cleanup(outputRoot);
  }
});

test("複数フレーバー豚肉選択商品には固定の注意文が強制表示される", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    sourceRunOverrides: {
      dogItemsOverride: [
        { itemCode: "shop:d1", itemName: "選べる5種類 豚肉 鶏肉 牛肉 シニア犬用 ドッグフード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S1", qualityScore: 80 },
        { itemCode: "shop:d2", itemName: "アルファブランド 豚肉レシピ シニア犬用ごはん", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S2", qualityScore: 79 },
        { itemCode: "shop:d3", itemName: "ベータキッチン特製 老犬向け豚肉フード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S3", qualityScore: 78 },
      ],
    },
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    assert.match(html, /購入時に豚肉タイプを選択してください/);
  } finally {
    await cleanup(outputRoot);
  }
});

// =====================================================================
// 【2026-09-08 在庫ゲート対応】段階Cの独立した在庫再検証(多層防御)。
// 段階B(enrich-publication-products)の判定結果をそのまま信用せず、
// enrichment-items.json自体のavailabilityを段階Cが独立して再チェックする。
// 人間承認済み(product.humanApproved=true)であっても在庫ゲートは回避できない。
// =====================================================================

test("段階Cの独立した在庫再検証: enrichment-items.jsonのavailability=0は最終ゲートで拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    dogEnrichedOverrides: (e) => (e.itemCode === "shop:d1" ? { ...e, availability: 0 } : e),
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /在庫/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("段階Cの独立した在庫再検証: availabilityが欠損している(在庫ゲート導入前の古い形式)場合も拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    dogEnrichedOverrides: (e) => {
      if (e.itemCode !== "shop:d1") return e;
      const { availability, ...rest } = e;
      return rest;
    },
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /在庫/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("段階Cの独立した在庫再検証: 事後改変でavailability=0にしartifactHashを再計算・整合させても拒否する(hash一致だけでは見逃す欠陥がないことの確認)", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  const itemsPath = `${enrichmentRun.dir}enrichment-items.json`;
  const raw = JSON.parse(await readFile(itemsPath, "utf-8"));
  raw[DOG_SLUG] = raw[DOG_SLUG].map((i) => (i.itemCode === "shop:d1" ? { ...i, availability: 0 } : i));
  await writeFile(itemsPath, JSON.stringify(raw, null, 2), "utf-8");
  // artifactHashを実ファイルに合わせて再計算(改変検知=hash不一致ではなく、
  // 「hashは一致しているのにavailabilityが不正」という独立ゲートの効果を検証するため)
  const { sha256File } = await import("../hash-utils.js");
  const metaPath = `${enrichmentRun.dir}run-metadata.json`;
  const meta = JSON.parse(await readFile(metaPath, "utf-8"));
  meta.artifactHashes["enrichment-items.json"] = await sha256File(itemsPath);
  await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.errors.join(""), /改変の可能性/, "hash不一致としてではなく、独立した在庫ゲートとして拒否されること");
    assert.match(result.errors.join(""), /在庫/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("catchcopyはHTMLへ一切出力されない", async () => {
  const secretCatchcopy = "これは絶対に出力されてはいけない販売者コピーXYZ777";
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    sourceRunOverrides: {
      dogItemsOverride: [
        { itemCode: "shop:d1", itemName: "アルファブランド 豚肉レシピ シニア犬用ごはん", catchcopy: secretCatchcopy, itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S1", qualityScore: 80 },
        { itemCode: "shop:d2", itemName: "ベータキッチン特製 老犬向け豚肉フード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S2", qualityScore: 79 },
        { itemCode: "shop:d3", itemName: "ガンマファーム直送 豚肉メインの高齢犬用総合栄養食", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S3", qualityScore: 78 },
      ],
    },
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    assert.doesNotMatch(html, /XYZ777/);
  } finally {
    await cleanup(outputRoot);
  }
});
