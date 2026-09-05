// 【2026-09-05 GKP実データ監査対応】不自然なキーワードの品質判定。
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyQueryQuality } from "../query-quality.js";
import { QUERY_QUALITY_RULES } from "../config.js";

const config = { queryQualityRules: QUERY_QUALITY_RULES };

test("空文字列はMALFORMED", () => {
  const r = classifyQueryQuality("", config);
  assert.equal(r.queryQualityStatus, "MALFORMED");
});

test("数字のみで構成されるキーワードはMALFORMED", () => {
  const r = classifyQueryQuality("11 12", config);
  assert.equal(r.queryQualityStatus, "MALFORMED");
});

test("通常のキーワードはVALID", () => {
  const r = classifyQueryQuality("国産 無添加 ドッグフード", config);
  assert.equal(r.queryQualityStatus, "VALID");
});

test("【調査で判明した実例】「11 キャットフード サイエンス シニア ダイエット ヒルズ プラス 以上 歳」は不自然に見えるが、実在するブランド入り正当な商品名(トークン結合・空白消失は原因ではない)。トークン数超過によりREVIEW_REQUIREDとするが、MALFORMEDにはしない", () => {
  const keyword = "11 キャットフード サイエンス シニア ダイエット ヒルズ プラス 以上 歳";
  const r = classifyQueryQuality(keyword, config);
  assert.equal(r.queryQualityStatus, "REVIEW_REQUIRED");
  assert.notEqual(r.queryQualityStatus, "MALFORMED");
});

test("ブランド名を含むだけでは自動除外(MALFORMED)しない", () => {
  const r = classifyQueryQuality("アカナ シニア ドッグフード", config);
  assert.equal(r.queryQualityStatus, "VALID");
});

test("トークン数が閾値を超えるとREVIEW_REQUIRED(自動除外はしない、人間の確認を促すのみ)", () => {
  const r = classifyQueryQuality("あ い う え お か き", config); // 7トークン > 閾値6
  assert.equal(r.queryQualityStatus, "REVIEW_REQUIRED");
});
