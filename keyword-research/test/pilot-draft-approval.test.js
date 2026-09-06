// 【2026-09-07 Phase 3A対応】承認ファイル(approval.json)スキーマ検証のテスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadApprovalFile } from "../pilot-draft-approval.js";

function validApproval(overrides = {}) {
  return {
    version: 1,
    sourceRunId: "live-2026-09-07",
    candidateSetHash: "abc123",
    approvedBy: "human",
    approvedAt: "2026-09-07T00:00:00.000Z",
    keywords: [
      { normalizedKeyword: "シニア 犬 豚肉", title: "シニア犬向け豚肉ドッグフードおすすめランキング比較", slug: "senior-dog-pork", action: "CREATE" },
    ],
    ...overrides,
  };
}

async function withApprovalFile(content, fn) {
  const dir = await mkdtemp(join(tmpdir(), "pilot-approval-"));
  const filePath = join(dir, "approval.json");
  await writeFile(filePath, typeof content === "string" ? content : JSON.stringify(content), "utf-8");
  try {
    return await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("正しい承認ファイルは検証を通過する", async () => {
  await withApprovalFile(validApproval(), async (filePath) => {
    const result = await loadApprovalFile(filePath);
    assert.equal(result.valid, true, result.errors.join(", "));
    assert.equal(result.approval.keywords.length, 1);
    assert.ok(result.approvedFileHash);
  });
});

test("approved-file未指定はエラーになる", async () => {
  const result = await loadApprovalFile(undefined);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /指定されていません/);
});

test("存在しないファイル/不正なJSONはエラーになる", async () => {
  await withApprovalFile("{ invalid json", async (filePath) => {
    const result = await loadApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /パースに失敗/);
  });
});

test("approvedByが'human'以外はエラーになる", async () => {
  await withApprovalFile(validApproval({ approvedBy: "auto" }), async (filePath) => {
    const result = await loadApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /human/);
  });
});

test("approvedAt未指定はエラーになる", async () => {
  await withApprovalFile(validApproval({ approvedAt: "" }), async (filePath) => {
    const result = await loadApprovalFile(filePath);
    assert.equal(result.valid, false);
  });
});

test("keywordsが空配列はエラーになる", async () => {
  await withApprovalFile(validApproval({ keywords: [] }), async (filePath) => {
    const result = await loadApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /1件以上/);
  });
});

test("keywordsが11件(上限10件超過)はエラーになる", async () => {
  const keywords = Array.from({ length: 11 }, (_, i) => ({
    normalizedKeyword: `キーワード${i}`,
    title: `タイトル${i}`,
    slug: `slug-${i}`,
    action: "CREATE",
  }));
  await withApprovalFile(validApproval({ keywords }), async (filePath) => {
    const result = await loadApprovalFile(filePath);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(""), /最大10件/);
  });
});

test("action='CREATE'以外はエラーになる", async () => {
  await withApprovalFile(
    validApproval({ keywords: [{ normalizedKeyword: "テスト", title: "テスト", slug: "test", action: "UPDATE" }] }),
    async (filePath) => {
      const result = await loadApprovalFile(filePath);
      assert.equal(result.valid, false);
      assert.match(result.errors.join(""), /CREATE/);
    }
  );
});

test("slugが不正な文字(日本語・大文字・スペース等)を含む場合はエラーになる", async () => {
  await withApprovalFile(
    validApproval({ keywords: [{ normalizedKeyword: "テスト", title: "テスト", slug: "不正 Slug!", action: "CREATE" }] }),
    async (filePath) => {
      const result = await loadApprovalFile(filePath);
      assert.equal(result.valid, false);
      assert.match(result.errors.join(""), /slugが不正/);
    }
  );
});

test("承認ファイル内でslugが重複している場合はエラーになる", async () => {
  await withApprovalFile(
    validApproval({
      keywords: [
        { normalizedKeyword: "キーワードA", title: "A", slug: "same-slug", action: "CREATE" },
        { normalizedKeyword: "キーワードB", title: "B", slug: "same-slug", action: "CREATE" },
      ],
    }),
    async (filePath) => {
      const result = await loadApprovalFile(filePath);
      assert.equal(result.valid, false);
      assert.match(result.errors.join(""), /重複/);
    }
  );
});

test("承認ファイル内でnormalizedKeywordが重複している場合はエラーになる", async () => {
  await withApprovalFile(
    validApproval({
      keywords: [
        { normalizedKeyword: "同じキーワード", title: "A", slug: "slug-a", action: "CREATE" },
        { normalizedKeyword: "同じキーワード", title: "B", slug: "slug-b", action: "CREATE" },
      ],
    }),
    async (filePath) => {
      const result = await loadApprovalFile(filePath);
      assert.equal(result.valid, false);
      assert.match(result.errors.join(""), /重複/);
    }
  );
});

test("ちょうど10件(上限ぴったり)は成功する", async () => {
  const keywords = Array.from({ length: 10 }, (_, i) => ({
    normalizedKeyword: `キーワード${i}`,
    title: `タイトル${i}`,
    slug: `slug-${i}`,
    action: "CREATE",
  }));
  await withApprovalFile(validApproval({ keywords }), async (filePath) => {
    const result = await loadApprovalFile(filePath);
    assert.equal(result.valid, true, result.errors.join(", "));
  });
});

test("versionが数値でない場合はエラーになる", async () => {
  await withApprovalFile(validApproval({ version: "1" }), async (filePath) => {
    const result = await loadApprovalFile(filePath);
    assert.equal(result.valid, false);
  });
});

test("approvedFileHashは承認ファイルの内容から一意に決まる(内容が同じなら同じハッシュ)", async () => {
  const content = validApproval();
  const hash1 = await withApprovalFile(content, (p) => loadApprovalFile(p).then((r) => r.approvedFileHash));
  const hash2 = await withApprovalFile(content, (p) => loadApprovalFile(p).then((r) => r.approvedFileHash));
  assert.equal(hash1, hash2);
});
