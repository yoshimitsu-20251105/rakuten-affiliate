// Phase 3B(公開前商品レビュー・収益化プレビュー)専用: 公開前プレビュー生成の
// オーケストレーション層(2026-09-07対応)。
//
// source run・商品公開承認ファイル・レビュー資料・楽天商品補完データの4つを読み取り専用で
// 突き合わせ、hashが1つでも一致しなければ全件拒否する(fail closed)。安全性・関連性・
// 店舗/シリーズ偏りを最終ゲートとして再検証したうえで、決定的なHTMLを生成する。
// 楽天/Google/Search Console APIは一切呼び出さない(保存済みデータの読み取りのみ)。

import { readFile } from "node:fs/promises";
import { loadSourceRun } from "./pilot-draft-source-run.js";
import { loadPublicationApprovalFile, MIN_PRODUCTS_PER_PAGE, MAX_PRODUCTS_PER_PAGE } from "./publication-approval.js";
import { evaluateProductRelevance } from "./product-relevance.js";
import { classifySafety } from "./safety.js";
import { isAvailableEnrichedItem } from "./publication-enrichment.js";
import { loadConfig } from "./config.js";
import { ATTRIBUTE_LABELS } from "./attributes.js";
import { PUBLICATION_PAGE_REQUIREMENTS, needsFlavorSelectionNote, FLAVOR_SELECTION_NOTE_TEXT } from "./publication-attributes.js";
import { evaluateShopDiversity, hasExcessiveSameSeriesGroup } from "./shop-diversity.js";
import { sha256File, computePublicationReviewHash } from "./hash-utils.js";
import { deriveOutputRoot } from "./output-paths.js";
import { renderPublicationPreviewHtml, formatJaDate } from "./publication-preview-template.js";
import { SITE_URL } from "../lib/site-config.js";

function buildIntroText(requiredAttributes) {
  const animal = requiredAttributes.includes("species:cat") ? "猫" : "犬";
  return `${animal}用のおすすめ商品を、レビュー評価や商品情報をもとに人が内容を確認して選定しました。`;
}

// 【2026-10-05 検索流入テスト再構成対応】内容量(packageSize)から総グラム数を抽出する
// 決定的なパーサー。"1.8kg"/"60g"/"35g×48袋"等に対応。重さを含まない表記
// (例:「角ボトル3個」「選べる3袋セット」)はnullを返す(推測で単価を作らない)。
export function parseGramsFromPackageSize(packageSize) {
  if (typeof packageSize !== "string") return null;
  const match = packageSize.match(/(\d+(?:\.\d+)?)\s*(kg|g)(?:\s*[×x]\s*(\d+))?/i);
  if (!match) return null;
  const [, amountStr, unit, multiplierStr] = match;
  const amount = Number(amountStr);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const grams = unit.toLowerCase() === "kg" ? amount * 1000 : amount;
  const multiplier = multiplierStr ? Number(multiplierStr) : 1;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null;
  return grams * multiplier;
}

// itemPrice・packageSizeの両方が確認できる場合のみ100gあたり価格を計算する
// (どちらか欠けていれば、比較表の列ごと省略する=build側で判定)。
export function computePricePerUnitLabel(packageSize, itemPrice) {
  if (typeof itemPrice !== "number" || !Number.isFinite(itemPrice)) return null;
  const grams = parseGramsFromPackageSize(packageSize);
  if (grams === null) return null;
  const pricePer100g = (itemPrice / grams) * 100;
  return `¥${Math.round(pricePer100g).toLocaleString("ja-JP")}/100g`;
}

// 【2026-10-05 検索流入テスト再構成対応】比較表に出す任意の属性列。各ページで実際に
// 値を持つ商品が1件以上ある列だけを表示する(確認できない項目は比較表から省略し、
// UNKNOWNや推測値で埋めない)。価格・レビューは常に全商品で確定しているため常時表示。
const OPTIONAL_COLUMN_DEFS = [
  { key: "targetAge", label: "対象年齢" },
  { key: "packageSize", label: "内容量" },
  { key: "pricePerUnitLabel", label: "100gあたり" },
  { key: "mainIngredient", label: "主原料" },
  { key: "productFormat", label: "タイプ" },
];

