import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateQuality, WEIGHTS, THRESHOLD } from "../../revenue-foundation/quality-gate.js";

const asOf = "2026-11-26T00:00:00Z";
const targetUrl = "https://example.com/page";
const quote = "2商品の1食あたりの単価と内容量を比較しました";
const hash = (html) => createHash("sha256").update(html).digest("hex");
const gates = ["affiliateCompliance", "fakeExperience", "scaledContentRisk", "requiredEvidence"];
const html = (extra = "") => `<!doctype html><html><head><title>猫用フードの比較 | 商品案内</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><main><h1>猫用フードの比較</h1><p>${quote}。</p>
<p>内容量の違いをそろえるため、表示価格を食数で割り、1食ごとの金額を計算しています。
比較表では内容量、価格、1食あたりの単価を示します。購入前に販売店で在庫と送料を確認してください。</p>
<p>このページはアフィリエイト広告を含みます。</p>
<a href="/guides">選び方を見る</a>
<a href="https://hb.afl.rakuten.co.jp/hgc/example" rel="nofollow sponsored">在庫を確認</a>
<p>${extra}</p></main></body></html>`;

function configuration(page = html()) {
  const targetHash = hash(page);
  const input = { schemaVersion: 1, targetUrl, html: page, targetHash, asOf };
  const observations = {
    searchIntentFit: { query: "猫用フード 比較", reviewedResults: 5, intent: "COMMERCIAL", pageQuote: quote },
    originalAnalysis: { pageQuote: quote, method: "UNIT_COST", independentInputs: 2, reproducible: true },
    comparisonSpecificity: { pageQuote: quote, comparedProducts: 2, comparisonCriteria: 2 },
    freshness: { checkedAt: asOf, materialFactsCurrent: true },
    evidence: { pageQuote: quote, checkedClaims: 2, supportedClaims: 2 },
    performance: { device: "MOBILE", lcpMs: 2000, inpMs: 100, cls: 0.03 },
    ctaFit: { linkLabel: "在庫を確認", destinationMatches: true },
    scaledContentRisk: { comparedPages: 5, maxSimilarity: 0.3, doorwayPages: 0, thinPages: 0 },
  };
  const verifiedEvidence = Object.entries(observations).map(([appliesTo, observation]) => ({
    id: `review-${appliesTo}`, sourceRef: `review:fixture/${appliesTo}`, evidenceType: "FACT",
    isSynthetic: false, appliesTo, targetHash, observedAt: asOf, observation,
  }));
  const evaluate = () => evaluateQuality(input, { verifiedEvidence });
  const observation = (name) => verifiedEvidence.find((item) => item.appliesTo === name).observation;
  return { input, verifiedEvidence, evaluate, observation };
}

function declareFullScores(input) {
  input.gates = Object.fromEntries(gates.map((gate) => [gate, { status: "PASS", evidenceRefs: ["e1"] }]));
  input.dimensions = Object.fromEntries(Object.entries(WEIGHTS).map(([name, points]) => [name, { points, evidenceRefs: ["e1"] }]));
  return input;
}

test("Claude B1 reproducer cannot pass with one caller-supplied generic FACT", () => {
  const e1 = { id: "e1", sourceRef: "x", evidenceType: "FACT", isSynthetic: false };
  const input = declareFullScores({ schemaVersion: 1, evidence: [e1] });
  const result = evaluateQuality(input, { verifiedEvidence: [e1] });
  assert.equal(result.targetHash, null);
  assert.equal(result.score, 0);
  assert.equal(result.status, "UNKNOWN");
  assert.deepEqual(Object.values(result.hardGates), gates.map(() => "UNKNOWN"));
});

test("One bound FACT supports only its named dimension even when every dimension cites it", () => {
  const { input, verifiedEvidence } = configuration();
  const row = { ...verifiedEvidence[0], id: "e1" };
  const result = evaluateQuality(declareFullScores(input), { verifiedEvidence: [row] });
  assert.deepEqual(result.dimensions.searchIntentFit.evidenceRefs, ["e1"]);
  assert.equal(result.dimensions.originalAnalysis.points, null);
  assert.equal(result.hardGates.scaledContentRisk, "UNKNOWN");
  assert.notEqual(result.status, "PASS");
});

