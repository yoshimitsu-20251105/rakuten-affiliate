// fixtureアダプター: テスト・CI・認証未設定時の再現用データ源。
// 6クラスターそれぞれについて、購買意図の異なるキーワードを数件ずつ収録している。

import { readFile } from "node:fs/promises";

const FIXTURE_FILE = new URL("../fixtures/keyword-observations.fixture.json", import.meta.url);

/**
 * @returns {Promise<import('./index.js').SourceResult>}
 */
export async function fetchFromFixture() {
  const raw = await readFile(FIXTURE_FILE, "utf-8");
  const data = JSON.parse(raw);
  const observedAt = new Date().toISOString();
  const observations = data.map((row) => ({ ...row, source: "fixture", observedAt }));
  return {
    observations,
    meta: {
      source: "fixture",
      configured: true,
      fallbackUsed: false,
      note: `fixture.json から${observations.length}件を読み込み(再現用の固定データ)`,
    },
  };
}
