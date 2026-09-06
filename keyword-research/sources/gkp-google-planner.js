// Googleキーワードプランナー公式エクスポートCSVの取込(2026-09-06 正式CLI対応)。
//
// Google公式エクスポート形式を前提にするが、行番号を固定せずヘッダー行を探索する
// (タイトル行・空行の有無、期間行の書式がエクスポート時期によって変わり得るため)。
// 元CSVファイルは一切変更・移動・削除しない(読み取り専用で扱う)。
//
// 対応する文字コード: UTF-16LE(BOMあり)/ UTF-8(BOMあり)/ UTF-8(BOMなし)
// 対応する区切り文字: タブ / カンマ
// 対応するヘッダー表記: 日本語・英語の両方(KEYWORD_COLUMN_ALIASES参照)

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

/** @typedef {'UTF-16LE'|'UTF-8-BOM'|'UTF-8'} DetectedEncoding */

// キーワード列を含むヘッダー行を判定するためのエイリアス(このいずれかの列が
// 存在する行をヘッダー行とみなす)。
const KEYWORD_COLUMN_ALIASES = ["keyword", "keywords", "キーワード"];

// 列名 → 内部フィールド名のマッピング(日英両対応、大文字小文字・全半角を問わない)。
const COLUMN_ALIAS_MAP = {
  keyword: ["keyword", "keywords", "キーワード"],
  monthlySearches: [
    "avg. monthly searches",
    "average monthly searches",
    "月間平均検索ボリューム",
    "月間検索ボリューム",
  ],
  competitionLevel: ["competition", "競合性"],
  // NFKC正規化で全角括弧(（）)は半角括弧(())へ統一されるため、半角表記のみ登録すればよい
  competitionIndex: ["competition (indexed value)", "競合性(インデックス値)"],
  lowTopOfPageBid: ["top of page bid (low range)", "ページ上部に掲載された広告の入札単価(低額帯)"],
  highTopOfPageBid: ["top of page bid (high range)", "ページ上部に掲載された広告の入札単価(高額帯)"],
};

const REQUIRED_FIELDS = ["keyword", "monthlySearches"];
const MAX_HEADER_SEARCH_LINES = 20;

/**
 * @param {Buffer} buffer
 * @returns {{ text: string, encoding: DetectedEncoding }}
 */
export function decodeBuffer(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString("utf16le"), encoding: "UTF-16LE" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString("utf-8"), encoding: "UTF-8-BOM" };
  }
  return { text: buffer.toString("utf-8"), encoding: "UTF-8" };
}

/**
 * @param {string[]} lines - 先頭数行(区切り文字判定に使う範囲)
 * @returns {'\t'|','}
 */
export function detectDelimiter(lines) {
  let tabCount = 0;
  let commaCount = 0;
  for (const line of lines) {
    for (const ch of line) {
      if (ch === "\t") tabCount++;
      else if (ch === ",") commaCount++;
    }
  }
  if (tabCount === 0 && commaCount === 0) {
    throw new Error("区切り文字(タブ/カンマ)を判定できません");
  }
  return tabCount >= commaCount ? "\t" : ",";
}

function normalizeCell(cell) {
  return String(cell ?? "").normalize("NFKC").trim().toLowerCase();
}

/**
 * @param {string[]} lines
 * @param {'\t'|','} delimiter
 * @returns {{ index: number, columns: string[] }}
 */
export function findHeaderRow(lines, delimiter) {
  const limit = Math.min(lines.length, MAX_HEADER_SEARCH_LINES);
  for (let i = 0; i < limit; i++) {
    const columns = lines[i].split(delimiter).map((c) => c.trim());
    const normalized = columns.map(normalizeCell);
    if (normalized.some((c) => KEYWORD_COLUMN_ALIASES.includes(c))) {
      return { index: i, columns };
    }
  }
  throw new Error(
    `キーワード列を含むヘッダー行が見つかりません(先頭${limit}行を探索しました)。Google公式エクスポート形式を確認してください。`
  );
}

/**
 * @param {string[]} columns - ヘッダー行の各セル
 * @returns {Record<string, number>} 内部フィールド名 → 列インデックス
 */
export function buildColumnIndexMap(columns) {
  const normalized = columns.map(normalizeCell);
  const map = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIAS_MAP)) {
    const normalizedAliases = aliases.map((a) => normalizeCell(a));
    const idx = normalized.findIndex((c) => normalizedAliases.includes(c));
    if (idx !== -1) map[field] = idx;
  }
  const missing = REQUIRED_FIELDS.filter((f) => !(f in map));
  if (missing.length > 0) {
    throw new Error(`必須列が見つかりません: ${missing.join(", ")}(検出されたヘッダー: ${columns.join(" | ")})`);
  }
  return map;
}

/**
 * ヘッダー行より前の行から対象期間(period)を解析する。
 * 対応形式: "2025年8月1日 - 2026年7月31日" / "2025-08-01 - 2026-07-31" /
 *           "2025/08/01 - 2026/07/31" (いずれも" - "/"〜"区切り)
 * @param {string[]} preHeaderLines
 * @returns {{ periodStart: string, periodEnd: string } | null}
 */
