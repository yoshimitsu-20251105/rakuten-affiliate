#!/usr/bin/env node
// npm run keywords:export-approved -- --approved-file <path>
//
// 【重要】この時点(Phase 1)では、既存のページ生成処理(generate-site.js)への
// 自動反映は未実装です(仕様10章の通り、承認ゲートの後ろ=Phase 3の範囲)。
// このコマンドは「承認済み・楽天照合ELIGIBLE・Quality Score計算済み・医療関連でない」
// 候補だけを抽出して keyword-research/output/approved-candidates.json に書き出すところまでを行い、
// 公開ページ・articles-data.json・selected-products.json・commit・pushには一切触れません。
// サイトへの公開は行いません(コマンド名を旧keywords:publishから変更した理由もこれです)。

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { loadApprovalFile, isPublishEligible } from "../approval.js";
import { parseArgs, nowJstIso } from "./args.js";

const OUTPUT_DIR = new URL("../output/", import.meta.url);
const LOG_PREFIX = "[keywords:export-approved]";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args["approved-file"]) {
    console.error(`${LOG_PREFIX} --approved-file <path> の指定が必須です`);
    process.exitCode = 1;
    return;
  }

  let parsed;
  try {
    const raw = await readFile(new URL("latest-matches.json", OUTPUT_DIR), "utf-8");
    parsed = JSON.parse(raw);
  } catch {
    console.error(`${LOG_PREFIX} latest-matches.json が見つかりません。先に keywords:map-rakuten を実行してください。`);
    process.exitCode = 1;
    return;
  }

  const { valid, errors, canonicalApprovedSet, raw: approvalRaw } = await loadApprovalFile(args["approved-file"], parsed.config);
  if (!valid) {
    console.error(`${LOG_PREFIX} 承認ファイルが不正です:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }

  const approved = [];
  const blocked = [];
  for (const c of parsed.candidates) {
    const check = isPublishEligible(
      {
        canonicalKeyword: c.canonicalKeyword,
        matchStatus: c.rakuten.eligibleCount > 0 ? "ELIGIBLE" : "REJECTED",
        intent: c.intent,
        hasQualityScore: c.bestProductQualityScore > 0,
        businessValidated: c.businessValidated ?? false,
      },
      canonicalApprovedSet
    );
    if (check.eligible) {
      approved.push({
        canonicalKeyword: c.canonicalKeyword,
        cluster: c.cluster.clusterLabel,
        intent: c.intent,
        finalPriority: c.finalPriority,
        scoreBand: c.scoreBand,
        decisionStatus: c.decisionStatus,
        eligibleItemCodes: (c.rakuten.matches ?? []).filter((m) => m.status === "ELIGIBLE").map((m) => m.itemCode),
        bestProductQualityScore: c.bestProductQualityScore,
        businessValidated: c.businessValidated ?? false,
      });
    } else {
      blocked.push({ canonicalKeyword: c.canonicalKeyword, reasons: check.reasons });
    }
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const outPath = new URL("approved-candidates.json", OUTPUT_DIR);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: nowJstIso(),
        approvedBy: approvalRaw.approvedBy ?? null,
        approvedAt: approvalRaw.approvedAt ?? null,
        approved,
        blockedCount: blocked.length,
        note:
          "Phase 1時点の出力です。このコマンドはサイトへの公開を一切行いません。既存ページ生成(generate-site.js)への" +
          "接続はPhase 3で実装予定であり、このファイルはまだ何も公開していません(承認済み候補のmanifestを出力するのみ)。",
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`${LOG_PREFIX} 承認・要件充足: ${approved.length}件 / ブロック: ${blocked.length}件`);
  for (const b of blocked) console.log(`  - BLOCKED "${b.canonicalKeyword}": ${b.reasons.join(", ")}`);
  console.log(`出力: keyword-research/output/approved-candidates.json`);
  console.log(`このコマンドはサイトへの公開を行っていません(公開ページ・本番状態・commit・pushは無変更。既存生成処理への接続はPhase 3で未実装)。`);
}

main().catch((e) => {
  console.error(`${LOG_PREFIX} エラー: ${e.message}`);
  process.exitCode = 1;
});
