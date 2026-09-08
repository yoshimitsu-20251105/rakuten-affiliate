// 【2026-09-07 Phase 3B対応】限定的な楽天商品補完のオーケストレーション
// (publication-enrichment-run.js)のテスト。実際のsearchRakutenItemsLiveは一切呼ばず、
// mockのsearchFnだけを注入する(live APIを呼ばないことをこのテストファイル自体で保証する)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runPublicationEnrichment } from "../publication-enrichment-run.js";
import {
  createOutputRoot,
  buildFixtureSourceRun,
  buildFixtureKeywordApprovalFile,
  buildFixturePublicationApprovalFile,
  buildFixtureReviewRun,
  approvedProduct,
  DOG_SLUG,
  CAT_SLUG,
  DOG_KEYWORD,
  CAT_KEYWORD,
} from "./helpers/phase3b-fixtures.js";

async function fileHash(filePath) {
  return createHash("sha256").update(await readFile(filePath, "utf-8"), "utf-8").digest("hex");
}

async function setupFixtures(overrides = {}) {
  const outputRoot = await createOutputRoot();
  const sourceRun = await buildFixtureSourceRun(outputRoot, overrides.sourceRun);
  const { filePath: keywordApprovalPath } = await buildFixtureKeywordApprovalFile(outputRoot, sourceRun);
  const keywordApprovedFileHash = await fileHash(keywordApprovalPath);

  const dogCandidates = ["shop:d1", "shop:d2", "shop:d3"].map((c) => ({ itemCode: c, itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: `S-${c}`, qualityScore: 80, verifiedAttributes: [], needsFlavorSelectionNote: false }));
  const catCandidates = ["shop:c1", "shop:c2", "shop:c3"].map((c) => ({ itemCode: c, itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: `S-${c}`, qualityScore: 80, verifiedAttributes: [], needsFlavorSelectionNote: false }));
  const reviewRun = await buildFixtureReviewRun(outputRoot, sourceRun, keywordApprovedFileHash, { dogCandidates, catCandidates });

  const dogProducts = ["shop:d1", "shop:d2", "shop:d3"].map((c) => approvedProduct(c));
  const catProducts = ["shop:c1", "shop:c2", "shop:c3"].map((c) => approvedProduct(c));
  const { filePath: pubApprovalPath } = await buildFixturePublicationApprovalFile(outputRoot, sourceRun, keywordApprovedFileHash, reviewRun, { dogProducts, catProducts, ...overrides.approval });
  return { outputRoot, sourceRun, pubApprovalPath };
}

function liveApiItem(itemCode, overrides = {}) {
  return {
    itemCode,
    itemName: `テスト商品${itemCode}`,
    itemPrice: 2980,
    reviewAverage: 4.6,
    reviewCount: 50,
    itemUrl: `https://item.rakuten.co.jp/shop/${itemCode}/`,
    affiliateUrl: `https://hb.afl.rakuten.co.jp/hgc/abc/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fshop%2F${itemCode}%2F`,
    shopName: `LiveShop-${itemCode}`,
    mediumImageUrls: [{ imageUrl: "https://thumbnail.image.rakuten.co.jp/@0_mall/shop/cabinet/1.jpg" }],
    ...overrides,
  };
}

async function cleanup(outputRoot) {
  await rm(outputRoot, { recursive: true, force: true });
}

