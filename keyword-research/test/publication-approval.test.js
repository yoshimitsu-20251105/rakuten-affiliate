// 【2026-09-07 Phase 3B対応】商品公開承認ファイルのスキーマ検証(publication-approval.js)のテスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPublicationApprovalFile } from "../publication-approval.js";

function validProduct(itemCode, overrides = {}) {
  return { itemCode, displayName: `テスト商品${itemCode}`, displayNote: null, humanApproved: true, ...overrides };
}

function validApproval(overrides = {}) {
  return {
    schemaVersion: 1,
    sourceRunId: "phase3a-live-2026-09-07-01",
    candidateSetHash: "abc123",
    keywordApprovedFileHash: "def456",
    reviewRunId: "phase3b-review-2026-09-07-01",
    approvedAt: new Date(Date.now() - 60_000).toISOString(),
    reviewedBy: "yoshimitsu",
    humanApproved: true,
    pages: [
      {
        normalizedKeyword: "シニア 犬 豚肉",
        slug: "senior-dog-pork",
        title: "シニア犬向け豚肉ドッグフードおすすめランキング比較",
        requiredAttributes: ["species:dog", "lifeStage:senior", "productType:staple", "ingredient:pork"],
        products: [validProduct("shop:1"), validProduct("shop:2"), validProduct("shop:3")],
      },
    ],
    ...overrides,
  };
}

async function withApprovalFile(content, fn) {
  const dir = await mkdtemp(join(tmpdir(), "pub-approval-"));
  const filePath = join(dir, "publication-approval.json");
  await writeFile(filePath, typeof content === "string" ? content : JSON.stringify(content), "utf-8");
  try {
    return await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("正しい商品公開承認ファイルは検証を通過する", async () => {
  await withApprovalFile(validApproval(), async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, true, result.errors.join(", "));
    assert.equal(result.approval.pages[0].products.length, 3);
    assert.ok(result.approvedFileHash);
  });
});

test("schemaVersionが1以外はエラーになる", async () => {
  await withApprovalFile(validApproval({ schemaVersion: 2 }), async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /schemaVersion/);
  });
});

test("【humanApproved=falseを拒否】トップレベルのhumanApprovedがfalseの場合はエラーになる", async () => {
  await withApprovalFile(validApproval({ humanApproved: false }), async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /humanApproved/);
  });
});

test("【humanApproved=falseを拒否】商品単位のhumanApprovedがfalseの場合はエラーになる", async () => {
  const approval = validApproval();
  approval.pages[0].products[0].humanApproved = false;
  await withApprovalFile(approval, async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /humanApproved/);
  });
});

test("【itemCode重複を拒否】ページ内でitemCodeが重複している場合はエラーになる", async () => {
  const approval = validApproval();
  approval.pages[0].products = [validProduct("shop:1"), validProduct("shop:1"), validProduct("shop:2")];
  await withApprovalFile(approval, async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /重複/);
  });
});

test("【3件未満・6件以上を拒否】商品が2件だとエラーになる", async () => {
  const approval = validApproval();
  approval.pages[0].products = [validProduct("shop:1"), validProduct("shop:2")];
  await withApprovalFile(approval, async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /3〜5件/);
  });
});

test("【3件未満・6件以上を拒否】商品が6件だとエラーになる", async () => {
  const approval = validApproval();
  approval.pages[0].products = [1, 2, 3, 4, 5, 6].map((i) => validProduct(`shop:${i}`));
  await withApprovalFile(approval, async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /3〜5件/);
  });
});

test("商品が5件はちょうど上限で成功する", async () => {
  const approval = validApproval();
  approval.pages[0].products = [1, 2, 3, 4, 5].map((i) => validProduct(`shop:${i}`));
  await withApprovalFile(approval, async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, true, result.errors.join(", "));
  });
});

test("displayNameが空文字はエラーになる", async () => {
  const approval = validApproval();
  approval.pages[0].products[0].displayName = "   ";
  await withApprovalFile(approval, async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /displayName/);
  });
});

test("displayNameが120文字を超えるとエラーになる", async () => {
  const approval = validApproval();
  approval.pages[0].products[0].displayName = "あ".repeat(121);
  await withApprovalFile(approval, async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /120文字/);
  });
});

test("displayNameがちょうど120文字は成功する", async () => {
  const approval = validApproval();
  approval.pages[0].products[0].displayName = "あ".repeat(120);
  await withApprovalFile(approval, async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, true, result.errors.join(", "));
  });
});

test("【医療効果断定表現を拒否】displayNameに医療語彙が含まれる場合はエラーになる", async () => {
  const approval = validApproval();
  approval.pages[0].products[0].displayName = "食べれば病気が治る豚肉ドッグフード";
  await withApprovalFile(approval, async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /医療・健康効果/);
  });
});

test("【医療効果断定表現を拒否】displayNoteに健康効果断定表現が含まれる場合はエラーになる", async () => {
  const approval = validApproval();
  approval.pages[0].products[0].displayNote = "ダイエット効果で体重管理もばっちり";
  await withApprovalFile(approval, async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /医療・健康効果/);
  });
});

test("displayNameのHTML特殊文字自体は検証段階ではエラーにしない(表示時にエスケープする責務はテンプレート側)", async () => {
  const approval = validApproval();
  approval.pages[0].products[0].displayName = '<script>alert("xss")</script>';
  await withApprovalFile(approval, async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, true, result.errors.join(", "));
  });
});

test("reviewedByが未指定の場合はエラーになる", async () => {
  await withApprovalFile(validApproval({ reviewedBy: "" }), async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /reviewedBy/);
  });
});

test("approvedAtが無効な場合はエラーになる", async () => {
  await withApprovalFile(validApproval({ approvedAt: "invalid-date" }), async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /approvedAt/);
  });
});

test("approvedAtが5分を超えて未来の場合はエラーになる", async () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await withApprovalFile(validApproval({ approvedAt: future }), async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /未来/);
  });
});

test("slugが不正な場合はエラーになる", async () => {
  const approval = validApproval();
  approval.pages[0].slug = "Invalid Slug!";
  await withApprovalFile(approval, async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /slug/);
  });
});

test("requiredAttributesが空配列の場合はエラーになる", async () => {
  const approval = validApproval();
  approval.pages[0].requiredAttributes = [];
  await withApprovalFile(approval, async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /requiredAttributes/);
  });
});

test("不正なJSONはエラーになる", async () => {
  await withApprovalFile("{ invalid json", async (filePath) => {
    const result = await loadPublicationApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /パースに失敗/);
  });
});
