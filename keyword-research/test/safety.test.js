// 【2026-09-05 GKP実データ監査対応】医療・健康関連語の安全ゲート。
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySafety } from "../safety.js";
import { MEDICAL_TERMS, HEALTH_TERMS } from "../config.js";

const config = { medicalTerms: MEDICAL_TERMS, healthTerms: HEALTH_TERMS };

for (const term of ["腎臓", "腎臓病", "肝臓", "糖尿病", "尿路", "結石", "療法食", "治療", "アレルギー", "食物アレルギー", "獣医", "処方"]) {
  test(`医療語彙「${term}」を含むキーワードはMEDICAL_REVIEW_REQUIRED`, () => {
    const r = classifySafety(`シニア 犬 フード ${term}`, config);
    assert.equal(r.safetyStatus, "MEDICAL_REVIEW_REQUIRED");
  });
}

for (const term of ["低脂肪", "ダイエット", "体重管理", "肥満", "消化", "関節", "皮膚", "涙やけ"]) {
  test(`健康訴求語彙「${term}」を含むキーワードはHEALTH_REVIEW_REQUIRED`, () => {
    const r = classifySafety(`シニア 犬 フード ${term}`, config);
    assert.equal(r.safetyStatus, "HEALTH_REVIEW_REQUIRED");
  });
}

test("医療語彙と健康訴求語彙が同時に含まれる場合、医療が優先される", () => {
  const r = classifySafety("シニア 犬 ダイエット 腎臓病 フード", config);
  assert.equal(r.safetyStatus, "MEDICAL_REVIEW_REQUIRED");
});

test("どちらの語彙も含まなければSAFE", () => {
  const r = classifySafety("国産 無添加 ドッグフード", config);
  assert.equal(r.safetyStatus, "SAFE");
});

test("【現在2位だった実データ】「シニア ドッグフード 腎臓」はMEDICAL_REVIEW_REQUIREDになり、自動PRIORITYにならない", () => {
  const r = classifySafety("シニア ドッグフード 腎臓", config);
  assert.equal(r.safetyStatus, "MEDICAL_REVIEW_REQUIRED");
});
