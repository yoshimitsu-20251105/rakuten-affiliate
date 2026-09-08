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
// 楽天公式仕様(https://webservice.rakuten.co.jp/documentation/ichiba-item-search):
// affiliateId指定時、itemUrlはaffiliateUrlと同じ値(hb.afl.rakuten.co.jp)で返る場合がある。
// そのためitemUrlは通常の商品ページ(item.rakuten.co.jp)とアフィリエイト形式(hb.afl.rakuten.co.jp)の
// 両方を正規ホストとして許可する。affiliateUrl側は引き続きhb.afl.rakuten.co.jpのみ。
const ALLOWED_ITEM_URL_HOSTS = ["item.rakuten.co.jp", "hb.afl.rakuten.co.jp"];

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
  "availability",
  "fetchedAt",
  "sourceRunId",
  "publicationApprovedFileHash",
];

function parseUrlSafely(url) {
  if (typeof url !== "string" || url === "") return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isHttpsUrl(url) {
  const parsed = parseUrlSafely(url);
  return parsed !== null && parsed.protocol === "https:";
}

// hostnameの完全一致に加え、username/password付きURL(https://user@host/)と
// 独自ポート指定(デフォルトの443は正規化されるため対象外)を拒否する。
// 部分一致・後方一致(host.evil.example, evil.host等)はhostnameの完全一致判定により防止される。
function hasAllowedHost(url, allowedHosts) {
  const parsed = parseUrlSafely(url);
  if (parsed === null) return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (parsed.port !== "") return false;
  return allowedHosts.includes(parsed.hostname);
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

// 【2026-09-08 在庫ゲート対応】楽天IchibaItem/Search APIのavailability(0または1)だけを
// 厳格に判定する。文字列("1")・真偽値(true)・小数・欠損/null/undefinedはすべて
// 「在庫不明」として扱い、曖昧な型変換は行わない(=== による厳密比較のみ)。
// - AVAILABLE: availability===1(販売可能)
// - OUT_OF_STOCK: availability===0(在庫切れ、明示的に確認できた除外理由)
// - AVAILABILITY_NOT_CONFIRMED: 上記以外すべて(欠損・null・不正型・0/1以外の値)
/** @param {any} rawApiItem @returns {"AVAILABLE"|"OUT_OF_STOCK"|"AVAILABILITY_NOT_CONFIRMED"} */
export function classifyAvailability(rawApiItem) {
  const value = rawApiItem?.availability;
  if (value === 1) return "AVAILABLE";
  if (value === 0) return "OUT_OF_STOCK";
  return "AVAILABILITY_NOT_CONFIRMED";
}

// sanitize済み(allowlist抽出後)の補完データに対する在庫再検証専用ヘルパー。
// 段階C(build-publication-preview)がenrichment-items.jsonを独立して再検証する際に使う
// (多層防御: 段階Bの判定結果をそのまま信用せず、成果物が改変・古い形式で
// availabilityが欠損している場合も安全側に倒して除外する)。
/** @param {any} item @returns {boolean} */
export function isAvailableEnrichedItem(item) {
  return item?.availability === 1;
}

/**
 * 楽天APIの生レスポンス1商品分から、allowlistの項目だけを安全に抽出する。
 * 画像URL・affiliateUrl・itemUrlはいずれもhttps + 許可ホストのみ受け入れる。
 * affiliateUrlが取得できない場合はfail closed(通常の商品URLへフォールバックしない)。
 * @param {any} rawApiItem - 楽天IchibaItem/Search APIのItem1件分
 * @param {{ sourceRunId: string, publicationApprovedFileHash: string, fetchedAt: string }} context
 * @returns {{ ok: boolean, item: any|null, errors: string[], reasonCode: string|null }}
 */
export function sanitizeEnrichedItem(rawApiItem, { sourceRunId, publicationApprovedFileHash, fetchedAt }) {
  const errors = [];
  let reasonCode = null;

  const availabilityStatus = classifyAvailability(rawApiItem);
  if (availabilityStatus !== "AVAILABLE") {
    errors.push(`availabilityが${availabilityStatus}のため除外します(在庫なし・在庫不明の商品は公開候補にできません)`);
    reasonCode = availabilityStatus;
  }

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
    return { ok: false, item: null, errors, reasonCode: reasonCode ?? "VALIDATION_FAILED" };
  }

  return {
    ok: true,
    errors: [],
    reasonCode: null,
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
      availability: 1,
      fetchedAt,
      sourceRunId,
      publicationApprovedFileHash,
    },
  };
}
