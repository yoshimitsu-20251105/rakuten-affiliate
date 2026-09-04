// 最小限のCSV読み書き(UTF-8、引用符対応)。新規依存パッケージを避けるため自前実装。
// RFC4180の主要部分(カンマ区切り、ダブルクォート囲み、クォート内のカンマ/改行/エスケープ""）に対応。

/**
 * @param {string} text
 * @returns {string[][]} 行×列の二次元配列(1行目もヘッダーとして含む、呼び出し側で処理)
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/﻿/g, ""); // BOM除去

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/**
 * @param {string[]} headers
 * @param {Array<Record<string,string|number|boolean|null|undefined>>} records
 * @returns {string}
 */
export function toCsv(headers, records) {
  const lines = [headers.map(escapeCsvField).join(",")];
  for (const record of records) {
    lines.push(headers.map((h) => escapeCsvField(record[h] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

function escapeCsvField(value) {
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * ヘッダー行を含むCSVテキストを、オブジェクトの配列にパースする。
 */
export function parseCsvRecords(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const [header, ...rest] = rows;
  return rest.map((row) => Object.fromEntries(header.map((h, i) => [h, row[i] ?? ""])));
}