test("Verified evidence is selected independently of caller claims and computed hash binds the bytes", () => {
  const { input, verifiedEvidence, evaluate } = configuration();
  input.evidence = verifiedEvidence;
  assert.equal(evaluateQuality(input).hardGates.requiredEvidence, "UNKNOWN");
  verifiedEvidence[0].targetHash = "0".repeat(64);
  assert.equal(evaluate().dimensions.searchIntentFit.points, null);
  input.targetHash = "0".repeat(64);
  assert.equal(evaluate().targetHash, hash(input.html));
  assert.equal(evaluate().status, "FAIL");
});

test("Wrong applicability, missing provenance, synthetic and stale observations earn no points", () => {
  const { verifiedEvidence, evaluate } = configuration();
  verifiedEvidence[0].appliesTo = "originalAnalysis";
  assert.equal(evaluate().dimensions.searchIntentFit.points, null);
  assert.deepEqual(evaluate().dimensions.originalAnalysis.evidenceRefs, ["review-originalAnalysis"]);
  verifiedEvidence.find((row) => row.appliesTo === "freshness").observedAt = "2025-11-26T00:00:00Z";
  verifiedEvidence.find((row) => row.appliesTo === "performance").isSynthetic = true;
  verifiedEvidence.find((row) => row.appliesTo === "evidence").sourceRef = "";
  const result = evaluate();
  for (const name of ["freshness", "performance", "evidence"]) assert.equal(result.dimensions[name].points, null);
  assert.equal(result.hardGates.requiredEvidence, "UNKNOWN");
});

test("Fake-experience PASS declaration cannot compensate for missing content", () => {
  const { input, evaluate } = configuration();
  delete input.html;
  declareFullScores(input);
  assert.equal(evaluate().hardGates.fakeExperience, "UNKNOWN");
  assert.notEqual(evaluate().status, "PASS");
});

for (const claim of [
  "実際に使った", "実際に使ってみました", "使ってみました", "試した", "試してみた", "試してみました",
  "食べてみた", "実食", "実食レビュー", "愛用", "毎日使っています", "筆者が使用", "購入して確かめた",
  "愛犬が食べた", "愛猫が食べた", "愛猫が喜んで食べました", "実際に使って<span>みました</span>",
]) test(`Visible unsupported first-hand claim fails: ${claim}`, () => {
  const { input, evaluate } = configuration(html(claim));
  declareFullScores(input);
  const result = evaluate();
  assert.equal(result.score, 100);
  assert.equal(result.hardGates.fakeExperience, "FAIL");
  assert.equal(result.status, "FAIL");
});

test("Negations, retailer text without a first-hand claim, and script or comment text do not trigger a false match", () => {
  const { evaluate } = configuration(html("愛用していません。実食レビューではありません。食べ方を紹介します。<!-- 試した --><script>const label = '実食';</script>"));
  assert.equal(evaluate().hardGates.fakeExperience, "PASS");
  assert.equal(evaluate().status, "PASS");
});

test("Direct first-hand evidence must match the expressed claim and can explicitly contradict it", () => {
  const claim = "実際に使ってみました";
  const { input, verifiedEvidence, evaluate } = configuration(html(claim));
  const row = { ...verifiedEvidence[0], id: "direct-test", appliesTo: "fakeExperience", targetHash: input.targetHash,
    observation: { claim, actualUse: "USED" } };
  verifiedEvidence.push(row);
  assert.equal(evaluate().hardGates.fakeExperience, "PASS");
  row.observation.actualUse = "NOT_USED";
  assert.equal(evaluate().hardGates.fakeExperience, "FAIL");
});

