import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseCsv } from "../keyword-research/csv.js";
import { decodeBuffer, detectDelimiter, findHeaderRow, buildColumnIndexMap, parsePeriodFromLines } from "../keyword-research/sources/gkp-google-planner.js";
import { assert, date, timestamp, hash, freshness, numberOrNull, validateManifest, EVIDENCE_TYPES } from "./model.js";
import { validateMeasurementRecord } from "../funnel-measurement/measurement-status.js";

// Reject malformed CSV instead of letting the legacy permissive parser guess.
export function strictCsv(text, delimiter = ",") {
  let state = "START";
  for (const ch of text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")) {
    if (state === "QUOTED") { if (ch === '"') state = "CLOSED"; }
    else if (state === "CLOSED" && ch === '"') state = "QUOTED";
    else if (ch === delimiter || ch === "\n") state = "START";
    else if (state === "CLOSED") throw new Error("閉じ引用符の後が不正です");
    else if (ch === '"') { assert(state === "START", "引用符の位置が不正です"); state = "QUOTED"; }
    else state = "UNQUOTED";
  }
  assert(state !== "QUOTED", "引用符が閉じていません");
  return parseCsv(text, delimiter).filter((row) => row.some((cell) => cell.trim() !== ""));
}

function decode(bytes) {
  // Validate code units before using the existing encoding/alias helpers.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    assert(bytes.length % 2 === 0, "不正なUTF-16LEです");
    new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  } else new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return decodeBuffer(bytes);
}

function gkpRows(bytes) {
  const { text, encoding } = decode(bytes);
  const delimiter = detectDelimiter(text.split(/\r\n|\r|\n/).slice(0, 20));
  const rows = strictCsv(text, delimiter);
  const { index, columns } = findHeaderRow(rows);
  const map = buildColumnIndexMap(columns);
  assert(new Set(columns.map((v) => v.trim().toLowerCase())).size === columns.length, "GKP headerに重複があります");
  const period = parsePeriodFromLines(rows.slice(0, index).map((row) => row.join(" ")));
  assert(period, "GKPの元データ期間が必要です");
  date(period.periodStart, "GKP periodStart"); date(period.periodEnd, "GKP periodEnd");
  assert(period.periodStart <= period.periodEnd, "GKP期間が逆です");
  const observations = rows.slice(index + 1).map((cells, i) => {
    assert(cells.length === columns.length, "GKP recordの列数が不正です");
    const raw = Object.fromEntries(Object.entries(map).map(([key, col]) => [key, cells[col]]));
    return { ...raw, keyword: raw.keyword.trim(), recordReference: `record-${i + 1}`, scopeKind: "MARKET_ESTIMATE" };
  }).filter((row) => row.keyword);
  return { observations, period, encoding };
}

const ALIASES = { query: "keyword", "上位のクエリ": "keyword", "クエリ": "keyword", "クリック数": "clicks", "表示回数": "impressions", "掲載順位": "averagePosition", "平均掲載順位": "averagePosition", ctr: "ctr", position: "averagePosition" };
function manualRows(bytes) {
  const { text, encoding } = decode(bytes);
  const rows = strictCsv(text);
  assert(rows.length > 0, "CSV headerが必要です");
  const columns = rows[0].map((v) => ALIASES[v.trim().toLowerCase()] ?? v.trim());
  assert(columns.includes("keyword") && columns.every(Boolean) && new Set(columns).size === columns.length, "keyword header欠損/重複です");
  return { encoding, observations: rows.slice(1).map((cells, i) => {
    assert(cells.length === columns.length, "CSV recordの列数が不正です");
    const row = Object.fromEntries(columns.map((key, j) => [key, cells[j]]));
    return { ...row, keyword: row.keyword.trim(), recordReference: `record-${i + 1}` };
  }).filter((row) => row.keyword) };
}