// 【2026-09-10 CTAクリック計測対応】affiliate_clickイベントのanimal_type値(dog/cat)。
// buildIntroText()と同じrequiredAttributes判定をそのまま再利用する(判定基準を1つに保つ)。
function buildAnimalType(requiredAttributes) {
  return requiredAttributes.includes("species:cat") ? "cat" : "dog";
}

function buildAttributeLabels(requiredAttributes) {
  return requiredAttributes.map((t) => ATTRIBUTE_LABELS[t] ?? t);
}

/**
 * 【2026-09-09 試験公開対応】isDraft(既定true)をfalseにすると、生成されるHTMLから
 * DRAFTバナーと「【下書き・非公開】」タイトル接頭辞を取り除く(通常ページと同じ見た目)。
 * 全ゲート・全検証ロジックはisDraftの値に関わらず完全に同一(安全性は一切緩めない)。
 * gaMeasurementIdを渡すと、isDraft:falseの場合のみ既存サイトと同じGA4計測タグを
 * 出力する(新しいGA4プロパティは作成せず、既存のIDをそのまま再利用するだけ)。
 * 【2026-09-10 検索公開試験対応】allowSearchIndex(既定false)をtrueにすると、
 * isDraft:falseの場合のみrobots metaを省略する(通常の公開ページと同じ挙動)。
 * 安全性・関連性ゲート等はisDraft/allowSearchIndexの値に関わらず完全に同一。
 * 【2026-09-10 canonical・CTAクリック計測対応】各ページのcanonical URLは、既存サイトと
 * 共通のSITE_URL(lib/site-config.js)から`${SITE_URL}/rankings/${slug}.html`として
 * このモジュール内で組み立てる(呼び出し側から任意の値を受け取らない。相対URL・
 * 別ページURL・重複canonicalが混入する余地を構造的になくすため)。animal_typeは
 * pageConfig.requiredAttributesから機械的に判定する。pageTypeはaffiliate_click
 * イベントに含める固定ラベル(既定"search_trial_ranking")。
 * @param {{ sourceRunDir: string, publicationApprovedFilePath: string, enrichmentRunDir: string, isDraft?: boolean, gaMeasurementId?: string, allowSearchIndex?: boolean, pageType?: string }} options
 * @returns {Promise<{
 *   ok: boolean, errors: string[], validationReportLines: string[],
 *   drafts?: Array<{ slug: string, html: string }>,
 *   sourceRunId?: string, candidateSetHash?: string, publicationApprovedFileHash?: string,
 *   enrichmentArtifactHash?: string, productCountBySlug?: Record<string, number>,
 * }>}
 */
