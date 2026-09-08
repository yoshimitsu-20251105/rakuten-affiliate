// 【2026-09-07 Phase 3B対応】楽天商品補完データの安全な取扱い(publication-enrichment.js)のテスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidImageUrl, isValidAffiliateUrl, isValidItemUrl, sanitizeEnrichedItem, ENRICHMENT_FIELD_ALLOWLIST } from "../publication-enrichment.js";

function validRawItem(overrides = {}) {
  return {
    itemCode: "shop:1",
    itemName: "テスト商品",
    catchcopy: "販売者のキャッチコピー",
    itemPrice: 3000,
    reviewAverage: 4.5,
    reviewCount: 100,
    itemUrl: "https://item.rakuten.co.jp/shop/1/",
    affiliateUrl: "https://hb.afl.rakuten.co.jp/hgc/abc/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fshop%2F1%2F",
    shopName: "テストショップ",
    mediumImageUrls: [{ imageUrl: "https://thumbnail.image.rakuten.co.jp/@0_mall/shop/cabinet/1.jpg" }],
    ...overrides,
  };
}

test("isValidImageUrl: 楽天公式の画像ホストはtrue", () => {
  assert.equal(isValidImageUrl("https://thumbnail.image.rakuten.co.jp/@0_mall/shop/cabinet/1.jpg"), true);
});

test("isValidImageUrl: httpは拒否する", () => {
  assert.equal(isValidImageUrl("http://thumbnail.image.rakuten.co.jp/@0_mall/shop/cabinet/1.jpg"), false);
});

test("isValidImageUrl: 許可外ホストは拒否する", () => {
  assert.equal(isValidImageUrl("https://evil.example.com/image.jpg"), false);
});

test("isValidImageUrl: javascript:スキームは拒否する", () => {
  assert.equal(isValidImageUrl("javascript:alert(1)"), false);
});

test("isValidImageUrl: data:スキームは拒否する", () => {
  assert.equal(isValidImageUrl("data:image/png;base64,AAAA"), false);
});

test("isValidAffiliateUrl: 楽天アフィリエイトホスト(hb.afl.rakuten.co.jp)はtrue", () => {
  assert.equal(isValidAffiliateUrl("https://hb.afl.rakuten.co.jp/hgc/abc/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fshop%2F1%2F"), true);
});

test("isValidAffiliateUrl: 楽天以外のホストは拒否する", () => {
  assert.equal(isValidAffiliateUrl("https://example.com/aff/1"), false);
});

test("isValidAffiliateUrl: 通常の商品URL(item.rakuten.co.jp)はアフィリエイトURLとして許可しない(フォールバック禁止)", () => {
  assert.equal(isValidAffiliateUrl("https://item.rakuten.co.jp/shop/1/"), false);
});

test("isValidItemUrl: item.rakuten.co.jpはtrue", () => {
  assert.equal(isValidItemUrl("https://item.rakuten.co.jp/shop/1/"), true);
});

// 【2026-09-08 修正】楽天公式仕様: affiliateId指定時、itemUrlはaffiliateUrlと
// 同じ値(hb.afl.rakuten.co.jp)で返る場合がある。これを正規URLとして許可する。
test("isValidItemUrl: hb.afl.rakuten.co.jp(アフィリエイト形式)もtrue", () => {
  assert.equal(isValidItemUrl("https://hb.afl.rakuten.co.jp/hgc/abc/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fshop%2F1%2F"), true);
});

test("isValidItemUrl: httpは拒否する", () => {
  assert.equal(isValidItemUrl("http://hb.afl.rakuten.co.jp/hgc/abc/"), false);
});

test("isValidItemUrl: 楽天以外のホストは拒否する", () => {
  assert.equal(isValidItemUrl("https://evil.example.com/shop/1/"), false);
});

test("isValidItemUrl: サブドメイン偽装(hb.afl.rakuten.co.jp.evil.example)は拒否する", () => {
  assert.equal(isValidItemUrl("https://hb.afl.rakuten.co.jp.evil.example/"), false);
});

test("isValidItemUrl: 後方一致偽装(evil-hb.afl.rakuten.co.jp)は拒否する", () => {
  assert.equal(isValidItemUrl("https://evil-hb.afl.rakuten.co.jp/"), false);
});

test("isValidItemUrl: クエリ文字列によるホスト偽装は拒否する", () => {
  assert.equal(isValidItemUrl("https://evil.example/?url=hb.afl.rakuten.co.jp"), false);
});

test("isValidItemUrl: username/password付きURLは拒否する", () => {
  assert.equal(isValidItemUrl("https://user@hb.afl.rakuten.co.jp/"), false);
  assert.equal(isValidItemUrl("https://user:pass@item.rakuten.co.jp/shop/1/"), false);
});

test("isValidItemUrl: 独自ポート指定は拒否する(デフォルトの443は許可)", () => {
  assert.equal(isValidItemUrl("https://item.rakuten.co.jp:8443/shop/1/"), false);
  assert.equal(isValidItemUrl("https://item.rakuten.co.jp:443/shop/1/"), true);
});

test("isValidItemUrl: javascript:スキームは拒否する", () => {
  assert.equal(isValidItemUrl("javascript:alert(1)"), false);
});

test("isValidItemUrl: data:スキームは拒否する", () => {
  assert.equal(isValidItemUrl("data:text/html,<script>alert(1)</script>"), false);
});

test("isValidItemUrl: 相対URLは拒否する", () => {
  assert.equal(isValidItemUrl("/shop/1/"), false);
});

test("isValidItemUrl: 解析不能なURLは拒否する", () => {
  assert.equal(isValidItemUrl("https://[invalid"), false);
});

