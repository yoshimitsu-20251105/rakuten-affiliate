#!/usr/bin/env node
// `node --test <directory>` はシェルのglob展開に依存せずには動かない環境があるため
// (Windows cmd.exeはglobを展開しない)、node:testのprogrammatic APIでテストファイル一覧を
// 自前で列挙してから渡す、シェル非依存のテストランナー。

import { readdirSync } from "node:fs";
import { run } from "node:test";
import { tap } from "node:test/reporters";
import { fileURLToPath } from "node:url";

const TEST_DIR = fileURLToPath(new URL("../test/", import.meta.url));
const files = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".test.js"))
  .map((f) => `${TEST_DIR}${f}`);

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
