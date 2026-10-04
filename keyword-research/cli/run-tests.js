#!/usr/bin/env node
// `node --test <directory>` はシェルのglob展開に依存せずには動かない環境があるため
// (Windows cmd.exeはglobを展開しない)、node:testのprogrammatic APIでテストファイル一覧を
// 自前で列挙してから渡す、シェル非依存のテストランナー。

import { readdirSync } from "node:fs";
import { run } from "node:test";
import { tap } from "node:test/reporters";
import { fileURLToPath } from "node:url";

const TEST_DIR = fileURLToPath(new URL("../test/", import.meta.url));
// 【2026-10-05 AI Agent Operating System対応】strategy/配下の検証CLI用テストも
// 同じ `npm test` で実行できるよう、テストディレクトリをもう1つ追加で走査する
// (keyword-research/test/のテストランナーを変更せず、走査対象を増やすだけ)。
const STRATEGY_TEST_DIR = fileURLToPath(new URL("../../strategy/test/", import.meta.url));

function listTestFiles(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".test.js"))
      .map((f) => `${dir}${f}`);
  } catch {
    return [];
  }
}

const files = [...listTestFiles(TEST_DIR), ...listTestFiles(STRATEGY_TEST_DIR)];

if (files.length === 0) {
  console.error("[keywords:validate] keyword-research/test/ にテストファイルが見つかりません");
  process.exit(1);
}

const stream = run({ files });
stream.compose(tap).pipe(process.stdout);

let failed = false;
stream.on("test:fail", () => {
  failed = true;
});
stream.on("end", () => {
  process.exitCode = failed ? 1 : 0;
});