export async function buildPublicationPreview({ sourceRunDir, publicationApprovedFilePath, enrichmentRunDir, isDraft = true, gaMeasurementId = "", allowSearchIndex = false, pageType = "search_trial_ranking" }) {
  const validationReportLines = [];
  const errors = [];

  // --- 1. source run ---
  const { valid: sourceRunValid, errors: sourceRunErrors, metadata, candidatesByKeyword } = await loadSourceRun(sourceRunDir);
  if (!sourceRunValid) {
    return { ok: false, errors: sourceRunErrors.map((e) => `[source run] ${e}`), validationReportLines };
  }
  validationReportLines.push(`source run: 検証OK(runId=${metadata.runId})`);

  // --- 2. 商品公開承認ファイル ---
  const safetyConfig = await loadConfig();
  const { valid: approvalValid, approval, approvedFileHash, errors: approvalErrors } = await loadPublicationApprovalFile(publicationApprovedFilePath, {
    safetyConfig,
  });
  if (!approvalValid) {
    return { ok: false, errors: approvalErrors.map((e) => `[商品公開承認ファイル] ${e}`), validationReportLines };
  }
  validationReportLines.push(`商品公開承認ファイル: 検証OK(publicationApprovedFileHash=${approvedFileHash})`);

  if (approval.sourceRunId !== metadata.runId) {
    errors.push(`商品公開承認ファイルのsourceRunId「${approval.sourceRunId}」がsource runの実際のrunId「${metadata.runId}」と一致しません`);
  }
  if (approval.candidateSetHash !== metadata.candidateSetHash) {
    errors.push(`商品公開承認ファイルのcandidateSetHashがsource runの実際のcandidateSetHashと一致しません`);
  }
  if (errors.length > 0) {
    return { ok: false, errors, validationReportLines, sourceRunId: metadata.runId, candidateSetHash: metadata.candidateSetHash, publicationApprovedFileHash: approvedFileHash };
  }

  // --- 3. レビュー資料(段階A)との整合性 ---
  let outputRoot;
  try {
    outputRoot = deriveOutputRoot(sourceRunDir);
  } catch (e) {
    return { ok: false, errors: [`[出力先解決] ${e.message}`], validationReportLines };
  }
  const reviewRunDir = `${outputRoot}publication-reviews/${approval.reviewRunId}/`;
  let reviewMetadata, reviewCandidates;
  try {
    reviewMetadata = JSON.parse(await readFile(`${reviewRunDir}run-metadata.json`, "utf-8"));
    reviewCandidates = JSON.parse(await readFile(`${reviewRunDir}publication-candidates.json`, "utf-8"));
  } catch (e) {
    return { ok: false, errors: [`[レビュー資料] reviewRunId「${approval.reviewRunId}」の読込に失敗: ${e.message}`], validationReportLines };
  }

  if (reviewMetadata.sourceRunId !== metadata.runId) errors.push(`[レビュー資料] sourceRunIdが一致しません`);
  if (reviewMetadata.candidateSetHash !== metadata.candidateSetHash) errors.push(`[レビュー資料] candidateSetHashが一致しません`);
  if (reviewMetadata.keywordApprovedFileHash !== approval.keywordApprovedFileHash) {
    errors.push(`[レビュー資料] 商品公開承認ファイルのkeywordApprovedFileHashがレビュー資料と一致しません`);
  }
  if (Date.parse(approval.approvedAt) < Date.parse(reviewMetadata.executedAt)) {
    errors.push(`[レビュー資料] approvedAt(${approval.approvedAt})がレビュー資料生成日時(${reviewMetadata.executedAt})より前です`);
  }
  const recomputedReviewHash = computePublicationReviewHash(
    (reviewCandidates.pages ?? []).map((p) => ({ slug: p.slug, topCandidates: p.candidates }))
  );
  if (recomputedReviewHash !== reviewMetadata.reviewHash) {
    errors.push(`[レビュー資料] publicationReviewHashの再計算結果が記録値と一致しません(改変の可能性)`);
  }
  if (errors.length > 0) {
    return { ok: false, errors, validationReportLines, sourceRunId: metadata.runId, candidateSetHash: metadata.candidateSetHash, publicationApprovedFileHash: approvedFileHash };
  }
  validationReportLines.push(`レビュー資料: 検証OK(reviewRunId=${approval.reviewRunId}, publicationReviewHash一致)`);

  // --- 4. 楽天商品補完データ(段階B)との整合性 ---
  let enrichmentMetadata, enrichmentItems;
  try {
    enrichmentMetadata = JSON.parse(await readFile(`${enrichmentRunDir}/run-metadata.json`, "utf-8"));
    enrichmentItems = JSON.parse(await readFile(`${enrichmentRunDir}/enrichment-items.json`, "utf-8"));
  } catch (e) {
    return { ok: false, errors: [`[補完データ] 読込に失敗: ${e.message}`], validationReportLines };
  }
  if (enrichmentMetadata.sourceRunId !== metadata.runId) errors.push(`[補完データ] sourceRunIdが一致しません`);
  if (enrichmentMetadata.candidateSetHash !== metadata.candidateSetHash) errors.push(`[補完データ] candidateSetHashが一致しません`);
  if (enrichmentMetadata.publicationApprovedFileHash !== approvedFileHash) {
    errors.push(`[補完データ] 補完データが参照しているpublicationApprovedFileHashが現在の承認ファイルと一致しません`);
  }
  if (enrichmentMetadata.rakutenSource !== "live") {
    errors.push(`[補完データ] rakutenSourceがliveではありません(fixture混入は許可しません)`);
  }
  const actualEnrichmentArtifactHash = await sha256File(`${enrichmentRunDir}/enrichment-items.json`);
  const recordedEnrichmentArtifactHash = enrichmentMetadata.artifactHashes?.["enrichment-items.json"];
  if (actualEnrichmentArtifactHash !== recordedEnrichmentArtifactHash) {
    errors.push(`[補完データ] enrichmentArtifactHashが記録値と一致しません(改変の可能性)`);
  }
  if (errors.length > 0) {
    return { ok: false, errors, validationReportLines, sourceRunId: metadata.runId, candidateSetHash: metadata.candidateSetHash, publicationApprovedFileHash: approvedFileHash };
  }
  validationReportLines.push(`補完データ: 検証OK(enrichmentRunId=${enrichmentMetadata.runId}, artifactHash一致)`);

  // --- 5. ページごとの最終組み立て(全ゲートの再検証、1件でも失敗すれば全件拒否) ---
  const pageResults = [];
  for (const page of approval.pages) {
    const pageErrors = [];
    const pageConfig = PUBLICATION_PAGE_REQUIREMENTS[page.slug];
    if (!pageConfig) {
      errors.push(`[${page.slug}] Phase 3B対象ページとして定義されていません`);
      continue;
    }
    const candidate = candidatesByKeyword.get(page.normalizedKeyword);
    if (!candidate) {
      errors.push(`[${page.slug}] normalizedKeyword「${page.normalizedKeyword}」がsource run内に見つかりません`);
      continue;
    }
    const reviewPage = (reviewCandidates.pages ?? []).find((p) => p.slug === page.slug);
    if (!reviewPage) {
      errors.push(`[${page.slug}] レビュー資料に対応するページが見つかりません`);
      continue;
    }
    const reviewedItemCodes = new Set(reviewPage.candidates.map((c) => c.itemCode));
    const sourceItemsByCode = new Map((candidate.eligibleItems ?? []).map((i) => [i.itemCode, i]));
    const enrichedItemsByCode = new Map((enrichmentItems[page.slug] ?? []).map((i) => [i.itemCode, i]));

    const finalItems = [];
    for (const product of page.products) {
      const sourceItem = sourceItemsByCode.get(product.itemCode);
      if (!sourceItem) {
        pageErrors.push(`itemCode「${product.itemCode}」がsource runに存在しません`);
        continue;
      }
      if (!reviewedItemCodes.has(product.itemCode)) {
        pageErrors.push(`itemCode「${product.itemCode}」がレビュー資料に存在しません`);
        continue;
      }
      const enrichedItem = enrichedItemsByCode.get(product.itemCode);
      if (!enrichedItem) {
        pageErrors.push(`itemCode「${product.itemCode}」が楽天最新結果(補完データ)に存在しません`);
        continue;
      }

      // 【2026-09-08 在庫ゲート・多層防御】段階B(enrich-publication-products)の判定結果を
      // そのまま信用せず、enrichment-items.json自体のavailabilityを独立して再検証する。
      // enrichmentArtifactHashの一致だけでは、そもそもavailabilityフィールドを持たない
      // 古い形式の成果物(この在庫ゲート導入前に生成されたenrichment run)を検出できない
      // ため、ここで明示的にチェックする(欠損・0・不正な値はすべて非公開扱い)。
      // 人間承認済み(product.humanApproved=true)であっても在庫ゲートは回避できない。
      if (!isAvailableEnrichedItem(enrichedItem)) {
        pageErrors.push(`itemCode「${product.itemCode}」: 在庫が確認できません(availability再検証NG、公開候補から除外)`);
        continue;
      }

      // 最終ゲート(defense in depth): 承認時点からデータが変わっていないか再検証する。
      const relevance = evaluateProductRelevance({ requiredAttributes: pageConfig.requiredAttributes, itemName: sourceItem.itemName, catchcopy: sourceItem.catchcopy });
      if (relevance.status !== "RELEVANT") {
        pageErrors.push(`itemCode「${product.itemCode}」: 商品関連性ゲートを満たしません(${relevance.reasonCodes.join(",")})`);
        continue;
      }
      const { safetyStatus } = classifySafety(`${sourceItem.itemName ?? ""} ${sourceItem.catchcopy ?? ""}`, safetyConfig);
      if (safetyStatus !== "SAFE") {
        pageErrors.push(`itemCode「${product.itemCode}」: 医療・健康安全性ゲートを満たしません(${safetyStatus})`);
        continue;
      }

      // 【重要】selectionType(confirmed/selectable)は、既存のneedsFlavorSelectionNote()
      // (itemNameから機械的に判定、既存の多層防御ロジック)をそのまま再利用する。
      // これは承認時点(レビュー段階)でも同じ関数・同じsourceItem.itemNameから算出される値であり、
      // source run自体が変わっていないことはcandidateSetHash一致で既に保証されているため、
      // 新たに別の(信頼度の異なる)フィールドを追加せず、既存の単一の判定結果を
      // 表示順位の決定にも安全に転用できる。
      const flavorNoteRequired = needsFlavorSelectionNote(sourceItem.itemName);
      const displayNote = flavorNoteRequired ? FLAVOR_SELECTION_NOTE_TEXT : (typeof product.displayNote === "string" && product.displayNote.trim() !== "" ? product.displayNote.trim() : null);

      // 【2026-10-05 検索流入テスト再構成対応】確認できる構造化属性のみ引き継ぐ
      // (未指定ならnullのまま。推測で埋めない)。
      const packageSize = typeof product.packageSize === "string" && product.packageSize.trim() !== "" ? product.packageSize.trim() : null;
      const targetAge = typeof product.targetAge === "string" && product.targetAge.trim() !== "" ? product.targetAge.trim() : null;
      const mainIngredient = typeof product.mainIngredient === "string" && product.mainIngredient.trim() !== "" ? product.mainIngredient.trim() : null;
      const productFormat = typeof product.productFormat === "string" && product.productFormat.trim() !== "" ? product.productFormat.trim() : null;

      finalItems.push({
        itemCode: product.itemCode,
        displayName: product.displayName,
        displayNote,
        imageUrl: enrichedItem.imageUrl,
        itemPrice: enrichedItem.itemPrice,
        reviewAverage: enrichedItem.reviewAverage,
        reviewCount: enrichedItem.reviewCount,
        affiliateUrl: enrichedItem.affiliateUrl,
        shopName: enrichedItem.shopName,
        selectionType: flavorNoteRequired ? "selectable" : "confirmed",
        packageSize,
        targetAge,
        mainIngredient,
        productFormat,
        pricePerUnitLabel: computePricePerUnitLabel(packageSize, enrichedItem.itemPrice),
        qualityScore: sourceItem.qualityScore, // 内部ソート専用、HTMLには出力しない
        _sourceItemName: sourceItem.itemName, // 内部の類似度判定専用、HTMLには出力しない
      });
    }

    if (pageErrors.length > 0) {
      for (const e of pageErrors) errors.push(`[${page.slug}] ${e}`);
      continue;
    }

    if (finalItems.length < MIN_PRODUCTS_PER_PAGE || finalItems.length > MAX_PRODUCTS_PER_PAGE) {
      errors.push(`[${page.slug}] 有効商品数が${finalItems.length}件です(${MIN_PRODUCTS_PER_PAGE}〜${MAX_PRODUCTS_PER_PAGE}件である必要があります)`);
      continue;
    }

    // 【2026-09-08 表示順位改善】商品自体の内容が確定している商品(confirmed)を、
    // 購入時にタイプ選択が必要な商品(selectable)より先に表示する。
    // 【2026-10-05 表示順の客観性対応】同じ区分内の並び順は、非公開のQuality Score
    // (内部指標)ではなく、ページ上にも開示しているレビュー件数の降順にする
    // (「何を基準に並べているか」を読者が確認できる状態にする。恣意的な
    // おすすめ順を作らないため)。
    finalItems.sort((a, b) => {
      if (a.selectionType !== b.selectionType) {
        return a.selectionType === "confirmed" ? -1 : 1;
      }
      return (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
    });

    const diversity = evaluateShopDiversity(finalItems.map((i) => ({ itemCode: i.itemCode, shopName: i.shopName })));
    if (diversity.exceedsMaxPerShop) {
      errors.push(`[${page.slug}] 同一店舗の商品数が上限を超えています(${diversity.overLimitShops.join(", ")})`);
    }
    if (!diversity.meetsMinDistinctShops) {
      errors.push(`[${page.slug}] 異なる店舗数が最低基準未満です(実際: ${diversity.distinctShopCount}店舗)`);
    }
    if (hasExcessiveSameSeriesGroup(finalItems.map((i) => ({ itemCode: i.itemCode, itemName: i._sourceItemName })))) {
      errors.push(`[${page.slug}] 同一シリーズとみなせる商品が3件以上含まれています`);
    }
    if (errors.some((e) => e.startsWith(`[${page.slug}]`))) continue;

    pageResults.push({
      slug: page.slug,
      title: page.title,
      introText: typeof page.introText === "string" && page.introText.trim() !== "" ? page.introText.trim() : null,
      buyingGuideText: typeof page.buyingGuideText === "string" && page.buyingGuideText.trim() !== "" ? page.buyingGuideText.trim() : null,
      pageConfig,
      finalItems,
      enrichmentFetchedAt: enrichedItemsByCode.values().next().value?.fetchedAt,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors, validationReportLines, sourceRunId: metadata.runId, candidateSetHash: metadata.candidateSetHash, publicationApprovedFileHash: approvedFileHash };
  }

  // --- 6. 決定的なHTML生成 ---
  const drafts = pageResults.map((p) => {
    // 【2026-10-05 検索流入テスト再構成対応】そのページで実際に1件以上値を持つ
    // 任意列だけを比較表に出す(確認できない項目は省略、推測で埋めない)。
    const comparisonColumns = OPTIONAL_COLUMN_DEFS.filter((col) => p.finalItems.some((item) => item[col.key] !== null && item[col.key] !== undefined));

    const html = renderPublicationPreviewHtml({
      title: p.title,
      introText: p.introText ?? buildIntroText(p.pageConfig.requiredAttributes),
      buyingGuideText: p.buyingGuideText ?? "",
      dataRetrievedAtJa: formatJaDate(p.enrichmentFetchedAt ?? enrichmentMetadata.executedAt),
      canonicalUrl: `${SITE_URL}/rankings/${p.slug}.html`,
      animalType: buildAnimalType(p.pageConfig.requiredAttributes),
      comparisonColumns,
      products: p.finalItems.map((item, idx) => ({
        rank: idx + 1,
        displayName: item.displayName,
        displayNote: item.displayNote,
        imageUrl: item.imageUrl,
        itemPrice: item.itemPrice,
        reviewAverage: item.reviewAverage,
        reviewCount: item.reviewCount,
        affiliateUrl: item.affiliateUrl,
        shopName: item.shopName,
        selectionType: item.selectionType,
        packageSize: item.packageSize,
        targetAge: item.targetAge,
        mainIngredient: item.mainIngredient,
        productFormat: item.productFormat,
        pricePerUnitLabel: item.pricePerUnitLabel,
        verifiedAttributeLabels: buildAttributeLabels(p.pageConfig.requiredAttributes),
      })),
    }, { isDraft, gaMeasurementId, allowSearchIndex, pageType });
    return { slug: p.slug, html };
  });

  validationReportLines.push(...pageResults.map((p) => `候補「${p.slug}」: OK(${p.finalItems.length}件)`));

  return {
    ok: true,
    errors: [],
    drafts,
    validationReportLines,
    sourceRunId: metadata.runId,
    candidateSetHash: metadata.candidateSetHash,
    publicationApprovedFileHash: approvedFileHash,
    enrichmentArtifactHash: actualEnrichmentArtifactHash,
    productCountBySlug: Object.fromEntries(pageResults.map((p) => [p.slug, p.finalItems.length])),
  };
}
