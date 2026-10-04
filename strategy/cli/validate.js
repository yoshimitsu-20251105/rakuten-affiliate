#!/usr/bin/env node
// strategy/cli/validate.js
//
// strategy/配下のJSONデータファイルを、対応するJSON Schema(strategy/schemas/)に対して
// 検証する軽量CLI。外部ライブラリ(ajv等)は使わず、本プロジェクトの既存方針(csv.js等)に
// 倣い、必要な検証サブセット(type/required/enum/format:date/minLength/minimum/maximum/
// minItems/items/additionalProperties)だけを自前実装する。
//
// 検証内容:
//   1. 各JSONファイルがパース可能か
//   2. 各要素がスキーマの必須項目・型・enum・日付形式を満たすか
//   3. ファイル内でID(idFieldで指定したキー)が重複していないか
//   4. decisions.json の relatedExperimentIds が experiments.json に実在するか(相互参照)
//   5. experiments.json の status(PLANNED/RUNNING/終了状態)と startDate/reviewDate/
//      baseline/targetUrls/result/decision/metrics の整合性(意味的検証、
//      validateExperimentLifecycle参照)。RUNNINGの場合はtargetUrlsが
//      docs/配下に実在するファイルを指しているかも確認する(ファイルシステムの
//      読み取りのみ、ネットワークアクセスはしない)
//
// 外部API呼び出しは一切行わない。

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SITE_URL } from "../../lib/site-config.js";

const STRATEGY_DIR = fileURLToPath(new URL("../", import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const SCHEMAS_DIR = `${STRATEGY_DIR}schemas/`;

const TERMINAL_EXPERIMENT_STATUSES = new Set(["SUCCESS", "FAILED", "INCONCLUSIVE", "STOPPED"]);

// ファイル名・対応スキーマ・ID重複チェックに使うキーの対応表。
export const DATA_FILES = [
  { file: "opportunities.json", schema: "opportunities.schema.json", idField: "id" },
  { file: "experiments.json", schema: "experiments.schema.json", idField: "experimentId" },
  { file: "decisions.json", schema: "decisions.schema.json", idField: "decisionId" },
  { file: "seasonality.json", schema: "seasonality.schema.json", idField: "id" },
  { file: "monetization-sources.json", schema: "monetization-sources.schema.json", idField: "id" },
  { file: "competitors.json", schema: "competitors.schema.json", idField: "id" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {string} s @returns {boolean} */
export function isValidDateString(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

function typeMatches(value, type) {
  switch (type) {
    case "null":
      return value === null;
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

/**
 * JSON Schema(サブセット)に対してインスタンスを再帰検証する。
 * @param {any} instance
 * @param {any} schema
 * @param {string} pathPrefix
 * @param {string[]} errors
 */
export function validateAgainstSchema(instance, schema, pathPrefix, errors) {
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(instance, t))) {
      errors.push(`${pathPrefix}: 型が不正です(期待: ${types.join("|")}, 実際: ${instance === null ? "null" : typeof instance})`);
      return;
    }
  }

  if (schema.enum && !schema.enum.includes(instance)) {
    errors.push(`${pathPrefix}: enumの値ではありません(許可値: ${JSON.stringify(schema.enum)}, 実際: ${JSON.stringify(instance)})`);
  }

  if (schema.format === "date" && typeof instance === "string" && !isValidDateString(instance)) {
    errors.push(`${pathPrefix}: 日付形式が不正です(YYYY-MM-DD形式である必要があります): "${instance}"`);
  }

  if (typeof instance === "string" && typeof schema.minLength === "number" && instance.length < schema.minLength) {
    errors.push(`${pathPrefix}: minLength(${schema.minLength})未満です`);
  }

  if (typeof instance === "number") {
    if (typeof schema.minimum === "number" && instance < schema.minimum) {
      errors.push(`${pathPrefix}: minimum(${schema.minimum})未満です`);
    }
    if (typeof schema.maximum === "number" && instance > schema.maximum) {
      errors.push(`${pathPrefix}: maximum(${schema.maximum})を超えています`);
    }
  }

  if (Array.isArray(instance)) {
    if (typeof schema.minItems === "number" && instance.length < schema.minItems) {
      errors.push(`${pathPrefix}: minItems(${schema.minItems})未満です`);
    }
    if (schema.items) {
      instance.forEach((item, i) => validateAgainstSchema(item, schema.items, `${pathPrefix}[${i}]`, errors));
    }
  }

  if (typeMatches(instance, "object")) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in instance)) {
          errors.push(`${pathPrefix}: 必須項目「${key}」がありません`);
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(instance)) {
        if (!(key in schema.properties)) {
          errors.push(`${pathPrefix}: 未定義のプロパティ「${key}」があります(additionalProperties:false)`);
        }
      }
    }
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (key in instance) {
          validateAgainstSchema(instance[key], subSchema, `${pathPrefix}.${key}`, errors);
        }
      }
    }
  }
}

