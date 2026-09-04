import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadApprovalFile, isPublishEligible } from "../approval.js";
import { normalizeKeyword } from "../normalize.js";
import { SYNONYM_DICTIONARY } from "../config.js";

const config = { synonyms: SYNONYM_DICTIONARY };
const canon = (kw) => normalizeKeyword(kw, config).canonicalKeyword;

test("承認ファイルのキーワードは自然な表記のままcanonicalKeywordへ正規化されて照合される", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kw-approval-"));
  const filePath = join(dir, "approved.json");
  await writeFile(filePath, JSON.stringify({ keywords: ["ドッグフード 無添加 国産"], approvedBy: "tester" }), "utf-8");

  const { valid, canonicalApprovedSet } = await loadApprovalFile(filePath, config);
  assert.equal(valid, true);
  // 語順違いでも同じcanonicalKeywordになるため一致する
  assert.ok(canonicalApprovedSet.has(canon("国産 無添加 ドッグフード")));

  await rm(dir, { recursive: true, force: true });
});

test("形式不正な承認ファイル(keywordsが配列でない)はvalid=falseになる", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kw-approval-"));
  const filePath = join(dir, "bad.json");
  await writeFile(filePath, JSON.stringify({ keywords: "not-an-array" }), "utf-8");

  const { valid, errors } = await loadApprovalFile(filePath, config);
  assert.equal(valid, false);
  assert.ok(errors.length > 0);

  await rm(dir, { recursive: true, force: true });
});

test("未承認のキーワードはisPublishEligible=falseになる(承認ゲート)", () => {
  const approvedSet = new Set([canon("国産 無添加 ドッグフード")]);
  const check = isPublishEligible(
    { canonicalKeyword: canon("未承認 キーワード"), matchStatus: "ELIGIBLE", intent: "CONDITION_PURCHASE", hasQualityScore: true },
    approvedSet
  );
  assert.equal(check.eligible, false);
  assert.ok(check.reasons.some((r) => r.includes("未承認")));
});

test("医療関連(MEDICAL_REVIEW_REQUIRED)は承認済みでも公開不可", () => {
  const approvedSet = new Set([canon("犬 腎臓病 療法食")]);
  const check = isPublishEligible(
    { canonicalKeyword: canon("犬 腎臓病 療法食"), matchStatus: "ELIGIBLE", intent: "MEDICAL_REVIEW_REQUIRED", hasQualityScore: true },
    approvedSet
  );
  assert.equal(check.eligible, false);
  assert.ok(check.reasons.some((r) => r.includes("医療")));
});

test("承認済み・ELIGIBLE・Quality Score計算済みならeligible=true", () => {
  const canonical = canon("国産 無添加 ドッグフード");
  const approvedSet = new Set([canonical]);
  const check = isPublishEligible(
    { canonicalKeyword: canonical, matchStatus: "ELIGIBLE", intent: "CONDITION_PURCHASE", hasQualityScore: true },
    approvedSet
  );
  assert.equal(check.eligible, true);
});
