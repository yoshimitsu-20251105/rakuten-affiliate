// Phase 3A(非公開下書きページ生成)専用のオーケストレーション層。
// 承認ファイル・source runの検証 → 候補ごとのゲート判定 → 重複検出 → 決定的な
// HTMLテンプレート生成、までをまとめる。楽天/Google/Search Console APIは一切呼ばない
// (保存済みのsource runを読み取り専用で使うだけ)。
//
// 条件を1つでも満たさない候補が1件でもあれば、全件生成せず失敗として扱う
// (部分的な承認・部分的な生成は行わない)。

import { loadApprovalFile } from "./pilot-draft-approval.js";
import { loadSourceRun } from "./pilot-draft-source-run.js";
import { extractExistingSeedKeywords, listExistingRankingSlugs, findConflicts } from "./pilot-draft-conflict-check.js";
import { renderPilotDraftHtml } from "./pilot-draft-template.js";

const ATTRIBUTE_LABELS = {
  "species:dog": "犬用",
  "species:cat": "猫用",
  "lifeStage:puppy": "子犬向け",
  "lifeStage:kitten": "子猫向け",
  "lifeStage:senior": "シニア向け",
  "lifeStage:adult": "成犬・成猫向け",
  "productType:staple": "主食",
  "productType:treat": "おやつ",
  "productType:dry": "ドライタイプ",
  "productType:wet": "ウェットタイプ",
  "feature:domestic": "国産",
  "feature:additive-free": "無添加",
  "feature:grain-free": "グレインフリー",
  "feature:small-bite": "小粒",
  "purchaseCondition:small-pack": "小分け・お試しサイズ",
  "purchaseCondition:bulk": "まとめ買い・大容量",
  "purchaseCondition:free-shipping": "送料無料",
};

const MIN_ELIGIBLE_ITEMS = 3;

/**
 * 候補1件がPhase 3Aのすべてのゲートを満たすか検証する。
 * @param {any} candidate - loadSourceRun()のcandidatesByKeywordの1エントリ
 * @returns {string[]} 問題点(空配列なら問題なし)
 */
function validateCandidateGates(candidate) {
  const errors = [];
  if (!candidate) return ["source run内に該当するnormalizedKeywordが見つかりません"];
  if (candidate.businessValidated !== true) errors.push("businessValidatedがtrueではありません");
  if (candidate.decisionStatus !== "PRIORITY") errors.push(`decisionStatusがPRIORITYではありません(値: ${candidate.decisionStatus})`);
  if (candidate.eligibleForApproval !== true) errors.push("eligibleForApprovalがtrueではありません");
  if (candidate.safetyStatus !== "SAFE") errors.push(`safetyStatusがSAFEではありません(値: ${candidate.safetyStatus})`);
  if (candidate.queryQualityStatus !== "VALID") errors.push(`queryQualityStatusがVALIDではありません(値: ${candidate.queryQualityStatus})`);
  if (candidate.rakutenLookupStatus !== "SUCCESS") errors.push(`rakutenLookupStatusがSUCCESSではありません(値: ${candidate.rakutenLookupStatus})`);
  if (candidate.rakutenSupplyStatus !== "ELIGIBLE") errors.push(`rakutenSupplyStatusがELIGIBLEではありません(値: ${candidate.rakutenSupplyStatus})`);
  if (candidate.eligibleItemCount < MIN_ELIGIBLE_ITEMS) {
    errors.push(`楽天ELIGIBLE商品数が最低基準(${MIN_ELIGIBLE_ITEMS}件)未満です(実際: ${candidate.eligibleItemCount}件)`);
  }
  return errors;
}

/**
 * @param {{ sourceRunDir: string, approvedFilePath: string, projectRoot: string }} options
 * @returns {Promise<{
 *   ok: boolean,
 *   errors: string[],
 *   drafts?: Array<{ slug: string, normalizedKeyword: string, title: string, html: string }>,
 *   validationReportLines?: string[],
 *   sourceRunId?: string, candidateSetHash?: string, approvedFileHash?: string,
 * }>}
 */
