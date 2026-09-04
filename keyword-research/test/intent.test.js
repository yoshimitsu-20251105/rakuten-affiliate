import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "../intent.js";
import { MEDICAL_TERMS, INTENT_KEYWORDS } from "../config.js";

const config = { medicalTerms: MEDICAL_TERMS, intentKeywords: INTENT_KEYWORDS };

test("医療関連語は最優先でMEDICAL_REVIEW_REQUIREDに分類される(自動公開禁止の根拠)", () => {
  const r = classifyIntent("犬 腎臓病 療法食 改善", config);
  assert.equal(r.intent, "MEDICAL_REVIEW_REQUIRED");
  assert.ok(r.reasons.some((x) => x.includes("医療関連語")));
});

test("医療語と条件購入語が同時に含まれても医療が優先される", () => {
  const r = classifyIntent("国産 無添加 犬 腎臓病 療法食", config);
  assert.equal(r.intent, "MEDICAL_REVIEW_REQUIRED");
});

test("条件購入語(国産・無添加等)はCONDITION_PURCHASEに分類される", () => {
  const r = classifyIntent("国産 無添加 ドッグフード シニア", config);
  assert.equal(r.intent, "CONDITION_PURCHASE");
});

test("比較・ランキング語はCOMMERCIAL_COMPARISONに分類される", () => {
  const r = classifyIntent("ドッグフード おすすめ 比較", config);
  assert.equal(r.intent, "COMMERCIAL_COMPARISON");
});

test("食べない等の悩み語はPROBLEM_SOLUTIONに分類される", () => {
  const r = classifyIntent("ドッグフード 食べない 対処法", config);
  assert.equal(r.intent, "PROBLEM_SOLUTION");
});

test("該当語彙がない場合はINFORMATIONALにフォールバックする", () => {
  const r = classifyIntent("あいうえお", config);
  assert.equal(r.intent, "INFORMATIONAL");
});
