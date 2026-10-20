import { assert, assertDate, assertTimestamp, hash, jstDate, SCHEMA_VERSION } from "./model.js";

export const ORDER_FIELDS = ["date", "rewards", "rate", "amount", "genre_name", "shop_name", "item_name", "status", "link_type", "device_type", "measurement_id"];
export const JAPANESE_FIELDS = ["発生日", "成果報酬", "料率", "売上金額", "ジャンル名", "ショップ名", "商品名", "ステータス", "リンクタイプ", "デバイスタイプ", "計測ID"];
export const normalizeStatus = (value) => ({ "0": "PENDING", "1": "APPROVED", "2": "CANCELLED" })[value.trim()] ?? "UNKNOWN";

// Strict CSV lexical parsing: quoted newlines/commas/escaped quotes supported.
// The legacy keyword CSV parser is intentionally unchanged.
export function parseOrderCsvRows(text) {
  const rows = [];
  let cells = [], field = "", state = "START", line = 1, recordLine = 1;
  const endField = () => { cells.push(field); field = ""; state = "START"; };
  const endRow = () => { endField(); rows.push({ cells, line: recordLine }); cells = []; recordLine = line + 1; };
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (const ch of source) {
    if (state === "QUOTED") {
      if (ch === '"') state = "CLOSED";
      else field += ch;
    } else if (state === "CLOSED" && ch === '"') {
      field += '"'; state = "QUOTED";
    } else if (ch === ",") endField();
    else if (ch === "\n") endRow();
    else if (state === "CLOSED") throw new Error(`CSV line ${line}: 閉じ引用符の後が不正です`);
    else if (ch === '"') {
      assert(state === "START", `CSV line ${line}: 引用符の位置が不正です`);
      state = "QUOTED";
    } else { field += ch; state = "UNQUOTED"; }
    if (ch === "\n") line++;
  }
  assert(state !== "QUOTED", "CSV: 引用符が閉じていません");
  if (cells.length || field.length || state === "CLOSED") endRow();
  return rows;
}

function money(raw, name, line) {
  if (raw.trim() === "") return null;
  // Currency/decimal formatting has not been confirmed in a nonempty real CSV.
  assert(/^\d+$/.test(raw.trim()), `CSV line ${line}: ${name}は非負の整数、または空欄である必要があります`);
  const value = Number(raw.trim());
  assert(Number.isSafeInteger(value), `CSV line ${line}: ${name}が安全な整数範囲外です`);
  return value;
}

function validateMetadata(meta) {
  assert(meta && meta.reportLabel && /^\d{4}\.(0[1-9]|1[0-2])$/.test(meta.reportLabel), "reportLabel: YYYY.MMが必要です");
  assert(typeof meta.accountScopeId === "string" && meta.accountScopeId.trim(), "accountScopeIdが必要です");
  assert(meta.currency === "JPY", "PR1は明示されたJPYのみ対応します");
  assert(meta.timezone === "Asia/Tokyo", "注文別成果のtimezoneをAsia/Tokyoとして確認・指定してください");
  assert(meta.coverage === "COMPLETE" || meta.coverage === "PARTIAL", "coverageの明示が必要です");
  assert(typeof meta.sourceReference === "string" && meta.sourceReference.trim(), "sourceReferenceが必要です");
  assert(meta.dateBasis === "OCCURRENCE_DATE", "dateBasisは発生日(OCCURRENCE_DATE)を指定してください");
  assertTimestamp(meta.snapshotAsOf, "snapshotAsOf");
  assertTimestamp(meta.retrievedAt, "retrievedAt");
  if (meta.sourceGeneratedAt != null) {
    assertTimestamp(meta.sourceGeneratedAt, "sourceGeneratedAt");
    assert(Date.parse(meta.sourceGeneratedAt) <= Date.parse(meta.retrievedAt), "sourceGeneratedAtがretrievedAtより後です");
  }
  assert(meta.inputMode === "SNAPSHOT", "PR1はinputMode=SNAPSHOTのみ対応します(増分CSVは加算しません)");
  assert(Date.parse(meta.snapshotAsOf) <= Date.parse(meta.retrievedAt), "snapshotAsOfがretrievedAtより後です");
  assert(meta.filters && typeof meta.filters === "object" && !Array.isArray(meta.filters), "filtersを明示してください(全件は{})");
  assert(Object.keys(meta.filters).length === 0, "PR1は無フィルタのアカウントsnapshotのみ対応します");
  assert(meta.isSynthetic === true || meta.isSynthetic === false, "isSyntheticを明示してください");
}

