#!/usr/bin/env node
// npm run keywords:map-rakuten -- [--dry-run]
// latest-candidates.json(なければ内部でresearchを実行)を読み、楽天商品照合・
// WebKeywordScore・FinalPriorityまで計算する。楽天APIは読み取り専用の検索呼び出しのみ
// (商品データの取得)で、公開ページや本番状態は一切変更しない。

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { runResearch, runMapRakuten } from "../pipeline.js";
import { nowJstIso } from "./args.js";

const OUTPUT_DIR = new URL("../output/", import.meta.url);

async function loadOrRunResearch() {
  try {
    const raw = await readFile(new URL("latest-candidates.json", OUTPUT_DIR), "utf-8");
    const parsed = JSON.parse(raw);
    console.log("[keywords:map-rakuten] 既存の latest-candidates.json を使用");
    return { candidates: parsed.candidates, sourceMetas: parsed.sourceMetas, config: parsed.config };
  } catch {
    console.log("[keywords:map-rakuten] latest-candidates.json が無いため research を先に実行");
    return runResearch({});
  }
}

async function main() {
  const researchResult = await loadOrRunResearch();
  const isRakutenLive = Boolean(process.env.RAKUTEN_APP_ID && process.env.RAKUTEN_SECRET);
  console.log(
    isRakutenLive
      ? "[keywords:map-rakuten] 楽天API認証情報を検出 → 実際の楽天商品検索APIを使用します(読み取り専用)"
      : "[keywords:map-rakuten] 楽天API認証情報が未設定 → fixtureデータへフォールバックします"
  );

  const candidates = await runMapRakuten(researchResult, {});

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(
    new URL("latest-matches.json", OUTPUT_DIR),
    JSON.stringify({ runAt: nowJstIso(), candidates, sourceMetas: researchResult.sourceMetas, config: researchResult.config }, null, 2),
    "utf-8"
  );

  const eligible = candidates.filter((c) => c.rakuten.eligibleCount > 0).length;
  console.log(`[keywords:map-rakuten] ${candidates.length}件中 ${eligible}件で楽天ELIGIBLE商品を確認`);
  console.log(`出力: keyword-research/output/latest-matches.json`);
  console.log(`(dry-run: 公開ページ・本番状態・commit・pushは行っていません)`);
}

main().catch((e) => {
  console.error(`[keywords:map-rakuten] エラー: ${e.message}`);
  process.exitCode = 1;
});