function jsonRows(data, type) {
  if (type === "gsc_report") {
    assert(data && Array.isArray(data.pages) && data.requestedPeriod, "GSC保存reportの形式が不正です");
    date(data.requestedPeriod.from, "GSC from"); date(data.requestedPeriod.to, "GSC to");
    assert(data.requestedPeriod.from <= data.requestedPeriod.to, "GSC report期間が逆です");
    const observations = [];
    for (const page of data.pages) {
      assert(typeof page.pageUrl === "string" && page.searchConsole && typeof page.searchConsole.status === "string", "GSC page形式が不正です");
      if (page.searchConsole.status !== "OK") continue;
      assert(page.searchConsole.topQueries === undefined || Array.isArray(page.searchConsole.topQueries), "GSC topQueriesが不正です");
      for (const [i, row] of (page.searchConsole.topQueries ?? []).entries()) {
        assert(typeof row.query === "string" && row.query.trim(), "GSC queryが不正です");
        observations.push({ ...row, keyword: row.query, pageUrl: page.pageUrl, recordReference: `${hash(page.pageUrl).slice(0, 12)}-${i}`, scopeKind: "OWN_SITE_SEARCH" });
      }
    }
    return { observations, period: { periodStart: data.requestedPeriod.from, periodEnd: data.requestedPeriod.to }, completeness: "PARTIAL" };
  }
  if (type === "funnel_report") {
    assert(data?.schemaVersion === 1 && data.purpose === "AFFILIATE_FUNNEL_MEASUREMENT" && data.metrics && Array.isArray(data.byMeasurementId) && data.attribution, "Funnel report形式が不正です");
    const checkMetric = (m) => assert(m && (m.value === null || (typeof m.value === "number" && Number.isFinite(m.value) && ["OBSERVED", "PARTIAL"].includes(m.availability))) && typeof m.availability === "string" && ["FACT", "ESTIMATE", "HYPOTHESIS", "UNKNOWN"].includes(m.evidenceType), "Funnel metric形式が不正です");
    for (const key of ["revenue", "approvedRevenue", "conversions", "epc"]) checkMetric(data.metrics[key]);
    if (data.sourceBatch) {
      const b = data.sourceBatch;
      assert(typeof b.importId === "string" && b.importId && typeof b.accountScopeId === "string" && typeof b.isSynthetic === "boolean", "Funnel batch形式が不正です");
      timestamp(b.snapshotAsOf, "Funnel snapshotAsOf"); date(b.periodStart, "Funnel periodStart"); date(b.periodEnd, "Funnel periodEnd");
      assert(b.periodStart <= b.periodEnd && Number.isInteger(b.recordCount) && b.recordCount >= 0, "Funnel batch期間/件数が不正です");
      assert(b.recordCount > 0 || data.byMeasurementId.length === 0, "Funnel 0件snapshotにID別成果は存在できません");
    } else assert(data.byMeasurementId.length === 0, "未取込FunnelにID別成果は存在できません");
    const ids = new Set();
    for (const entry of data.byMeasurementId) {
      assert(typeof entry.measurementId === "string" && entry.measurementId && !ids.has(entry.measurementId), "Funnel measurement_id形式/重複が不正です");
      ids.add(entry.measurementId);
      for (const key of ["revenue", "approvedRevenue", "conversions"]) checkMetric(entry.metrics?.[key]);
    }
    return { rows: [data] };
  }
  const rows = Array.isArray(data) ? data : type === "lp_inventory" ? data?.pages : type === "measurement_records" && data?.targetLP ? [data] : data?.items;
  assert(Array.isArray(rows), `${type}: 配列/台帳形式が不正です`);
  for (const row of rows) {
    assert(row && typeof row === "object" && !Array.isArray(row), `${type}: recordが不正です`);
    const key = { opportunities: "id", experiments: "experimentId", decisions: "decisionId", seasonality: "id", competitors: "id", lp_inventory: "path", offers: "itemCode", measurement_records: "targetLP" }[type];
    assert(typeof row[key] === "string" && row[key].trim(), `${type}: ${key}が必要です`);
    if (type === "opportunities") assert(typeof row.name === "string" && row.name.trim(), "opportunity nameが必要です");
    if (type === "seasonality") assert(["FACT", "ESTIMATE", "HYPOTHESIS", "UNKNOWN"].includes(row.confidence) && Array.isArray(row.peakMonths) && row.peakMonths.every((m) => Number.isInteger(m) && m >= 1 && m <= 12), "seasonality recordが不正です");
    if (type === "experiments") assert(typeof row.status === "string" && Array.isArray(row.targetUrls) && row.targetUrls.every((v) => typeof v === "string"), "experiment recordが不正です");
    if (type === "competitors") { assert(typeof row.keyword === "string" && typeof row.pageUrl === "string", "competitor recordが不正です"); date(row.observedAt, "competitor observedAt"); }
    if (type === "measurement_records") validateMeasurementRecord(row);
    if (type === "lp_inventory") assert(!/^([/\\]|[A-Za-z]:)/.test(row.path) && !row.path.split(/[/\\]/).includes(".."), "LP pathはdocs内の相対pathです");
    if (type === "opportunities") for (const field of ["counterEvidence", "unknowns"]) if (row[field] !== undefined) assert(Array.isArray(row[field]) && row[field].every((v) => typeof v === "string"), "opportunity補助情報の型が不正です");
  }
  return { rows };
}

