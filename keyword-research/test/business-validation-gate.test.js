// 【2026-09-05監査対応】businessValidatedを承認・出力・公開のゲートとして強制することの
// 専用テスト。「スコアが高い(scoreBand=PRIORITY)」ことと「実運用可能(businessValidated=true)」
// が別物であることを、pipeline全体を通して確認する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runResearch, runMapRakuten } from "../pipeline.js";
import { writeReports } from "../report.js";
import { isPublishEligible } from "../approval.js";
import { evaluateDecision } from "../decision.js";

const RAKUTEN_FIXTURE = JSON.parse(
  await readFile(new URL("../fixtures/rakuten-items.fixture.json", import.meta.url), "utf-8")
);

async function mockSearch(keyword) {
  const tokens = keyword.split(" ").filter(Boolean);
  const items = RAKUTEN_FIXTURE.filter((item) => {
    const text = `${item.itemName} ${item.catchcopy}`;
    const hit = tokens.filter((t) => text.includes(t)).length;
    return tokens.length === 0 || hit / tokens.length >= 0.34;
  });
  return { items, count: items.length, source: "mock" };
}

test("fixtureで高得点(scoreBand=PRIORITY)でも、businessValidated=falseなら承認不可(eligibleForApproval=false, decisionStatus=UNVALIDATED)", async () => {
  const researchResult = await runResearch({}); // manualCsvPath未指定 → fixtureソース
  const mapped = await runMapRakuten(researchResult, { searchFn: mockSearch });

  const priorityCandidates = mapped.filter((c) => c.scoreBand === "PRIORITY");
  assert.ok(priorityCandidates.length > 0, "fixtureデータでもscoreBand=PRIORITYの候補が算出される前提");

  for (const c of priorityCandidates) {
    assert.equal(c.businessValidated, false, "fixtureソースなのでbusinessValidatedは常にfalse");
    assert.equal(c.decisionStatus, "UNVALIDATED", `scoreBand=PRIORITYでもdecisionStatusはUNVALIDATED("${c.canonicalKeyword}")`);
    assert.equal(c.eligibleForApproval, false);
    assert.equal(c.eligibleForExport, false);
    assert.equal(c.eligibleForPublish, false);
    assert.ok(c.validationFailureReasons.includes("BUSINESS_DATA_NOT_VALIDATED"));
  }
});

test("isSynthetic=trueの観測データは、スコア成分が高くてもeligibleForApproval=falseになる", () => {
  const decision = evaluateDecision({
    businessValidated: false, // isSynthetic=trueの結果としてscoring.jsが返す値
    scoreBand: "PRIORITY",
    intent: "CONDITION_PURCHASE",
    eligibleRakutenCount: 10,
    bestProductQualityScore: 95,
  });
  assert.equal(decision.decisionStatus, "UNVALIDATED");
  assert.equal(decision.eligibleForApproval, false);
  assert.equal(decision.eligibleForExport, false);
  assert.equal(decision.eligibleForPublish, false);
});

test("trusted providerでも必須データ(検索量等)が不足していればbusinessValidated=falseとなり承認不可", () => {
  // scoring.js側でsourceProviderが信頼できても検索量等が欠損していればbusinessValidated=falseになる
  // (test/scoring.test.jsで判定表として検証済み)。ここではその結果を受けたdecision.jsの挙動を確認する。
  const decision = evaluateDecision({
    businessValidated: false,
    scoreBand: "TEST",
    intent: "CONDITION_PURCHASE",
    eligibleRakutenCount: 5,
    bestProductQualityScore: 80,
  });
  assert.equal(decision.eligibleForApproval, false);
  assert.equal(decision.validationFailureReasons.includes("BUSINESS_DATA_NOT_VALIDATED"), true);
});

test("businessValidated=trueの実データのみ承認可能(eligibleForApproval=true)になる", () => {
  const decision = evaluateDecision({
    businessValidated: true,
    scoreBand: "PRIORITY",
    intent: "CONDITION_PURCHASE",
    eligibleRakutenCount: 5,
    bestProductQualityScore: 80,
  });
  assert.equal(decision.decisionStatus, "PRIORITY");
  assert.equal(decision.eligibleForApproval, true);
  assert.equal(decision.eligibleForExport, true);
  // Phase 3(既存サイトへの実接続)は未実装のため、businessValidated=trueでもeligibleForPublishは常にfalse
  assert.equal(decision.eligibleForPublish, false);
});

