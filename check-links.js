// docs/ 以下の全HTMLファイルを走査し、内部リンク(相対パスのhref)が
// 実在するファイルを指しているかを検証する。
// 2026-08-27: 統合ランキングページの「全件を見る」リンクが二重パス(rankings/rankings/...)
// になっていて404していたのに、pushするまで誰も気づけなかった問題への再発防止策。

import { readFile, readdir, stat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";

const DOCS_DIR = new URL("./docs/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

async function listHtmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listHtmlFiles(full)));
    } else if (entry.name.endsWith(".html")) {
      files.push(full);
    }
  }
  return files;
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const htmlFiles = await listHtmlFiles(DOCS_DIR);
  const brokenLinks = [];

  for (const file of htmlFiles) {
    const content = await readFile(file, "utf-8");
    const hrefMatches = content.matchAll(/href="([^"]+)"/g);
    for (const match of hrefMatches) {
      const href = match[1];
      // 外部リンク・アンカー・メール等は対象外(内部の相対リンクだけをチェック)
      if (/^(https?:|mailto:|tel:|#)/.test(href)) continue;
      const targetPath = resolve(dirname(file), href.split("#")[0]);
      if (!(await fileExists(targetPath))) {
        brokenLinks.push({ file: file.replace(DOCS_DIR, "docs/"), href, targetPath });
      }
    }
  }

  if (brokenLinks.length > 0) {
    console.error(`リンク切れが${brokenLinks.length}件見つかりました:`);
    for (const { file, href } of brokenLinks) {
      console.error(`  [${file}] href="${href}"`);
    }
    process.exitCode = 1;
  } else {
    console.log(`リンクチェック完了: ${htmlFiles.length}ファイル中、リンク切れなし`);
  }
}

main();
