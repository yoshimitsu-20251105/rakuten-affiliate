// 既存Quality Score(lib/quality-score.js、元generate-site.jsから副作用なしで抽出したもの)の
// 回帰テスト。計算式・重みが変わっていないことを固定fixtureで確認する(18章の要求)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreItem } from "../../lib/quality-score.js";

test("満点フィクスチャ: レビュー5.0・レビュー200件以上・リピートあり = 100点", () => {
  assert.equal(scoreItem({ reviewAverage: 5.0, reviewCount: 250, repeatSignal: true }), 100);
});

test("レビュー件数は200件で頭打ちになる", () => {
  const at200 = scoreItem({ reviewAverage: 5.0, reviewCount: 200, repeatSignal: false });
  const at2000 = scoreItem({ reviewAverage: 5.0, reviewCount: 2000, repeatSignal: false });
  assert.equal(at200, at2000);
  assert.equal(at200, 85); // 55(品質満点) + 30(件数満点) + 0(リピートなし)
});

test("リピート性がある場合とない場合で15点差になる", () => {
  const withRepeat = scoreItem({ reviewAverage: 4.0, reviewCount: 100, repeatSignal: true });
  const withoutRepeat = scoreItem({ reviewAverage: 4.0, reviewCount: 100, repeatSignal: false });
  assert.equal(withRepeat - withoutRepeat, 15);
});

test("既知の実データ相当の値で固定スコアを確認(回帰の目印)", () => {
  // reviewAverage=4.5, reviewCount=320, repeatSignal=false
  // 品質: (4.5/5)*55=49.5 / 実績: min(320/200,1)*30=30 / リピート: 0 → 79.5 → 丸めて80
  assert.equal(scoreItem({ reviewAverage: 4.5, reviewCount: 320, repeatSignal: false }), 80);
});
