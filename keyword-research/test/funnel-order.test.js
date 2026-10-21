import test from "node:test";
import assert from "node:assert/strict";
import { parseRakutenOrder as parseOrder, parseOrderCsvRows, ORDER_FIELDS, normalizeStatus } from "../../funnel-measurement/rakuten-order.js";
import { hash } from "../../funnel-measurement/model.js";
import { zeroBytes, meta, recordsBytes } from "./funnel-helpers.js";

test("UTF-8 BOM, preamble, Japanese + machine headers, blank records: formal zero snapshot", () => {
  assert.deepEqual([...zeroBytes.subarray(0, 3)], [239, 187, 191]);
  const { batch, records } = parseRakutenOrder(zeroBytes, meta());
  assert.equal(batch.reportType, "ORDER_REPORT");
  assert.equal(batch.sourceFileHash, hash(zeroBytes));
  assert.equal(batch.recordCount, 0);
  assert.equal(batch.resultType, "ZERO_RECORD_SNAPSHOT");
  assert.equal(batch.periodStatus, "IN_PROGRESS");
  assert.equal(batch.periodStart, "2026-10-01");
  assert.equal(batch.periodEnd, "2026-10-31");
  assert.equal(batch.observedThrough, "2026-10-20");
  assert.equal(batch.snapshotAsOf, new Date(meta().snapshotAsOf).toISOString());
  assert.equal(batch.retrievedAt, new Date(meta().retrievedAt).toISOString());
  assert.equal(batch.conversionValidationStatus, "PARTIALLY_VERIFIED");
  assert.equal(batch.nonZeroRealDataVerified, false);
  assert.deepEqual(records, []);
});

test("status mapping preserves original values and measurement_id; rewards != amount", () => {
  const { records } = parseRakutenOrder(recordsBytes([{ status: "0", rewards: "100", amount: "10000" }, { status: "1" }, { status: "2" }, { status: "9" }, { status: "", id: "" }]), meta());
  assert.deepEqual(records.map((r) => r.approvalStatus), ["PENDING", "APPROVED", "CANCELLED", "UNKNOWN", "UNKNOWN"]);
  assert.deepEqual(records.map((r) => r.sourceStatus), ["0", "1", "2", "9", ""]);
  assert.equal(records[0].commissionAmount, 100);
  assert.equal(records[0].merchandiseSalesAmount, 10000);
  assert.equal(records[0].measurementId, "synthetic-note");
  assert.equal(records[4].measurementId, null);
  assert.equal(records[0].conversionCount, null);
  assert.equal(normalizeStatus("APPROVED"), "UNKNOWN");
});

test("additional columns are disclosed but never substituted for required fields", () => {
  const text = zeroBytes.toString().replace(ORDER_FIELDS.join(","), ORDER_FIELDS.join(",") + ",future_column");
  const { batch } = parseRakutenOrder(Buffer.from(text), meta());
  assert.deepEqual(batch.unknownColumns, ["future_column"]);
  for (const field of ORDER_FIELDS) {
    const broken = zeroBytes.toString().replace(ORDER_FIELDS.join(","), ORDER_FIELDS.filter((f) => f !== field).join(","));
    assert.throws(() => parseRakutenOrder(Buffer.from(broken), meta()), /header|必須列/);
  }
});

test("malformed/missing/duplicate headers, footer records, invalid UTF-8 fail closed", () => {
  assert.throws(() => parseRakutenOrder(Buffer.from([0xff]), meta()), /UTF-8/);
  assert.throws(() => parseRakutenOrder(Buffer.from("date,rewards\n"), meta()), /必須列/);
  assert.throws(() => parseRakutenOrder(Buffer.from(zeroBytes.toString() + ORDER_FIELDS.join(",")), meta()), /machine header/);
  assert.throws(() => parseRakutenOrder(Buffer.from(zeroBytes.toString() + "合計,100\n"), meta()), /列数/);
  assert.throws(() => parseRakutenOrder(Buffer.from(zeroBytes.toString().replace("注文別成果", "unknown report")), meta()), /title/);
  assert.throws(() => parseRakutenOrder(Buffer.from(zeroBytes.toString().replace("発生日", "unknown")), meta()), /日本語/);
  assert.throws(() => parseRakutenOrder(zeroBytes, meta({ reportLabel: "2026.09" })), /label/);
});

test("CSV quotes: commas, multiline fields, escaped quotes and strict malformed rejection", () => {
  const { records } = parseRakutenOrder(recordsBytes([{ item: 'test, "item"\nsecond line' }]), meta());
  assert.equal(records.length, 1);
  assert.equal(records[0].sourceRow, 10);
  assert.throws(() => parseOrderCsvRows('"unclosed'), /閉じて/);
  assert.throws(() => parseOrderCsvRows('a"b,c'), /引用符/);
  assert.throws(() => parseOrderCsvRows('"a"bad,c'), /引用符/);
});

test("blank amount != zero; unsupported/unsafe money formats are rejected", () => {
  const { records } = parseRakutenOrder(recordsBytes([{ rewards: "", amount: "0" }]), meta());
  assert.equal(records[0].commissionAmount, null);
  assert.equal(records[0].merchandiseSalesAmount, 0);
  for (const rewards of ["1,000", "1.5", "-100", "9007199254740992", "NaN"]) assert.throws(() => parseRakutenOrder(recordsBytes([{ rewards }]), meta()), /整数/);
});

test("metadata must disclose currency/timezone/coverage/source/timestamps and never finalize month", () => {
  for (const change of [{ currency: null }, { timezone: "UNKNOWN" }, { coverage: null }, { filters: { status: 1 } }, { isSynthetic: undefined }, { retrievedAt: "2026-10-19T00:00:00Z" }]) assert.throws(() => parseRakutenOrder(zeroBytes, meta(change)));
  const { batch } = parseRakutenOrder(zeroBytes, meta({ snapshotAsOf: "2026-11-02T12:00:00+09:00", retrievedAt: "2026-11-02T12:01:00+09:00" }));
  assert.equal(batch.periodStatus, "ENDED_NOT_FINALIZED");
  assert.equal(batch.nonZeroRealDataVerified, false);
});

function parseRakutenOrder(bytes, metadata) { return parseOrder(bytes, metadata, { importedAt: "2026-12-01T00:00:00Z" }); }