/** ImportBatch + PerformanceRecords. No network or filesystem side effects. */
export function parseRakutenOrder(bytes, metadata, { importedAt = new Date().toISOString() } = {}) {
  assert(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, "原本bytesが必要です");
  validateMetadata(metadata);
  assertTimestamp(importedAt, "importedAt");
  assert(Date.parse(metadata.retrievedAt) <= Date.parse(importedAt), "retrievedAtがimportedAtより後です");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error("CSVは有効なUTF-8である必要があります"); }
  const rows = parseOrderCsvRows(text);
  const candidates = rows.map((row, i) => ({ ...row, i })).filter(({ cells }) => cells.some((cell) => cell.trim() === "date") && cells.some((cell) => cell.trim() === "rewards"));
  assert(candidates.length === 1, "machine headerは1つ必要です(date/rewardsを検出できません、または重複しています)");
  const header = candidates[0];
  const names = header.cells.map((name) => name.trim());
  assert(new Set(names).size === names.length && names.every(Boolean), "machine headerの重複列・空列は拒否します");
  for (const required of ORDER_FIELDS) assert(names.includes(required), `必須列欠損: ${required}`);
  const preamble = rows.slice(0, header.i);
  assert(preamble.some(({ cells }) => cells.some((cell) => cell.includes("注文別成果"))), "report title「注文別成果」が必要です");
  assert(preamble.some(({ cells }) => JAPANESE_FIELDS.every((field) => cells.includes(field))), "machine headerより前に日本語headerが必要です");
  const labels = preamble.flatMap(({ cells }) => cells.flatMap((cell) => cell.match(/\b\d{4}\.(?:0[1-9]|1[0-2])\b/g) ?? []));
  assert(labels.length > 0 && labels.every((label) => label === metadata.reportLabel), "report labelがmetadataと一致しません");
  const periodStart = `${metadata.reportLabel.replace(".", "-")}-01`;
  const [year, month] = metadata.reportLabel.split(".").map(Number);
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  assertDate(periodStart, "periodStart");
  const snapshotDate = jstDate(metadata.snapshotAsOf);
  assert(snapshotDate >= periodStart, "snapshotAsOfがreport期間開始前です");
  const sourceFileHash = hash(bytes);
  const records = [];
  for (const row of rows.slice(header.i + 1)) {
    if (row.cells.every((cell) => cell.trim() === "")) continue;
    assert(row.cells.length === names.length, `CSV line ${row.line}: 列数がheaderと一致しません`);
    const source = Object.fromEntries(names.map((name, i) => [name, row.cells[i]]));
    assert(source.date.trim(), `CSV line ${row.line}: dateが空です`);
    // Keep date/rate/device/link values as provided until real nonzero data confirms their syntax.
    records.push({
      recordKey: `${sourceFileHash}:${row.line}`, sourceRow: row.line,
      occurrenceDateRaw: source.date, sourceStatus: source.status,
      approvalStatus: normalizeStatus(source.status),
      commissionAmount: money(source.rewards, "rewards", row.line),
      merchandiseSalesAmount: money(source.amount, "amount", row.line),
      currency: metadata.currency, rateRaw: source.rate,
      measurementId: source.measurement_id.trim() || null,
      linkTypeRaw: source.link_type, deviceTypeRaw: source.device_type,
      conversionCount: null, conversionValidationStatus: "PARTIALLY_VERIFIED",
      attributionStatus: source.measurement_id.trim() ? "MEASUREMENT_ID_OBSERVED" : "UNATTRIBUTABLE",
      // Names are deliberately excluded from the private metric ledger; source hash/row preserve traceability.
    });
  }
  const normalized = records.map(({ recordKey, sourceRow, ...record }) => record).map((record) => JSON.stringify(record)).sort();
  const batch = {
    schemaVersion: SCHEMA_VERSION, provider: "rakuten", reportType: "ORDER_REPORT", adapterVersion: 1,
    ...metadata,
    snapshotAsOf: new Date(metadata.snapshotAsOf).toISOString(),
    retrievedAt: new Date(metadata.retrievedAt).toISOString(),
    importedAt: new Date(importedAt).toISOString(),
    sourceFileHash, normalizedContentHash: hash(JSON.stringify(normalized)),
    sourceGeneratedAt: metadata.sourceGeneratedAt ? new Date(metadata.sourceGeneratedAt).toISOString() : null,
    periodStart, periodEnd, observedThrough: snapshotDate < periodEnd ? snapshotDate : periodEnd,
    periodStatus: snapshotDate <= periodEnd ? "IN_PROGRESS" : "ENDED_NOT_FINALIZED",
    grain: "ORDER_REPORT_ROW_UNVERIFIED", countUnit: "UNKNOWN",
    recordCount: records.length,
    resultType: records.length === 0 ? "ZERO_RECORD_SNAPSHOT" : "RECORD_SNAPSHOT",
    conversionValidationStatus: "PARTIALLY_VERIFIED",
    formatEvidence: "USER_CONFIRMED_ZERO_RECORD_FORMAT_2026-10-20",
    nonZeroRealDataVerified: false,
    unknownColumns: names.filter((name) => !ORDER_FIELDS.includes(name)),
    validationResult: "VALIDATED",
  };
  const identity = { account: batch.accountScopeId, periodStart, periodEnd, currency: batch.currency, timezone: batch.timezone, dateBasis: batch.dateBasis, isSynthetic: batch.isSynthetic };
  batch.scopeKey = hash(JSON.stringify(identity));
  batch.importId = hash(JSON.stringify({ scopeKey: batch.scopeKey, snapshotAsOf: batch.snapshotAsOf, sourceFileHash, coverage: batch.coverage }));
  return { batch, records: records.map((record) => ({ ...record, importId: batch.importId })) };
}
