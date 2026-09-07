// Phase 3B(公開前商品レビュー・収益化プレビュー)専用: 楽天商品補完データの安全な取扱い(2026-09-07対応)。
//
// keywords:enrich-publication-products(限定的な楽天商品補完CLI)と
// keywords:build-publication-preview(公開前プレビュー生成CLI)の両方から使う共通ロジック。
// 「保存してよい項目」をallowlist方式で明示し、画像URL・affiliateUrlは楽天公式の
// httpsホストだけを許可する(不正なホスト・javascript:・data:等は拒否)。
// affiliateUrlが取得できない場合、通常の商品URLへ勝手にフォールバックして
// 「アフィリエイトリンク」と表示することはしない(収益化ページとしてfail closed)。

const ALLOWED_IMAGE_HOSTS = ["thumbnail.image.rakuten.co.jp", "image.rakuten.co.jp"];
const ALLOWED_AFFILIATE_HOSTS = ["hb.afl.rakuten.co.jp"];
const ALLOWED_ITEM_URL_HOSTS = ["item.rakuten.co.jp"];

// 補完データとして保存してよい項目のallowlist(2026-09-07 Phase 3B対応)。
// APIレスポンス全文・認証情報・HTTPヘッダー・itemCaption全文は含めない。
export const ENRICHMENT_FIELD_ALLOWLIST = [
  "itemCode",
  "itemName",
  "itemPrice",
  "reviewAverage",
  "reviewCount",
  "itemUrl",
  "affiliateUrl",
  "shopName",
  "imageUrl",
  "fetchedAt",
  "sourceRunId",
  "publicationApprovedFileHash",
];

function parseUrlSafely(url) {
  try {
    return new URL(String(url));
  } catch {
    return null;
  }
}

function isHttpsUrl(url) {
  const parsed = parseUrlSafely(url);
  return parsed !== null && parsed.protocol === "https:";
}

function hasAllowedHost(url, allowedHosts) {
  const parsed = parseUrlSafely(url);
  return parsed !== null && allowedHosts.includes(parsed.hostname);
}

/** @param {any} url @returns {boolean} */
export function isValidImageUrl(url) {
  return isHttpsUrl(url) && hasAllowedHost(url, ALLOWED_IMAGE_HOSTS);
}

/** @param {any} url @returns {boolean} */
export function isValidAffiliateUrl(url) {
  return isHttpsUrl(url) && hasAllowedHost(url, ALLOWED_AFFILIATE_HOSTS);
}

/** @param {any} url @returns {boolean} */
export function isValidItemUrl(url) {
  return isHttpsUrl(url) && hasAllowedHost(url, ALLOWED_ITEM_URL_HOSTS);
}

/**
 * 楽天APIの生レスポンス1商品分から、allowlistの項目だけを安全に抽出する。
 * 画像URL・affiliateUrl・itemUrlはいずれもhttps + 許可ホストのみ受け入れる。
 * affiliateUrlが取得できない場合はfail closed(通常の商品URLへフォールバックしない)。
 * @param {any} rawApiItem - 楽天IchibaItem/Search APIのItem1件分
 * @param {{ sourceRunId: string, publicationApprovedFileHash: string, fetchedAt: string }} context
 * @returns {{ ok: boolean, item: any|null, errors: string[] }}
 */
export function sanitizeEnrichedItem(rawApiItem, { sourceRunId, publicationApprovedFileHash, fetchedAt }) {
  const errors = [];

  const itemCode = typeof rawApiItem?.itemCode === "string" && rawApiItem.itemCode !== "" ? rawApiItem.itemCode : null;
  if (!itemCode) errors.push("itemCodeが取得できません");

  const itemName = typeof rawApiItem?.itemName === "string" ? rawApiItem.itemName : null;

  const itemPrice = typeof rawApiItem?.itemPrice === "number" ? rawApiItem.itemPrice : Number(rawApiItem?.itemPrice);
  const validItemPrice = Number.isFinite(itemPrice) && itemPrice >= 0 ? itemPrice : null;

  const reviewAverage = Number(rawApiItem?.reviewAverage);
  const validReviewAverage = Number.isFinite(reviewAverage) && reviewAverage >= 0 && reviewAverage <= 5 ? reviewAverage : null;

  const reviewCount = Number(rawApiItem?.reviewCount);
  const validReviewCount = Number.isInteger(reviewCount) && reviewCount >= 0 ? reviewCount : null;

  const shopName = typeof rawApiItem?.shopName === "string" ? rawApiItem.shopName : null;

  const itemUrl = rawApiItem?.itemUrl;
  if (!isValidItemUrl(itemUrl)) {
    errors.push(`itemUrlが欠損、またはhttps・許可ホスト(${ALLOWED_ITEM_URL_HOSTS.join(",")})以外です`);
  }

  const affiliateUrl = rawApiItem?.affiliateUrl;
  if (!isValidAffiliateUrl(affiliateUrl)) {
    errors.push(
      `affiliateUrlが欠損、またはhttps・許可ホスト(${ALLOWED_AFFILIATE_HOSTS.join(",")})以外です` +
        `(fail closed: 通常の商品URLへは自動フォールバックしません)`
    );
  }

  const rawImageCandidates = Array.isArray(rawApiItem?.mediumImageUrls)
    ? rawApiItem.mediumImageUrls.map((x) => (typeof x === "string" ? x : x?.imageUrl)).filter(Boolean)
    : [];
  const imageUrl = rawImageCandidates.find(isValidImageUrl) ?? null;
  if (!imageUrl) {
    errors.push(`商品画像URLが欠損、またはhttps・許可ホスト(${ALLOWED_IMAGE_HOSTS.join(",")})以外です`);
  }

  if (errors.length > 0) {
    return { ok: false, item: null, errors };
  }

  return {
    ok: true,
    errors: [],
    item: {
      itemCode,
      itemName,
      itemPrice: validItemPrice,
      reviewAverage: validReviewAverage,
      reviewCount: validReviewCount,
      itemUrl,
      affiliateUrl,
      shopName,
      imageUrl,
      fetchedAt,
      sourceRunId,
      publicationApprovedFileHash,
    },
  };
}