test("isValidItemUrl: 空文字・null・undefinedは拒否する", () => {
  assert.equal(isValidItemUrl(""), false);
  assert.equal(isValidItemUrl(null), false);
  assert.equal(isValidItemUrl(undefined), false);
});

test("isValidAffiliateUrl: username/password付きURLは拒否する", () => {
  assert.equal(isValidAffiliateUrl("https://user@hb.afl.rakuten.co.jp/hgc/abc/"), false);
});

test("isValidAffiliateUrl: 独自ポート指定は拒否する", () => {
  assert.equal(isValidAffiliateUrl("https://hb.afl.rakuten.co.jp:8443/hgc/abc/"), false);
});

test("sanitizeEnrichedItem: affiliateId指定時、itemUrl===affiliateUrl(hb.afl.rakuten.co.jp)でも正常に通過する", () => {
  const sameAffiliateUrl = "https://hb.afl.rakuten.co.jp/hgc/abc/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fshop%2F1%2F";
  const { ok, item, errors } = sanitizeEnrichedItem(validRawItem({ itemUrl: sameAffiliateUrl, affiliateUrl: sameAffiliateUrl }), {
    sourceRunId: "run-1",
    publicationApprovedFileHash: "hash-1",
    fetchedAt: "2026-09-08T00:00:00.000Z",
  });
  assert.equal(ok, true, errors.join(", "));
  assert.equal(item.itemUrl, sameAffiliateUrl);
  assert.equal(item.affiliateUrl, sameAffiliateUrl);
});

test("sanitizeEnrichedItem: 正常なAPIレスポンスはallowlistの項目だけを抽出して成功する", () => {
  const { ok, item, errors } = sanitizeEnrichedItem(validRawItem(), {
    sourceRunId: "run-1",
    publicationApprovedFileHash: "hash-1",
    fetchedAt: "2026-09-07T12:00:00.000Z",
  });
  assert.equal(ok, true, errors.join(", "));
  assert.deepEqual(Object.keys(item).sort(), [...ENRICHMENT_FIELD_ALLOWLIST].sort());
  assert.equal(item.itemCode, "shop:1");
  assert.equal(item.imageUrl, "https://thumbnail.image.rakuten.co.jp/@0_mall/shop/cabinet/1.jpg");
});

test("sanitizeEnrichedItem: APIレスポンス全文・itemCaption・認証情報は保存しない(allowlist外のキーが結果に含まれない)", () => {
  const { item } = sanitizeEnrichedItem(
    validRawItem({ itemCaption: "非常に長いseller文言...", applicationId: "secret-app-id", accessKey: "secret-key" }),
    { sourceRunId: "run-1", publicationApprovedFileHash: "hash-1", fetchedAt: "2026-09-07T12:00:00.000Z" }
  );
  assert.equal(Object.prototype.hasOwnProperty.call(item, "itemCaption"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(item, "applicationId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(item, "accessKey"), false);
});

test("sanitizeEnrichedItem: affiliateUrlが欠損している場合はfail closed(itemUrlへフォールバックしない)", () => {
  const { ok, item, errors } = sanitizeEnrichedItem(validRawItem({ affiliateUrl: undefined }), {
    sourceRunId: "run-1",
    publicationApprovedFileHash: "hash-1",
    fetchedAt: "2026-09-07T12:00:00.000Z",
  });
  assert.equal(ok, false);
  assert.equal(item, null);
  assert.match(errors.join(""), /affiliateUrl/);
});

test("sanitizeEnrichedItem: affiliateUrlが不正なホストの場合も拒否する", () => {
  const { ok, errors } = sanitizeEnrichedItem(validRawItem({ affiliateUrl: "https://evil.example.com/aff" }), {
    sourceRunId: "run-1",
    publicationApprovedFileHash: "hash-1",
    fetchedAt: "2026-09-07T12:00:00.000Z",
  });
  assert.equal(ok, false);
  assert.match(errors.join(""), /affiliateUrl/);
});

test("sanitizeEnrichedItem: 商品画像URLが欠損している場合は拒否する", () => {
  const { ok, errors } = sanitizeEnrichedItem(validRawItem({ mediumImageUrls: [] }), {
    sourceRunId: "run-1",
    publicationApprovedFileHash: "hash-1",
    fetchedAt: "2026-09-07T12:00:00.000Z",
  });
  assert.equal(ok, false);
  assert.match(errors.join(""), /画像/);
});

test("sanitizeEnrichedItem: 商品画像URLが不正なホストの場合は拒否する", () => {
  const { ok, errors } = sanitizeEnrichedItem(validRawItem({ mediumImageUrls: [{ imageUrl: "https://evil.example.com/1.jpg" }] }), {
    sourceRunId: "run-1",
    publicationApprovedFileHash: "hash-1",
    fetchedAt: "2026-09-07T12:00:00.000Z",
  });
  assert.equal(ok, false);
  assert.match(errors.join(""), /画像/);
});

test("sanitizeEnrichedItem: itemUrlが欠損・不正な場合は拒否する", () => {
  const { ok, errors } = sanitizeEnrichedItem(validRawItem({ itemUrl: "javascript:alert(1)" }), {
    sourceRunId: "run-1",
    publicationApprovedFileHash: "hash-1",
    fetchedAt: "2026-09-07T12:00:00.000Z",
  });
  assert.equal(ok, false);
  assert.match(errors.join(""), /itemUrl/);
});

test("sanitizeEnrichedItem: itemCodeが欠損している場合は拒否する", () => {
  const { ok, errors } = sanitizeEnrichedItem(validRawItem({ itemCode: undefined }), {
    sourceRunId: "run-1",
    publicationApprovedFileHash: "hash-1",
    fetchedAt: "2026-09-07T12:00:00.000Z",
  });
  assert.equal(ok, false);
  assert.match(errors.join(""), /itemCode/);
});
