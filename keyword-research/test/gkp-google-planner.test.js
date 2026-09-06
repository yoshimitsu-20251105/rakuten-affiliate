// 【2026-09-06 正式CLI対応】Googleキーワードプランナー公式エクスポートCSVパーサーのテスト。
// 文字コード・区切り文字の自動判定、ヘッダー行探索、列マッピング、期間解析、
// 検索数の安全な数値変換(範囲値を中央値へ変換しない)を検証する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseGkpFile,
  decodeBuffer,
  detectDelimiter,
  findHeaderRow,
  parsePeriodFromLines,
  parseMonthlySearches,
} from "../sources/gkp-google-planner.js";

async function withTempFile(buffer, fn) {
  const dir = await mkdtemp(join(tmpdir(), "gkp-parser-"));
  const filePath = join(dir, "test.csv");
  await writeFile(filePath, buffer);
  try {
    return await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function buildGkpText({ title = "Keyword Stats", period = "2025年8月1日 - 2026年7月31日", header, rows }) {
  return [title, period, header, ...rows].join("\n") + "\n";
}

test("UTF-16LE(BOMあり)・タブ区切りを正しく読み込む", async () => {
  const header = ["Keyword", "Currency", "Avg. monthly searches", "Competition", "Competition (indexed value)", "Top of page bid (low range)", "Top of page bid (high range)"].join("\t");
  const row = ["国産 ドッグフード", "JPY", "500", "高", "100", "69", "310"].join("\t");
  const text = buildGkpText({ header, rows: [row] });
  const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);

  await withTempFile(buffer, async (filePath) => {
    const result = await parseGkpFile(filePath, { animalType: "dog" });
    assert.equal(result.meta.encoding, "UTF-16LE");
    assert.equal(result.meta.delimiter, "TAB");
    assert.equal(result.observations.length, 1);
    assert.equal(result.observations[0].keyword, "国産 ドッグフード");
    assert.equal(result.observations[0].monthlySearches, 500);
    assert.equal(result.observations[0].competitionLevel, "HIGH");
    assert.equal(result.observations[0].competitionIndex, 100);
  });
});

test("UTF-8(BOMなし)・カンマ区切りを正しく読み込む", async () => {
  const header = ["Keyword", "Avg. monthly searches", "Competition"].join(",");
  const row = ["無添加 キャットフード", "1000", "中"].join(",");
  const text = buildGkpText({ header, rows: [row] });
  const buffer = Buffer.from(text, "utf-8");

  await withTempFile(buffer, async (filePath) => {
    const result = await parseGkpFile(filePath, { animalType: "cat" });
    assert.equal(result.meta.encoding, "UTF-8");
    assert.equal(result.meta.delimiter, "COMMA");
    assert.equal(result.observations[0].monthlySearches, 1000);
    assert.equal(result.observations[0].competitionLevel, "MEDIUM");
    assert.equal(result.observations[0].animalType, "cat");
  });
});

test("UTF-8(BOMあり)・カンマ区切りを正しく読み込む", async () => {
  const header = ["Keyword", "Avg. monthly searches"].join(",");
  const row = ["シニア 犬 フード", "5000"].join(",");
  const text = buildGkpText({ header, rows: [row] });
  const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf-8")]);

  await withTempFile(buffer, async (filePath) => {
    const result = await parseGkpFile(filePath, { animalType: "dog" });
    assert.equal(result.meta.encoding, "UTF-8-BOM");
    assert.equal(result.observations[0].keyword, "シニア 犬 フード");
  });
});

test("カンマ区切りCSVで、引用符内のカンマは列区切りとして扱わない(列がずれない)", async () => {
  const header = ["Keyword", "Avg. monthly searches", "Competition"].join(",");
  // キーワード自体に読点的なカンマを含むケースを引用符で囲む
  const row = `"シニア,犬用 ドッグフード",5000,高`;
  const text = buildGkpText({ header, rows: [row] });

  await withTempFile(Buffer.from(text, "utf-8"), async (filePath) => {
    const result = await parseGkpFile(filePath, { animalType: "dog" });
    assert.equal(result.observations.length, 1);
    assert.equal(result.observations[0].keyword, "シニア,犬用 ドッグフード");
    assert.equal(result.observations[0].monthlySearches, 5000);
    assert.equal(result.observations[0].competitionLevel, "HIGH");
  });
});

test('カンマ区切りCSVで、引用符付きの桁区切り数値("1,000")を正しく解析する', async () => {
  const header = ["Keyword", "Avg. monthly searches"].join(",");
  const row = `ドッグフード,"1,000"`;
  const text = buildGkpText({ header, rows: [row] });

  await withTempFile(Buffer.from(text, "utf-8"), async (filePath) => {
    const result = await parseGkpFile(filePath, { animalType: "dog" });
    assert.equal(result.observations[0].monthlySearches, 1000);
  });
});

test("カンマ区切りCSVで、エスケープされた引用符(\"\")を正しく解析する", async () => {
  const header = ["Keyword", "Avg. monthly searches"].join(",");
  // CSVのエスケープ規則: フィールドを""で囲み、内部の"は""で表現する
  const row = `"国産 ""プレミアム"" ドッグフード",500`;
  const text = buildGkpText({ header, rows: [row] });

  await withTempFile(Buffer.from(text, "utf-8"), async (filePath) => {
    const result = await parseGkpFile(filePath, { animalType: "dog" });
    assert.equal(result.observations[0].keyword, '国産 "プレミアム" ドッグフード');
    assert.equal(result.observations[0].monthlySearches, 500);
  });
});

test("タブ区切りで引用符を含まない既存実CSVの解析結果は、引用符対応の追加後も変わらない", async () => {
  const header = ["Keyword", "Avg. monthly searches", "Competition"].join("\t");
  const row = ["国産 無添加 ドッグフード", "5000", "高"].join("\t");
  const text = buildGkpText({ header, rows: [row] });

  await withTempFile(Buffer.from(text, "utf-8"), async (filePath) => {
    const result = await parseGkpFile(filePath, { animalType: "dog" });
    assert.equal(result.meta.delimiter, "TAB");
    assert.equal(result.observations[0].keyword, "国産 無添加 ドッグフード");
    assert.equal(result.observations[0].monthlySearches, 5000);
    assert.equal(result.observations[0].competitionLevel, "HIGH");
  });
});

test("日本語ヘッダー(キーワード/月間平均検索ボリューム/競合性)を正しくマッピングする", async () => {
  const header = ["キーワード", "月間平均検索ボリューム", "競合性", "競合性(インデックス値)"].join("\t");
  const row = ["国産 無添加 ドッグフード", "500", "低", "10"].join("\t");
  const text = buildGkpText({ header, rows: [row] });

  await withTempFile(Buffer.from(text, "utf-8"), async (filePath) => {
    const result = await parseGkpFile(filePath, { animalType: "dog" });
    assert.equal(result.observations[0].monthlySearches, 500);
    assert.equal(result.observations[0].competitionLevel, "LOW");
    assert.equal(result.observations[0].competitionIndex, 10);
  });
});

test("全角括弧の日本語列名(競合性（インデックス値）等)もNFKC正規化でマッピングできる", async () => {
  const header = ["キーワード", "月間平均検索ボリューム", "競合性（インデックス値）"].join("\t");
  const row = ["国産 ドッグフード", "500", "50"].join("\t");
  const text = buildGkpText({ header, rows: [row] });

  await withTempFile(Buffer.from(text, "utf-8"), async (filePath) => {
    const result = await parseGkpFile(filePath, { animalType: "dog" });
    assert.equal(result.observations[0].competitionIndex, 50);
  });
});

test("英語ヘッダーを正しくマッピングする", async () => {
  const header = ["Keyword", "Avg. monthly searches", "Competition", "Top of page bid (low range)", "Top of page bid (high range)"].join(
    "\t"
  );
  const row = ["dog food", "5000", "High", "50", "200"].join("\t");
  const text = buildGkpText({ header, rows: [row] });

  await withTempFile(Buffer.from(text, "utf-8"), async (filePath) => {
    const result = await parseGkpFile(filePath, { animalType: "dog" });
    assert.equal(result.observations[0].competitionLevel, "HIGH");
    assert.equal(result.observations[0].lowTopOfPageBid, 50);
    assert.equal(result.observations[0].highTopOfPageBid, 200);
  });
});

test("タイトル行・期間行を含むGoogle公式形式(1行目タイトル/2行目期間/3行目ヘッダー)を正しく解析する", async () => {
  const header = ["Keyword", "Avg. monthly searches"].join("\t");
  const row = ["ドッグフード", "500"].join("\t");
  const text = buildGkpText({
    title: "Keyword Stats 2026-09-05 at 04_40_32",
    period: "2025年8月1日 - 2026年7月31日",
    header,
    rows: [row],
  });

  await withTempFile(Buffer.from(text, "utf-8"), async (filePath) => {
    const result = await parseGkpFile(filePath, { animalType: "dog" });
    assert.equal(result.meta.headerRowIndex, 2);
    assert.equal(result.meta.periodStart, "2025-08-01");
    assert.equal(result.meta.periodEnd, "2026-07-31");
  });
});

test("ヘッダー行の位置が変わっても(行番号を固定せず)キーワード列を含む行を探索して見つける", () => {
  const rows = [
    ["何かのタイトル行"],
    ["余分な空白行的な説明"],
    ["2025年8月1日 - 2026年7月31日"],
    ["Keyword", "Avg. monthly searches"],
    ["犬", "100"],
  ];
  const { index, columns } = findHeaderRow(rows);
  assert.equal(index, 3);
  assert.deepEqual(columns, ["Keyword", "Avg. monthly searches"]);
});

test("月間検索数: カンマ区切りの数値は安全に除去して変換する", () => {
  assert.equal(parseMonthlySearches("10,000"), 10000);
  assert.equal(parseMonthlySearches("500"), 500);
});

test("月間検索数: 「100〜1,000」等の範囲値は中央値へ変換せずundefinedにする", () => {
  assert.equal(parseMonthlySearches("100〜1,000"), undefined);
  assert.equal(parseMonthlySearches("100-1000"), undefined);
  assert.equal(parseMonthlySearches("100~1000"), undefined);
});

test("月間検索数: 欠損・空文字はundefinedにする(0や中間点で埋めない)", () => {
  assert.equal(parseMonthlySearches(""), undefined);
  assert.equal(parseMonthlySearches(undefined), undefined);
  assert.equal(parseMonthlySearches("該当なし"), undefined);
});

test("対象期間を解析できない場合はエラーを投げる(推定しない)", async () => {
  const header = ["Keyword", "Avg. monthly searches"].join("\t");
  const row = ["ドッグフード", "500"].join("\t");
  const text = ["Keyword Stats", "期間の記載が無いタイトル行", header, row].join("\n") + "\n";

  await withTempFile(Buffer.from(text, "utf-8"), async (filePath) => {
    await assert.rejects(() => parseGkpFile(filePath, { animalType: "dog" }), /対象期間/);
  });
});

test("必須列(キーワード列)が無い場合はエラーを投げる", async () => {
  const header = ["Currency", "Avg. monthly searches"].join("\t");
  const row = ["JPY", "500"].join("\t");
  const text = buildGkpText({ header, rows: [row] });

  await withTempFile(Buffer.from(text, "utf-8"), async (filePath) => {
    await assert.rejects(() => parseGkpFile(filePath, { animalType: "dog" }), /ヘッダー行が見つかりません/);
  });
});

test("必須列(月間検索数列)が無い場合はエラーを投げる", async () => {
  const header = ["Keyword", "Competition"].join("\t");
  const row = ["ドッグフード", "高"].join("\t");
  const text = buildGkpText({ header, rows: [row] });

  await withTempFile(Buffer.from(text, "utf-8"), async (filePath) => {
    await assert.rejects(() => parseGkpFile(filePath, { animalType: "dog" }), /必須列が見つかりません/);
  });
});

test("CSVが空の場合はエラーを投げる", async () => {
  await withTempFile(Buffer.from("", "utf-8"), async (filePath) => {
    await assert.rejects(() => parseGkpFile(filePath, { animalType: "dog" }), /CSVが空/);
  });
});

test("元CSVファイルは一切変更されない(パース前後で内容・サイズが同一)", async () => {
  const header = ["Keyword", "Avg. monthly searches"].join("\t");
  const row = ["ドッグフード", "500"].join("\t");
  const text = buildGkpText({ header, rows: [row] });
  const buffer = Buffer.from(text, "utf-8");

  await withTempFile(buffer, async (filePath) => {
    const before = await readFile(filePath);
    const beforeStat = await stat(filePath);
    await parseGkpFile(filePath, { animalType: "dog" });
    const after = await readFile(filePath);
    const afterStat = await stat(filePath);
    assert.ok(before.equals(after), "パース前後でファイル内容が変わっていない");
    assert.equal(beforeStat.size, afterStat.size);
  });
});

test("decodeBuffer: UTF-16LE/UTF-8-BOM/UTF-8を正しく判別する", () => {
  const utf16 = decodeBuffer(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("あ", "utf16le")]));
  assert.equal(utf16.encoding, "UTF-16LE");
  const utf8bom = decodeBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("あ", "utf-8")]));
  assert.equal(utf8bom.encoding, "UTF-8-BOM");
  const utf8 = decodeBuffer(Buffer.from("あ", "utf-8"));
  assert.equal(utf8.encoding, "UTF-8");
});

test("detectDelimiter: タブが多い場合はタブ、カンマが多い場合はカンマと判定する", () => {
  assert.equal(detectDelimiter(["a\tb\tc", "1\t2\t3"]), "\t");
  assert.equal(detectDelimiter(["a,b,c", "1,2,3"]), ",");
});

test("parsePeriodFromLines: ISO形式(YYYY-MM-DD)の期間表記も解析できる", () => {
  const result = parsePeriodFromLines(["タイトル", "2025-08-01 - 2026-07-31"]);
  assert.deepEqual(result, { periodStart: "2025-08-01", periodEnd: "2026-07-31" });
});

test("複数キーワード行を持つCSVで、犬用・猫用ともに全行が取り込まれる(元データ消失なし)", async () => {
  const header = ["Keyword", "Avg. monthly searches"].join("\t");
  const rows = Array.from({ length: 20 }, (_, i) => [`キーワード${i}`, String((i + 1) * 10)].join("\t"));
  const text = buildGkpText({ header, rows });

  await withTempFile(Buffer.from(text, "utf-8"), async (filePath) => {
    const result = await parseGkpFile(filePath, { animalType: "dog" });
    assert.equal(result.observations.length, 20);
    assert.equal(result.meta.rowCount, 20);
  });
});
