// Phase 3A(非公開下書きページ生成)専用のオーケストレーション層。
// 承認ファイル・source runの検証 → 候補ごとのゲート判定 → 商品単位の安全確認 →
// 重複検出 → 決定的なHTMLテンプレート生成、までをまとめる。楽天/Google/
// Search Console APIは一切呼ばない(保存済みのsource runを読み取り専用で使うだけ)。
//
// 条件を1つでも満たさない候補が1件でもあれば、全件生成せず失敗として扱う
// (部分的な承認・部分的な生成は行わない)。
//
// 【2026-09-07 PR#5監査対応】以下を追加した:
//   - source runの検証がより厳格化された(pilot-draft-source-run.js参照)。
//   - 商品単位の安全ゲート(itemName/catchcopyの医療・健康表現検査)を追加し、
//     除外後に3件未満なら候補全体を拒否する。
//   - 表示商品の数値フィールド(qualityScore/itemPrice/reviewAverage/reviewCount)を
//     型検証し、不正値があればsource run不整合として拒否する。
//   - 承認ファイルのapprovedAtがsource runのexecutedAt以後であることを確認する。
//
// 【2026-09-07 PR#6対応】商品関連性ゲート(pilot-draft-item-relevance.js)を追加した。
//   猫用ランキングへ犬用商品(SEOキーワード詰め込みでitemNameに両方の動物種を含む)が
//   混入した実例(「キャットフード グレインフリー」で犬用おやつが1位表示)を受け、
//   医療・健康安全確認の後、pageReadyItems確定の前に、保存済み商品データへ独立に
//   関連性判定を再適用する(旧source runが旧rakuten-match.jsでELIGIBLEにしていても
//   下書きへ混入させないための多層防御。楽天API再実行は不要)。

import { loadConfig } from "./config.js";
import { loadApprovalFile } from "./pilot-draft-approval.js";
import { loadSourceRun, MIN_ELIGIBLE_ITEMS } from "./pilot-draft-source-run.js";
import { extractExistingSeedKeywords, listExistingRankingSlugs, findConflicts } from "./pilot-draft-conflict-check.js";
import { filterSafeItems } from "./pilot-draft-item-safety.js";
import { filterRelevantItems } from "./pilot-draft-item-relevance.js";
import { validateItemsNumericFields } from "./pilot-draft-item-validation.js";
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

const MAX_DISPLAY_ITEMS = 5;

/**
 * 候補1件がsource run由来のゲートを満たすか検証する(商品単位の安全確認・数値検証は含まない、
 * こちらは別途processCandidateItems()で行う)。
 * @param {any} candidate - loadSourceRun()のcandidatesByKeywordの1エントリ
 * @returns {string[]} 問題点(空配列なら問題なし)
 */
function validateCandidateGates(candidate) {
  const errors = [];
  if (!candidate) return ["source run内に該当するnormalizedKeywordが見つかりません"];
  if (candidate.dataIntegrityErrors && candidate.dataIntegrityErrors.length > 0) {
    return candidate.dataIntegrityErrors.map((e) => `[データ整合性] ${e}`);
  }
  if (candidate.businessValidated !== true) errors.push("businessValidatedがtrueではありません");
  if (candidate.decisionStatus !== "PRIORITY") errors.push(`decisionStatusがPRIORITYではありません(値: ${candidate.decisionStatus})`);
  if (candidate.eligibleForApproval !== true) errors.push("eligibleForApprovalがtrueではありません");
  if (candidate.safetyStatus !== "SAFE") errors.push(`safetyStatusがSAFEではありません(値: ${candidate.safetyStatus})`);
  if (candidate.queryQualityStatus !== "VALID") errors.push(`queryQualityStatusがVALIDではありません(値: ${candidate.queryQualityStatus})`);
  if (candidate.rakutenLookupStatus !== "SUCCESS") errors.push(`rakutenLookupStatusがSUCCESSではありません(値: ${candidate.rakutenLookupStatus})`);
  if (candidate.rakutenSupplyStatus !== "ELIGIBLE") errors.push(`rakutenSupplyStatusがELIGIBLEではありません(値: ${candidate.rakutenSupplyStatus})`);
  if (candidate.eligibleItemCount < MIN_ELIGIBLE_ITEMS) {
    errors.push(`楽天ELIGIBLE商品数が最低基準(${MIN_ELIGIBLE_ITEMS}件)未満です(実際: ${candidate.eligibleItemCount}件、照合結果と商品表示データを突き合わせ済み)`);
  }
  return errors;
}