test("runPublicationEnrichment: 承認済み全itemCodeが見つかれば成功する(1キーワード1検索)", async () => {
  const { outputRoot, sourceRun, pubApprovalPath } = await setupFixtures();
  let callCount = 0;
  const calledQueries = [];
  const searchFn = async (query) => {
    callCount++;
    calledQueries.push(query);
    if (query === DOG_KEYWORD) {
      return { items: ["shop:d1", "shop:d2", "shop:d3"].map((c) => liveApiItem(c)), count: 3, source: "live" };
    }
    if (query === CAT_KEYWORD) {
      return { items: ["shop:c1", "shop:c2", "shop:c3"].map((c) => liveApiItem(c)), count: 3, source: "live" };
    }
    return { items: [], count: 0, source: "live" };
  };
  try {
    const result = await runPublicationEnrichment({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, searchFn });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(callCount, 2, "1キーワードにつき1回、合計2回であること");
    assert.equal(result.logicalRakutenQueryCount, 2);
    assert.equal(result.apiErrorCount, 0);
    assert.equal(result.pages.find((p) => p.slug === DOG_SLUG).items.length, 3);
    assert.equal(result.pages.find((p) => p.slug === CAT_SLUG).items.length, 3);
  } finally {
    await cleanup(outputRoot);
  }
});

test("runPublicationEnrichment: fixtureソースの結果はfixture混入として拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath } = await setupFixtures();
  const searchFn = async () => ({ items: [], count: 0, source: "fixture" });
  try {
    const result = await runPublicationEnrichment({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, searchFn });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /fixture/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("runPublicationEnrichment: 承認済みitemCodeが最新結果に見つからない場合はその商品を掲載せず、残数不足ならページを拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath } = await setupFixtures();
  const searchFn = async (query) => {
    if (query === DOG_KEYWORD) {
      // shop:d1のみ見つかる(2件不足)
      return { items: [liveApiItem("shop:d1")], count: 1, source: "live" };
    }
    return { items: ["shop:c1", "shop:c2", "shop:c3"].map((c) => liveApiItem(c)), count: 3, source: "live" };
  };
  try {
    const result = await runPublicationEnrichment({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, searchFn });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /最低基準/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("runPublicationEnrichment: 検索関数が例外を投げた場合はAPI_ERRORとして扱い全件拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath } = await setupFixtures();
  const searchFn = async (query) => {
    if (query === DOG_KEYWORD) throw new Error("楽天APIエラー: HTTP 500");
    return { items: ["shop:c1", "shop:c2", "shop:c3"].map((c) => liveApiItem(c)), count: 3, source: "live" };
  };
  try {
    const result = await runPublicationEnrichment({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, searchFn });
    assert.equal(result.ok, false);
    assert.equal(result.apiErrorCount, 1);
    assert.match(result.errors.join(""), /APIエラー/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("runPublicationEnrichment: 画像・affiliateUrlが不正な商品は掲載しない(allowlist違反)", async () => {
  const { outputRoot, sourceRun, pubApprovalPath } = await setupFixtures();
  const searchFn = async (query) => {
    if (query === DOG_KEYWORD) {
      return {
        items: [
          liveApiItem("shop:d1", { affiliateUrl: "https://evil.example.com/aff" }), // 不正
          liveApiItem("shop:d2"),
          liveApiItem("shop:d3"),
        ],
        count: 3,
        source: "live",
      };
    }
    return { items: ["shop:c1", "shop:c2", "shop:c3"].map((c) => liveApiItem(c)), count: 3, source: "live" };
  };
  try {
    const result = await runPublicationEnrichment({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, searchFn });
    // shop:d1が不正で除外され、残り2件(最低基準3件未満)のためページ拒否
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /最低基準/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("runPublicationEnrichment: sourceRunId/candidateSetHashが承認ファイルと不一致なら拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath } = await setupFixtures();
  // 別のsource run(異なるrunId)を用意してミスマッチを作る
  const otherOutputRoot = await createOutputRoot();
  const otherSourceRun = await buildFixtureSourceRun(otherOutputRoot, { runId: "different-run-id" });
  const searchFn = async () => ({ items: [], count: 0, source: "live" });
  try {
    const result = await runPublicationEnrichment({ sourceRunDir: otherSourceRun.dir, publicationApprovedFilePath: pubApprovalPath, searchFn });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /sourceRunId|candidateSetHash/);
  } finally {
    await cleanup(outputRoot);
    await cleanup(otherOutputRoot);
  }
});