test("businessValidated=trueでもscoreBand=REJECTなら承認不可(スコアが低い実データ)", () => {
  const decision = evaluateDecision({
    businessValidated: true,
    scoreBand: "REJECT",
    intent: "CONDITION_PURCHASE",
    eligibleRakutenCount: 5,
    bestProductQualityScore: 80,
  });
  assert.equal(decision.decisionStatus, "REJECT");
  assert.equal(decision.eligibleForApproval, false);
});

test("export-approvedが未検証候補(businessValidated=false)を理由付きで拒否する(承認ファイルに含まれていても)", async () => {
  const researchResult = await runResearch({});
  const mapped = await runMapRakuten(researchResult, { searchFn: mockSearch });

  const priorityCandidate = mapped.find((c) => c.scoreBand === "PRIORITY");
  assert.ok(priorityCandidate);

  // 人間が(誤って)承認ファイルにこのキーワードを含めたケースを再現する
  const canonicalApprovedSet = new Set([priorityCandidate.canonicalKeyword]);
  const check = isPublishEligible(
    {
      canonicalKeyword: priorityCandidate.canonicalKeyword,
      matchStatus: priorityCandidate.rakuten.eligibleCount > 0 ? "ELIGIBLE" : "REJECTED",
      intent: priorityCandidate.intent,
      hasQualityScore: priorityCandidate.bestProductQualityScore > 0,
      businessValidated: priorityCandidate.businessValidated,
    },
    canonicalApprovedSet
  );

  assert.equal(check.eligible, false, "承認ファイルに含まれていてもbusinessValidated=falseなら出力されない");
  assert.ok(check.reasons.includes("BUSINESS_DATA_NOT_VALIDATED"));
});

test("businessValidated=0件のfixtureのみのレポートでは、実運用上の優先候補・承認可能候補・出力可能候補がすべて0件になる", async () => {
  const researchResult = await runResearch({});
  const mapped = await runMapRakuten(researchResult, { searchFn: mockSearch });
  const outDir = `keyword-research/output/__test-gate-report-${Date.now()}`;

  const { counts } = await writeReports(
    { candidates: mapped, sourceMetas: researchResult.sourceMetas, config: researchResult.config },
    { outDir, mode: "dry-run", runId: "test" }
  );

  assert.equal(counts.businessValidatedCount, 0, "fixtureのみのためbusinessValidated=trueは0件のはず");
  assert.equal(counts.operationalPriorityCount, 0, "実運用上の優先候補は0件でなければならない");
  assert.equal(counts.eligibleForApprovalCount, 0, "承認可能候補は0件でなければならない");
  assert.equal(counts.eligibleForExportCount, 0, "出力可能候補は0件でなければならない");
  // スコア上のPRIORITY(simulation)は0件より多いはず(この乖離こそが今回の監査の要点)
  assert.ok(counts.priorityCount > 0, "スコア上のPRIORITY相当は0件より多いはず(businessValidatedとは別物)");

  const summary = await readFile(`${outDir}/summary.md`, "utf-8");
  assert.match(summary, /businessValidated=trueが0件のため/);

  const { rm } = await import("node:fs/promises");
  await rm(outDir, { recursive: true, force: true });
});

test("旧keywords:publishシムは、export-approved.jsへ委譲するだけで独自の承認・出力ロジックを持たない(バイパス防止の構造的確認)", async () => {
  const publishSrc = await readFile(fileURLToPath(new URL("../cli/publish.js", import.meta.url)), "utf-8");
  // 独自にisPublishEligibleやcanonicalApprovedSetのフィルタリングを実装していない
  // (=export-approved.jsと同じチェックを必ず通る)ことを確認する
  assert.ok(!publishSrc.includes("isPublishEligible"), "publish.jsが独自に承認判定を実装していないこと");
  assert.ok(!publishSrc.includes("canonicalApprovedSet"), "publish.jsが独自に承認ファイルを解釈していないこと");
  assert.match(publishSrc, /export-approved\.js/, "publish.jsがexport-approved.jsへ委譲していること");
  assert.match(publishSrc, /spawnSync/, "子プロセスとして実行し、ロジックを重複実装していないこと");
});