/**
 * 候補1件の表示商品を処理する: 数値フィールド検証 → 商品単位の安全フィルタ →
 * 商品単位の関連性フィルタ(2026-09-07 PR#6対応) → ページ掲載可能商品(pageReadyItems)の決定。
 * @param {any} candidate
 * @param {any} safetyConfig
 * @returns {{
 *   errors: string[], pageReadyItems: any[],
 *   excludedUnsafeItems: Array<{itemCode:string, reasonCode:string}>,
 *   excludedIrrelevantItems: Array<{itemCode:string, reasonCodes:string[]}>,
 * }}
 */
function processCandidateItems(candidate, safetyConfig) {
  const numericErrors = validateItemsNumericFields(candidate.eligibleItems);
  if (numericErrors.length > 0) {
    return { errors: numericErrors, pageReadyItems: [], excludedUnsafeItems: [], excludedIrrelevantItems: [] };
  }

  const { safeItems, excludedUnsafeItems } = filterSafeItems(candidate.eligibleItems, safetyConfig);
  if (safeItems.length < MIN_ELIGIBLE_ITEMS) {
    return {
      errors: [
        `商品単位の安全確認(itemName/catchcopyの医療・健康表現検査)で${excludedUnsafeItems.length}件を除外した結果、` +
          `残り${safeItems.length}件となり最低基準(${MIN_ELIGIBLE_ITEMS}件)未満です`,
      ],
      pageReadyItems: [],
      excludedUnsafeItems,
      excludedIrrelevantItems: [],
    };
  }

  // 【2026-09-07 PR#6対応】商品関連性ゲート。医療・健康安全確認を通過した商品に対し、
  // itemName優先の関連性判定(product-relevance.js)を独立に再適用する。
  const { relevantItems, excludedIrrelevantItems } = filterRelevantItems(safeItems, candidate.requiredAttributes);
  if (relevantItems.length < MIN_ELIGIBLE_ITEMS) {
    return {
      errors: [
        `商品関連性確認(動物種・主食/おやつの矛盾検査)で${excludedIrrelevantItems.length}件を除外した結果、` +
          `残り${relevantItems.length}件となり最低基準(${MIN_ELIGIBLE_ITEMS}件)未満です`,
      ],
      pageReadyItems: [],
      excludedUnsafeItems,
      excludedIrrelevantItems,
    };
  }

  const pageReadyItems = [...relevantItems].sort((a, b) => b.qualityScore - a.qualityScore).slice(0, MAX_DISPLAY_ITEMS);
  return { errors: [], pageReadyItems, excludedUnsafeItems, excludedIrrelevantItems };
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
  validationReportLines.push(`artifact hash検証: 4ファイルすべて一致(改変なし)`);

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
  if (Date.parse(approval.approvedAt) < Date.parse(metadata.executedAt)) {
    errors.push(
      `[整合性] 承認ファイルのapprovedAt(${approval.approvedAt})がsource runのexecutedAt(${metadata.executedAt})より前です` +
        `(source run生成後に承認されている必要があります)`
    );
  }
  if (errors.length > 0) {
    return { ok: false, errors, validationReportLines, approvedFileHash, sourceRunId: metadata.runId, candidateSetHash: metadata.candidateSetHash };
  }
  validationReportLines.push("整合性: sourceRunId・candidateSetHash・approvedAtの前後関係、いずれもOK");

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

  const safetyConfig = await loadConfig();
  const batchSlugs = approval.keywords.map((k) => k.slug);

  // --- 候補ごとのゲート検証(source run由来) + 商品単位の安全/数値検証 + 重複検出
  //     (1件でも失敗すれば全件拒否) ---
  const perCandidateResults = [];
  let totalExcludedUnsafeCount = 0;
  const relevanceReasonCodeCounts = {};
  let totalExcludedIrrelevantCount = 0;
  for (const kw of approval.keywords) {
    const candidate = candidatesByKeyword.get(kw.normalizedKeyword);
    const gateErrors = validateCandidateGates(candidate);
    let itemResult = { errors: [], pageReadyItems: [], excludedUnsafeItems: [], excludedIrrelevantItems: [] };
    if (gateErrors.length === 0) {
      itemResult = processCandidateItems(candidate, safetyConfig);
    }
    const conflicts = findConflicts({ normalizedKeyword: kw.normalizedKeyword, slug: kw.slug }, { existingSlugs, existingSeedKeywords, batchSlugs });
    totalExcludedUnsafeCount += itemResult.excludedUnsafeItems.length;
    totalExcludedIrrelevantCount += itemResult.excludedIrrelevantItems.length;
    for (const excluded of itemResult.excludedIrrelevantItems) {
      // 【2026-09-07 PR#6追加監査対応】理由コード無しでの除外は許さない(fail closed)。
      // filterRelevantItemsは非RELEVANT判定に必ずreasonCodesを付与する設計だが、
      // 万一空になった場合はバグとして扱い、静かに握りつぶさず全件拒否する。
      if (!excluded.reasonCodes || excluded.reasonCodes.length === 0) {
        errors.push(`[${kw.normalizedKeyword}] 内部エラー: itemCode「${excluded.itemCode}」が理由コード無しで関連性除外されました(fail closed)`);
      }
      for (const code of excluded.reasonCodes ?? []) {
        relevanceReasonCodeCounts[code] = (relevanceReasonCodeCounts[code] ?? 0) + 1;
      }
    }
    for (const excluded of itemResult.excludedUnsafeItems) {
      if (!excluded.reasonCode) {
        errors.push(`[${kw.normalizedKeyword}] 内部エラー: itemCode「${excluded.itemCode}」が理由コード無しで安全除外されました(fail closed)`);
      }
    }
    perCandidateResults.push({
      kw,
      candidate,
      gateErrors,
      itemErrors: itemResult.errors,
      pageReadyItems: itemResult.pageReadyItems,
      conflicts,
      excludedUnsafeItems: itemResult.excludedUnsafeItems,
      excludedIrrelevantItems: itemResult.excludedIrrelevantItems,
    });
    for (const e of gateErrors) errors.push(`[${kw.normalizedKeyword}] ${e}`);
    for (const e of itemResult.errors) errors.push(`[${kw.normalizedKeyword}] ${e}`);
    for (const c of conflicts) errors.push(`[${kw.normalizedKeyword}] ${c}`);
  }

  validationReportLines.push(`商品単位の安全確認: 合計${totalExcludedUnsafeCount}件を除外(itemCodeと理由コードのみ記録、seller文言は記録しない)`);
  validationReportLines.push(
    `商品単位の関連性確認: 合計${totalExcludedIrrelevantCount}件を除外` +
      `(内訳: ${Object.keys(relevanceReasonCodeCounts).length === 0 ? "なし" : Object.entries(relevanceReasonCodeCounts).map(([code, count]) => `${code}=${count}件`).join(", ")}` +
      `。itemCodeと理由コードのみ記録、seller文言は記録しない)`
  );
  validationReportLines.push(...perCandidateResults.map((r) => {
    const allIssues = [...r.gateErrors, ...r.itemErrors, ...r.conflicts];
    const status = allIssues.length === 0 ? "OK" : "NG";
    return `候補「${r.kw.normalizedKeyword}」(slug=${r.kw.slug}): ${status}${allIssues.length > 0 ? " — " + allIssues.join(" / ") : ""}`;
  }));

  // 【2026-09-07 PR#6追加監査対応】除外商品をitemCode単位で個別に監査可能にする。
  // 記録するのはnormalizedKeyword・itemCode・理由コード・除外区分のみ。
  // itemName・catchcopy・itemCaption・店舗名・seller文言は一切記録しない。
  for (const r of perCandidateResults) {
    for (const item of r.excludedUnsafeItems) {
      validationReportLines.push(`商品安全除外: keyword=${r.kw.normalizedKeyword}, itemCode=${item.itemCode}, reasonCode=${item.reasonCode}`);
    }
    for (const item of r.excludedIrrelevantItems) {
      validationReportLines.push(`商品関連性除外: keyword=${r.kw.normalizedKeyword}, itemCode=${item.itemCode}, reasonCodes=${(item.reasonCodes ?? []).join(",")}`);
    }
  }

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
  const drafts = perCandidateResults.map(({ kw, candidate, pageReadyItems }) => {
    const html = renderPilotDraftHtml({
      title: kw.title,
      slug: kw.slug,
      normalizedKeyword: kw.normalizedKeyword,
      originalKeyword: candidate.originalKeyword,
      cluster: candidate.cluster,
      monthlySearches: candidate.monthlySearches,
      finalPriority: candidate.finalPriority,
      webKeywordScoreTotal: candidate.webKeywordScoreTotal,
      eligibleItems: pageReadyItems,
      requiredAttributeLabels: candidate.requiredAttributes.map((t) => ATTRIBUTE_LABELS[t] ?? t),
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