export async function buildPilotDrafts({ sourceRunDir, approvedFilePath, projectRoot }) {
  const validationReportLines = [];
  const errors = [];

  const { valid: approvalValid, approval, approvedFileHash, errors: approvalErrors } = await loadApprovalFile(approvedFilePath);
  if (!approvalValid) {
    return { ok: false, errors: approvalErrors.map((e) => `[承認ファイル] ${e}`), validationReportLines };
  }
  validationReportLines.push(`承認ファイル: 検証OK(approvedFileHash=${approvedFileHash})`);

  const { valid: sourceRunValid, errors: sourceRunErrors, metadata, candidatesByKeyword } = await loadSourceRun(sourceRunDir);
  if (!sourceRunValid) {
    return { ok: false, errors: sourceRunErrors.map((e) => `[source run] ${e}`), validationReportLines, approvedFileHash };
  }
  validationReportLines.push(`source run: 検証OK(runId=${metadata.runId}, candidateSetHash=${metadata.candidateSetHash})`);

  if (approval.sourceRunId !== metadata.runId) {
    errors.push(
      `[整合性] 承認ファイルのsourceRunId「${approval.sourceRunId}」がsource runの実際のrunId「${metadata.runId}」と一致しません`
    );
  }
  if (approval.candidateSetHash !== metadata.candidateSetHash) {
    errors.push(
      `[整合性] 承認ファイルのcandidateSetHash「${approval.candidateSetHash}」がsource runの実際のcandidateSetHash「${metadata.candidateSetHash}」と一致しません`
    );
  }
  if (errors.length > 0) {
    return { ok: false, errors, validationReportLines, approvedFileHash, sourceRunId: metadata.runId, candidateSetHash: metadata.candidateSetHash };
  }
  validationReportLines.push("整合性: sourceRunId・candidateSetHashともに一致");

  // --- 重複検出の準備(既存サイト・既存パイプライン設定) ---
  let existingSeedKeywords, existingSlugs;
  try {
    existingSeedKeywords = await extractExistingSeedKeywords(projectRoot);
    existingSlugs = listExistingRankingSlugs(`${projectRoot}/docs/rankings`);
  } catch (e) {
    // 抽出自体に失敗した場合は安全側に倒し、全件を拒否する。
    return {
      ok: false,
      errors: [`[重複検出] 既存キーワード/slugの抽出に失敗したため安全のため生成を拒否します: ${e.message}`],
      validationReportLines,
      approvedFileHash,
      sourceRunId: metadata.runId,
      candidateSetHash: metadata.candidateSetHash,
    };
  }
  validationReportLines.push(`重複検出用データ: 既存シードキーワード${existingSeedKeywords.length}件、既存ランキングslug${existingSlugs.length}件を読み込み`);

  const batchSlugs = approval.keywords.map((k) => k.slug);

  // --- 候補ごとのゲート検証 + 重複検出(1件でも失敗すれば全件拒否) ---
  const perCandidateResults = [];
  for (const kw of approval.keywords) {
    const candidate = candidatesByKeyword.get(kw.normalizedKeyword);
    const gateErrors = validateCandidateGates(candidate);
    const conflicts = findConflicts({ normalizedKeyword: kw.normalizedKeyword, slug: kw.slug }, { existingSlugs, existingSeedKeywords, batchSlugs });
    perCandidateResults.push({ kw, candidate, gateErrors, conflicts });
    for (const e of gateErrors) errors.push(`[${kw.normalizedKeyword}] ${e}`);
    for (const c of conflicts) errors.push(`[${kw.normalizedKeyword}] ${c}`);
  }

  validationReportLines.push(...perCandidateResults.map((r) => {
    const status = r.gateErrors.length === 0 && r.conflicts.length === 0 ? "OK" : "NG";
    return `候補「${r.kw.normalizedKeyword}」(slug=${r.kw.slug}): ${status}${r.gateErrors.length + r.conflicts.length > 0 ? " — " + [...r.gateErrors, ...r.conflicts].join(" / ") : ""}`;
  }));

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      validationReportLines,
      approvedFileHash,
      sourceRunId: metadata.runId,
      candidateSetHash: metadata.candidateSetHash,
    };
  }

  // --- すべてのゲートを通過。決定的なHTML生成 ---
  const drafts = perCandidateResults.map(({ kw, candidate }) => {
    const html = renderPilotDraftHtml({
      title: kw.title,
      slug: kw.slug,
      normalizedKeyword: kw.normalizedKeyword,
      originalKeyword: candidate.originalKeyword,
      cluster: candidate.cluster,
      monthlySearches: candidate.monthlySearches,
      finalPriority: candidate.finalPriority,
      webKeywordScoreTotal: candidate.webKeywordScoreTotal,
      eligibleItems: candidate.eligibleItems,
      requiredAttributeLabels: candidate.matchedAttributes.map((t) => ATTRIBUTE_LABELS[t] ?? t),
      dataRetrievedAt: metadata.executedAt,
      sourceRunId: metadata.runId,
    });
    return { slug: kw.slug, normalizedKeyword: kw.normalizedKeyword, title: kw.title, html };
  });

  return {
    ok: true,
    errors: [],
    drafts,
    validationReportLines,
    approvedFileHash,
    sourceRunId: metadata.runId,
    candidateSetHash: metadata.candidateSetHash,
  };
}