/**
 * @param {string} dataPath
 * @param {string} schemaPath
 * @param {string} idField
 * @returns {{ valid: boolean, errors: string[], items: any[] }}
 */
export function validateDataFile(dataPath, schemaPath, idField) {
  const errors = [];
  let raw, schema;

  try {
    raw = JSON.parse(readFileSync(dataPath, "utf-8"));
  } catch (e) {
    return { valid: false, errors: [`JSONのパースに失敗しました: ${e.message}`], items: [] };
  }
  try {
    schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
  } catch (e) {
    return { valid: false, errors: [`スキーマのパースに失敗しました: ${e.message}`], items: [] };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["トップレベルはオブジェクトである必要があります({ description, items: [...] })"], items: [] };
  }
  if (!Array.isArray(raw.items)) {
    return { valid: false, errors: ["トップレベルに items 配列がありません"], items: [] };
  }

  raw.items.forEach((item, i) => validateAgainstSchema(item, schema, `items[${i}]`, errors));

  const seenIds = new Set();
  raw.items.forEach((item, i) => {
    const id = item?.[idField];
    if (typeof id !== "string" || id === "") {
      errors.push(`items[${i}]: ID項目「${idField}」が文字列として指定されていません`);
      return;
    }
    if (seenIds.has(id)) {
      errors.push(`items[${i}]: ID「${id}」が「${idField}」内で重複しています`);
    } else {
      seenIds.add(id);
    }
  });

  return { valid: errors.length === 0, errors, items: raw.items };
}

/**
 * 実験のライフサイクル(status)と他フィールドの意味的な整合性を検証する。
 * スキーマ検証(型・enum等)だけでは防げない「RUNNINGなのに未公開」
 * 「PLANNEDなのに実測baselineが確定済み扱い」等の矛盾を防ぐ。
 *
 * - PLANNED: startDate/reviewDate/baseline は null であること(「ページを作成した日」と
 *   「本番で実験を開始した日」を区別する。未公開の間は実測値を確定させない)
 * - RUNNING: startDateが必須。targetUrlsが1件以上あり、SITE_URL配下のパスであれば
 *   対応するdocs/配下のファイルが実在すること(=本番公開されていることの裏付け)
 * - SUCCESS/FAILED/INCONCLUSIVE/STOPPED(終了状態): result・decision・metrics が
 *   揃っていること(実験結果に必要な情報が存在することの確認)
 *
 * @param {any[]} experiments
 * @param {{ projectRoot?: string, siteUrl?: string }} [options]
 * @returns {string[]} errors
 */