for (const name of ["originalAnalysis", "searchIntentFit", "evidence"]) test(`Missing required ${name} blocks an otherwise passing score`, () => {
  const { verifiedEvidence, evaluate } = configuration();
  verifiedEvidence.splice(verifiedEvidence.findIndex((item) => item.appliesTo === name), 1);
  const result = evaluate();
  assert.ok(result.score >= 80);
  assert.equal(result.dimensions[name].points, null);
  assert.equal(result.hardGates.requiredEvidence, "UNKNOWN");
  assert.equal(result.status, "UNKNOWN");
});

test("HTML checks and measured values override caller points, and missing HTML signals stay unknown", () => {
  const page = html().replace(/<title>.*?<\/title>/, "").replace(/<meta name="viewport"[^>]*>/, "").replace(/<a href="\/guides">.*?<\/a>/, "");
  const { input, evaluate, observation } = configuration(page);
  declareFullScores(input);
  observation("performance").cls = 0.15;
  const d = evaluate().dimensions;
  assert.equal(d.titleH1Alignment.points, null);
  assert.equal(d.mobileUX.points, null);
  assert.equal(d.internalLinks.points, 0);
  assert.equal(d.performance.points, 4);
});

test("Legitimate 80 passes deterministically; a measured one-point regression fails at 79", () => {
  const { input, evaluate, observation } = configuration();
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b), 100);
  assert.equal(THRESHOLD, 80);
  observation("comparisonSpecificity").comparisonCriteria = 1;
  observation("ctaFit").destinationMatches = false;
  const legitimate = evaluate();
  assert.equal(legitimate.targetHash, hash(input.html));
  assert.equal(legitimate.score, 80);
  assert.deepEqual(Object.values(legitimate.hardGates), gates.map(() => "PASS"));
  assert.equal(legitimate.status, "PASS");
  assert.deepEqual(legitimate, evaluate());
  observation("performance").cls = 0.15;
  assert.equal(evaluate().score, 79);
  assert.equal(evaluate().status, "FAIL");
});

for (const [name, page] of [
  ["missing disclosure", html().replace("このページはアフィリエイト広告を含みます。", "")],
  ["hidden disclosure", html().replace("<p>このページは", "<p hidden>このページは")],
  ["missing sponsored rel", html().replace("nofollow sponsored", "nofollow")],
]) test(`Affiliate hard gate rejects ${name}`, () => {
  const result = configuration(page).evaluate();
  assert.equal(result.hardGates.affiliateCompliance, "FAIL");
  assert.equal(result.status, "FAIL");
});

for (const [key, value] of [["maxSimilarity", 0.95], ["doorwayPages", 1], ["thinPages", 1]]) {
  test(`Scaled-content hard gate fails from measured ${key}, even at 100 points`, () => {
    const { evaluate, observation } = configuration();
    observation("scaledContentRisk")[key] = value;
    assert.equal(evaluate().score, 100);
    assert.equal(evaluate().hardGates.scaledContentRisk, "FAIL");
    assert.equal(evaluate().status, "FAIL");
  });
}

test("Measured unsupported material evidence fails the required-evidence gate", () => {
  const { evaluate, observation } = configuration();
  observation("evidence").supportedClaims = 1;
  assert.equal(evaluate().dimensions.evidence.points, 0);
  assert.equal(evaluate().hardGates.requiredEvidence, "FAIL");
  assert.equal(evaluate().status, "FAIL");
});

test("Quality CLI requires the independently supplied evidence register for a passing artifact", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quality-gate-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { input, verifiedEvidence } = configuration();
  const artifact = join(root, "artifact.json");
  const register = join(root, "verified-observations.json");
  await writeFile(artifact, JSON.stringify({ ...input, evidence: verifiedEvidence }));
  await writeFile(register, JSON.stringify(verifiedEvidence));
  const cli = fileURLToPath(new URL("../../revenue-foundation/cli.js", import.meta.url));
  const run = (...args) => {
    const child = spawnSync(process.execPath, [cli, "quality", artifact, ...args], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  };
  assert.equal(run().status, "UNKNOWN");
  assert.equal(run(register).status, "PASS");
});