export function parsePeriodFromLines(preHeaderLines) {
  const jpDatePattern = /(\d{4})年(\d{1,2})月(\d{1,2})日/;
  const isoLikePattern = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;

  for (const line of preHeaderLines) {
    // 区切り記号の前後に空白が必須(ISO形式の日付自体に含まれる"-"と区別するため。
    // 例: "2025-08-01 - 2026-07-31" は日付内の"-"では分割せず、空白付きの" - "でのみ分割する)
    const parts = line.split(/\s+[-〜~]\s+/).filter(Boolean);
    if (parts.length < 2) continue;

    const start = parseOneDate(parts[0], jpDatePattern, isoLikePattern);
    const end = parseOneDate(parts[parts.length - 1], jpDatePattern, isoLikePattern);
    if (start && end) {
      return { periodStart: start, periodEnd: end };
    }
  }
  return null;
}

function parseOneDate(text, jpPattern, isoPattern) {
  const jp = text.match(jpPattern);
  if (jp) {
    const [, y, m, d] = jp;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const iso = text.match(isoPattern);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

/**
 * 「100〜1,000」のような範囲値を中央値へ変換せず、数値のみを安全に変換する。
 * カンマは桁区切りとして除去するが、範囲を示す記号(〜/-/~)を含む場合は
 * 変換せずundefinedを返す(欠損・範囲値の扱いは呼び出し側でbusinessValidated=falseになる)。
 * @param {string} raw
 * @returns {number|undefined}
 */
export function parseMonthlySearches(raw) {
  const trimmed = String(raw ?? "").trim();
  if (trimmed === "") return undefined;
  if (/[〜~\-–]/.test(trimmed.replace(/^-/, ""))) return undefined; // 範囲値・負符号紛れ以外のハイフンは範囲とみなす
  const cleaned = trimmed.replace(/,/g, "");
  if (!/^\d+$/.test(cleaned)) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function mapCompetitionLevel(raw) {
  const v = String(raw ?? "").trim();
  if (v === "") return undefined;
  const table = { 高: "HIGH", 中: "MEDIUM", 低: "LOW", 不明: "UNKNOWN", high: "HIGH", medium: "MEDIUM", low: "LOW" };
  return table[v] ?? table[v.toLowerCase()] ?? undefined;
}

function toNumberOrUndefined(v) {
  if (v === undefined || v === null) return undefined;
  const trimmed = String(v).trim();
  if (trimmed === "") return undefined;
  const cleaned = trimmed.replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Googleキーワードプランナー公式エクスポートCSVを読み込み、KeywordObservation配列へ変換する。
 * 元ファイルは読み取り専用(fs.readFileのみ)で扱い、変更・移動・削除しない。
 *
 * @param {string} filePath - 実在確認済みの絶対パス
 * @param {{ animalType: 'dog'|'cat'|'unknown' }} options
 * @returns {Promise<{
 *   observations: import('../types.js').KeywordObservation[],
 *   meta: { encoding: DetectedEncoding, delimiter: string, headerRowIndex: number,
 *     periodStart: string, periodEnd: string, rowCount: number, inputFileHash: string, filePath: string }
 * }>}
 */
export async function parseGkpFile(filePath, { animalType }) {
  const buffer = await readFile(filePath);
  const inputFileHash = sha256(buffer);
  const { text, encoding } = decodeBuffer(buffer);
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error(`CSVが空です: ${filePath}`);
  }

  const delimiter = detectDelimiter(lines.slice(0, MAX_HEADER_SEARCH_LINES));
  const { index: headerRowIndex, columns } = findHeaderRow(lines, delimiter);
  const columnIndexMap = buildColumnIndexMap(columns);

  const period = parsePeriodFromLines(lines.slice(0, headerRowIndex));
  if (!period) {
    throw new Error(
      `対象期間(period)をヘッダー行より前の行から解析できません: ${filePath}。推定は行わずエラーとします。`
    );
  }

  const observedAt = new Date().toISOString();
  const dataLines = lines.slice(headerRowIndex + 1);
  const observations = [];
  for (const line of dataLines) {
    const cells = line.split(delimiter);
    const keyword = (cells[columnIndexMap.keyword] ?? "").trim();
    if (keyword === "") continue;

    observations.push({
      source: "manual_csv",
      sourceProvider: "google_keyword_planner",
      isSynthetic: false,
      keyword,
      observedAt,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      country: "JP",
      language: "ja",
      monthlySearches: parseMonthlySearches(cells[columnIndexMap.monthlySearches]),
      competitionLevel: "competitionLevel" in columnIndexMap ? mapCompetitionLevel(cells[columnIndexMap.competitionLevel]) : undefined,
      competitionIndex: "competitionIndex" in columnIndexMap ? toNumberOrUndefined(cells[columnIndexMap.competitionIndex]) : undefined,
      lowTopOfPageBid: "lowTopOfPageBid" in columnIndexMap ? toNumberOrUndefined(cells[columnIndexMap.lowTopOfPageBid]) : undefined,
      highTopOfPageBid: "highTopOfPageBid" in columnIndexMap ? toNumberOrUndefined(cells[columnIndexMap.highTopOfPageBid]) : undefined,
      animalType,
      inputFileHash,
      rawReference: filePath,
    });
  }

  return {
    observations,
    meta: {
      encoding,
      delimiter: delimiter === "\t" ? "TAB" : "COMMA",
      headerRowIndex,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      rowCount: observations.length,
      inputFileHash,
      filePath,
    },
  };
}
