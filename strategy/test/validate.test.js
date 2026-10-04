// strategy/cli/validate.js の検証: 正常データ・JSON不正・必須項目欠落・enum不正・ID重複・
// 相互参照不整合を確認する。外部API・外部ライブラリは使わない。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDataFile, validateAll, isValidDateString } from "../cli/validate.js";

const STRATEGY_DIR = fileURLToPath(new URL("../", import.meta.url));

const OPPORTUNITY_SCHEMA_PATH = `${STRATEGY_DIR}schemas/opportunities.schema.json`;

function validOpportunity(overrides = {}) {
  return {
    id: "test-opportunity-1",
    name: "テスト機会",
    category: "test",
    revenueEngines: ["VOLUME"],
    status: "RESEARCH",
    trafficScore: null,
    moneyScore: null,
    executionScore: null,
    durabilityScore: null,
    opportunityScore: null,
    searchVolume: null,
    searchIntent: null,
    serpDifficulty: null,
    seasonality: null,
    monetizationOptions: [],
    hypothesis: "テスト仮説",
    counterEvidence: [],
    unknowns: ["テスト不明点"],
    nextAction: "テスト次アクション",
    reviewDate: "2026-12-01",
    ...overrides,
  };
}

async function writeTempDataFile(items) {
  const dir = await mkdtemp(join(tmpdir(), "strategy-validate-test-"));
  await writeFile(join(dir, "data.json"), JSON.stringify({ description: "test", items }, null, 2), "utf-8");
  return { dir, path: join(dir, "data.json") };
}

test("validateDataFile: 正常データはvalid:trueを返す", async () => {
  const { dir, path } = await writeTempDataFile([validOpportunity()]);
  try {
    const result = validateDataFile(path, OPPORTUNITY_SCHEMA_PATH, "id");
    assert.equal(result.valid, true, result.errors.join("\n"));
    assert.equal(result.errors.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateDataFile: JSONが不正な場合はvalid:falseでエラーを返す", async () => {
  const dir = await mkdtemp(join(tmpdir(), "strategy-validate-test-"));
  try {
    const path = join(dir, "data.json");
    await writeFile(path, "{ not valid json", "utf-8");
    const result = validateDataFile(path, OPPORTUNITY_SCHEMA_PATH, "id");
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /パースに失敗/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateDataFile: 必須項目が欠落している場合はエラーになる", async () => {
  const item = validOpportunity();
  delete item.hypothesis;
  const { dir, path } = await writeTempDataFile([item]);
  try {
    const result = validateDataFile(path, OPPORTUNITY_SCHEMA_PATH, "id");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("hypothesis")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateDataFile: enumにない値はエラーになる", async () => {
  const item = validOpportunity({ status: "NOT_A_VALID_STATUS" });
  const { dir, path } = await writeTempDataFile([item]);
  try {
    const result = validateDataFile(path, OPPORTUNITY_SCHEMA_PATH, "id");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("enum")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateDataFile: revenueEnginesに不正なenum値が含まれる場合はエラーになる", async () => {
  const item = validOpportunity({ revenueEngines: ["NOT_A_REAL_ENGINE"] });
  const { dir, path } = await writeTempDataFile([item]);
  try {
    const result = validateDataFile(path, OPPORTUNITY_SCHEMA_PATH, "id");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("enum")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateDataFile: IDが重複している場合はエラーになる", async () => {
  const { dir, path } = await writeTempDataFile([validOpportunity(), validOpportunity()]);
  try {
    const result = validateDataFile(path, OPPORTUNITY_SCHEMA_PATH, "id");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("重複")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateDataFile: 日付形式が不正な場合はエラーになる", async () => {
  const item = validOpportunity({ reviewDate: "2026/12/01" });
  const { dir, path } = await writeTempDataFile([item]);
  try {
    const result = validateDataFile(path, OPPORTUNITY_SCHEMA_PATH, "id");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("日付形式")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateDataFile: additionalProperties:falseのため未定義プロパティはエラーになる", async () => {
  const item = validOpportunity({ unexpectedField: "should not be here" });
  const { dir, path } = await writeTempDataFile([item]);
  try {
    const result = validateDataFile(path, OPPORTUNITY_SCHEMA_PATH, "id");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("未定義のプロパティ")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("isValidDateString: 妥当な日付とそうでない日付を正しく判定する", () => {
  assert.equal(isValidDateString("2026-10-05"), true);
  assert.equal(isValidDateString("2026-13-01"), false);
  assert.equal(isValidDateString("2026/10/05"), false);
  assert.equal(isValidDateString(""), false);
  assert.equal(isValidDateString(null), false);
});

test("validateAll: 実際のstrategy/配下のサンプルデータは全件検証OKになる(回帰防止)", () => {
  const { valid, fileResults } = validateAll(STRATEGY_DIR);
  for (const [file, result] of Object.entries(fileResults)) {
    assert.equal(result.valid, true, `${file}: ${result.errors.join("\n")}`);
  }
  assert.equal(valid, true);
});

test("validateAll: decisions.jsonのrelatedExperimentIdsがexperiments.jsonに存在しない場合はエラーになる(相互参照)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "strategy-validate-crossref-test-"));
  try {
    await mkdir(join(dir, "schemas"), { recursive: true });
    await cp(join(STRATEGY_DIR, "schemas"), join(dir, "schemas"), { recursive: true });

    await writeFile(join(dir, "opportunities.json"), JSON.stringify({ description: "t", items: [] }), "utf-8");
    await writeFile(join(dir, "experiments.json"), JSON.stringify({ description: "t", items: [] }), "utf-8");
    await writeFile(
      join(dir, "decisions.json"),
      JSON.stringify({
        description: "t",
        items: [
          {
            decisionId: "dec-1",
            date: "2026-10-05",
            topic: "test",
            decision: "test",
            facts: ["fact"],
            assumptions: [],
            alternativesConsidered: [],
            reasoningSummary: "test",
            expectedImpact: null,
            risks: [],
            reviewDate: "2026-11-01",
            relatedExperimentIds: ["exp-does-not-exist"],
          },
        ],
      }),
      "utf-8"
    );
    await writeFile(join(dir, "seasonality.json"), JSON.stringify({ description: "t", items: [] }), "utf-8");
    await writeFile(join(dir, "monetization-sources.json"), JSON.stringify({ description: "t", items: [] }), "utf-8");
    await writeFile(join(dir, "competitors.json"), JSON.stringify({ description: "t", items: [] }), "utf-8");

    // パス区切りの差異を避けるため、Windowsでも動くよう末尾スラッシュを明示的に付与する
    const normalizedDir = dir.replace(/\\/g, "/") + "/";
    const result = validateAll(normalizedDir);
    assert.equal(result.fileResults["decisions.json"].valid, false);
    assert.ok(result.fileResults["decisions.json"].errors.some((e) => e.includes("relatedExperimentIds")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