export async function loadSources(manifest, { baseDir, asOf, parsedAt = new Date().toISOString() }) {
  validateManifest(manifest); timestamp(asOf, "asOf"); timestamp(parsedAt, "parsedAt");
  const sources = [];
  for (const spec of manifest.sources) {
    try {
      const bytes = await readFile(resolve(baseDir, spec.path));
      assert(!spec.sourceFileHash || spec.sourceFileHash === hash(bytes), "原本hashが一致しません");
      let result;
      if (spec.sourceType === "gkp_csv") result = gkpRows(bytes);
      else if (["manual_csv", "gsc_csv"].includes(spec.sourceType)) result = manualRows(bytes);
      else result = jsonRows(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "")), spec.sourceType);
      if (result.period) for (const key of ["periodStart", "periodEnd"]) assert(spec[key] == null || spec[key] === result.period[key], "manifest期間と元データ期間が一致しません");
      const source = {
        sourceId: spec.sourceId, sourceType: spec.sourceType, provider: spec.provider ?? (spec.sourceType === "gkp_csv" ? "google_keyword_planner" : "unknown"),
        sourceReference: spec.sourceReference ?? spec.sourceId, sourceFileHash: hash(bytes), parsedAt,
        retrievedAt: spec.retrievedAt == null ? null : timestamp(spec.retrievedAt, "retrievedAt"),
        periodStart: result.period?.periodStart ?? spec.periodStart ?? null, periodEnd: result.period?.periodEnd ?? spec.periodEnd ?? null,
        country: spec.country ?? null, language: spec.language ?? null, timezone: spec.timezone ?? null,
        grain: spec.grain ?? (spec.sourceType === "gsc_report" ? "QUERY_PAGE" : null), scope: spec.scope ?? null,
        filters: spec.filters ?? null, completeness: result.completeness ?? spec.completeness ?? "UNKNOWN", isSynthetic: spec.isSynthetic,
        evidenceType: spec.evidenceType ?? null,
        encoding: result.encoding ?? "UTF-8", observations: result.observations ?? [], rows: result.rows ?? [],
      };
      source.freshness = freshness(source, asOf, manifest.freshnessPolicy?.[spec.sourceId] ?? {});
      source.state = source.rows.length || source.observations.length ? "LOADED" : "EMPTY";
      for (const row of source.observations) {
        for (const [key, value] of Object.entries(row)) if ((key === "evidenceType" || key.endsWith("EvidenceType")) && value !== "") assert(EVIDENCE_TYPES.includes(value), "record evidenceTypeが不正です");
        row.rawValues = {};
        for (const key of ["monthlySearches", "impressions", "clicks", "competitionIndex", "averagePosition", "ctr", "lowTopOfPageBid", "highTopOfPageBid"]) if (row[key] !== undefined) {
          row.rawValues[key] = row[key];
          if (key === "ctr" && typeof row[key] === "string" && row[key].trim().endsWith("%")) {
            const value = numberOrNull(row[key].trim().slice(0, -1)); row[key] = value === null ? null : value / 100;
          }
          else row[key] = numberOrNull(row[key]);
        }
      }
      sources.push(source);
    } catch (error) {
      // Input paths or raw records may contain private data. Never propagate them.
      const reason = error.code ? "SOURCE_READ_FAILED" : error instanceof SyntaxError ? "INVALID_JSON" : error instanceof TypeError ? "INVALID_ENCODING_OR_TYPE" :
        /期間|period|日付/.test(error.message) ? "INVALID_PERIOD" : /header|ヘッダー|必須列/.test(error.message) ? "INVALID_HEADER" : /hash/.test(error.message) ? "HASH_MISMATCH" : "SOURCE_VALIDATION_FAILED";
      throw new Error(`Source ${spec.sourceId}: ${reason}`);
    }
  }
  return sources;
}