export function validateExperimentLifecycle(experiments, { projectRoot = PROJECT_ROOT, siteUrl = SITE_URL } = {}) {
  const errors = [];

  experiments.forEach((exp, i) => {
    const prefix = `experiments.json items[${i}](${exp?.experimentId ?? "?"})`;
    const status = exp?.status;

    if (status === "PLANNED") {
      if (exp.startDate !== null && exp.startDate !== undefined) {
        errors.push(`${prefix}: status=PLANNEDの場合、startDateはnullである必要があります(実際: ${JSON.stringify(exp.startDate)})。「ページを作成した日」と「本番で実験を開始した日」を区別すること`);
      }
      if (exp.reviewDate !== null && exp.reviewDate !== undefined) {
        errors.push(`${prefix}: status=PLANNEDの場合、reviewDateはnullである必要があります(実際: ${JSON.stringify(exp.reviewDate)})`);
      }
      if (exp.baseline !== null && exp.baseline !== undefined) {
        errors.push(`${prefix}: status=PLANNEDの場合、baselineはnullである必要があります(未公開のため実測できない)`);
      }
    }

    if (status === "RUNNING") {
      if (typeof exp.startDate !== "string" || exp.startDate === "") {
        errors.push(`${prefix}: status=RUNNINGの場合、startDate(実際に公開・開始した日)が必須です`);
      }
      const targetUrls = Array.isArray(exp.targetUrls) ? exp.targetUrls : [];
      if (targetUrls.length === 0) {
        errors.push(`${prefix}: status=RUNNINGの場合、targetUrlsが1件以上必要です`);
      }
      for (const url of targetUrls) {
        if (typeof url === "string" && url.startsWith(`${siteUrl}/`)) {
          const relativePath = url.slice(siteUrl.length + 1);
          const filePath = `${projectRoot}docs/${relativePath}`;
          if (!existsSync(filePath)) {
            errors.push(`${prefix}: status=RUNNINGですが対象ファイルが存在しません(未公開の可能性があります): docs/${relativePath}`);
          }
        }
      }
    }

    if (TERMINAL_EXPERIMENT_STATUSES.has(status)) {
      if (exp.result === null || exp.result === undefined) {
        errors.push(`${prefix}: status=${status}の場合、result(SUCCESS/FAILED/INCONCLUSIVE)が必須です`);
      }
      if (exp.decision === null || exp.decision === undefined) {
        errors.push(`${prefix}: status=${status}の場合、decision(SCALE/IMPROVE/HOLD/KILL)が必須です`);
      }
      if (!Array.isArray(exp.metrics) || exp.metrics.length === 0) {
        errors.push(`${prefix}: status=${status}の場合、metrics(観測値)が1件以上必要です`);
      }
    }
  });

  return errors;
}

/**
 * strategy/配下の全データファイルを検証する(プログラム的に呼び出し可能なエントリ、テスト用)。
 * @param {string} strategyDir
 * @param {{ projectRoot?: string, siteUrl?: string }} [options]
 * @returns {{ valid: boolean, fileResults: Record<string, { valid: boolean, errors: string[] }> }}
 */
export function validateAll(strategyDir = STRATEGY_DIR, { projectRoot = PROJECT_ROOT, siteUrl = SITE_URL } = {}) {
  const fileResults = {};
  const byFile = {};

  for (const { file, schema, idField } of DATA_FILES) {
    const result = validateDataFile(`${strategyDir}${file}`, `${strategyDir}schemas/${schema}`, idField);
    fileResults[file] = { valid: result.valid, errors: result.errors };
    byFile[file] = result.items;
  }

  // 相互参照チェック: decisions.json の relatedExperimentIds が experiments.json に実在するか。
  const experimentIds = new Set((byFile["experiments.json"] ?? []).map((e) => e.experimentId));
  const decisionErrors = [];
  for (const [i, d] of (byFile["decisions.json"] ?? []).entries()) {
    for (const refId of d.relatedExperimentIds ?? []) {
      if (!experimentIds.has(refId)) {
        decisionErrors.push(`decisions.json items[${i}]: relatedExperimentIds「${refId}」が experiments.json に存在しません`);
      }
    }
  }
  if (decisionErrors.length > 0) {
    fileResults["decisions.json"].valid = false;
    fileResults["decisions.json"].errors.push(...decisionErrors);
  }

  // 実験ライフサイクルの意味的検証(PLANNED/RUNNING/終了状態の整合性)。
  const lifecycleErrors = validateExperimentLifecycle(byFile["experiments.json"] ?? [], { projectRoot, siteUrl });
  if (lifecycleErrors.length > 0) {
    fileResults["experiments.json"].valid = false;
    fileResults["experiments.json"].errors.push(...lifecycleErrors);
  }

  const valid = Object.values(fileResults).every((r) => r.valid);
  return { valid, fileResults };
}

async function main() {
  const { valid, fileResults } = validateAll();

  for (const [file, result] of Object.entries(fileResults)) {
    if (result.valid) {
      console.log(`[strategy:validate] OK: ${file}`);
    } else {
      console.error(`[strategy:validate] NG: ${file}`);
      for (const e of result.errors) console.error(`  - ${e}`);
    }
  }

  if (!valid) {
    console.error("[strategy:validate] 検証に失敗したファイルがあります");
    process.exitCode = 1;
    return;
  }
  console.log("[strategy:validate] 全ファイル検証OK");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
