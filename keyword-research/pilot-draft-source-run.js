// Phase 3A(非公開下書きページ生成)専用: 保存済みのkeywords:gkp-dry-run実行結果
// (source run)を読み取り専用で読み込み、run単位のゲート検証と候補データの結合を行う。
// このモジュール自身は楽天/Google/Search Console APIを一切呼び出さない
// (既に保存済みのCSV/JSONファイルを読むだけ)。
//
// 【2026-09-07 PR#5監査対応】以下の欠陥を修正した:
//   - rakuten-matches.csv/rakuten-items.jsonの読込失敗を握りつぶしていた
//     (rakuten-matches.csvは空扱い、rakuten-items.jsonはcatch(() => "{}")で
//     黙って空オブジェクト扱いにしていた) → 両ファイルを必須化し、失敗時は
//     source run全体をinvalidにする。
//   - rakuten-matches.csvのELIGIBLE行数だけでeligibleItemCountを決めており、
//     実際にHTMLへ表示する商品(rakuten-items.json)との対応関係を一切確認して
//     いなかった → itemCode単位で両者を突き合わせ、完全一致しない場合は拒否する。
//   - matchedAttributesを最初のELIGIBLE行だけから取得していた(他の行と異なる
//     属性を持っていても気づけなかった) → 全ELIGIBLE行のrequiredAttributes/
//     missingAttributes/conflictingAttributes/matchScoreの一致を検証する。
//   - artifactHashes(source run成果物のSHA-256)・candidateSetHashの再計算検証を
//     追加し、保存後の改変を検知できるようにした。

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseCsvRecords } from "./csv.js";
import { sha256File, computeCandidateSetHash } from "./hash-utils.js";

const ARTIFACT_FILENAMES = ["keyword-scores.csv", "keyword-candidates.csv", "rakuten-matches.csv", "rakuten-items.json"];
const MIN_ELIGIBLE_ITEMS = 3;

function isValidIsoDate(value) {
  return typeof value === "string" && value !== "" && Number.isFinite(Date.parse(value));
}

/**
 * run-metadata.jsonの厳格な検証(2026-09-07 PR#5監査対応: 必須フィールド・件数整合性を拡張)。
 * @param {any} metadata
 * @param {{ scoresRowCount: number }} counts - keyword-scores.csvの実データ行数(呼び出し側で取得)
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSourceRunMetadata(metadata, counts = {}) {
  const errors = [];

  if (metadata.status !== "completed") {
    errors.push(`source runのstatusが"completed"ではありません(値: ${JSON.stringify(metadata.status ?? null)}。statusフィールドが無い旧runは拒否します)`);
  }
  if (metadata.commandMode !== "gkp-dry-run") {
    errors.push(`source runのcommandModeが"gkp-dry-run"ではありません(値: ${JSON.stringify(metadata.commandMode ?? null)})`);
  }
  if (metadata.rakutenSource !== "live") {
    errors.push(`source runのrakutenSourceが"live"ではありません(値: ${JSON.stringify(metadata.rakutenSource ?? null)})`);
  }
  if (metadata.sourceProvider !== "google_keyword_planner") {
    errors.push(`source runのsourceProviderが"google_keyword_planner"ではありません(値: ${JSON.stringify(metadata.sourceProvider ?? null)})`);
  }
  if (!isValidIsoDate(metadata.executedAt)) {
    errors.push(`source runのexecutedAtが有効なISO日時ではありません(値: ${JSON.stringify(metadata.executedAt ?? null)})`);
  }
  if (typeof metadata.runId !== "string" || metadata.runId.trim() === "") {
    errors.push("source runのrunIdが空です");
  }

  const resultCounts = metadata.resultCounts ?? {};
  if (resultCounts.apiErrorCount !== 0) {
    errors.push(`source runのresultCounts.apiErrorCountが0ではありません(値: ${JSON.stringify(resultCounts.apiErrorCount ?? null)})`);
  }
  if (resultCounts.apiErrorRate !== 0) {
    errors.push(`source runのresultCounts.apiErrorRateが0ではありません(値: ${JSON.stringify(resultCounts.apiErrorRate ?? null)})`);
  }
  if (!Number.isInteger(resultCounts.attemptedCount) || resultCounts.attemptedCount <= 0) {
    errors.push(`source runのresultCounts.attemptedCountが正整数ではありません(値: ${JSON.stringify(resultCounts.attemptedCount ?? null)})`);
  }

  const searchSourceCounts = metadata.searchSourceCounts ?? {};
  const keys = Object.keys(searchSourceCounts);
  if (keys.length !== 1 || keys[0] !== "live") {
    errors.push(`source runのsearchSourceCountsはliveだけを含む必要があります(実際のキー: ${JSON.stringify(keys)})`);
  }
  const liveCount = searchSourceCounts.live;
  if (!Number.isInteger(liveCount) || liveCount <= 0) {
    errors.push(`source runのsearchSourceCounts.liveが正整数ではありません(値: ${JSON.stringify(liveCount ?? null)})`);
  }

  // 件数整合性(live件数・attemptedCount・selectedCount・candidateCount・
  // keyword-scores.csv実データ行数がすべて一致すること)。
  if (errors.length === 0) {
    const countValues = {
      "searchSourceCounts.live": liveCount,
      "resultCounts.attemptedCount": resultCounts.attemptedCount,
      selectedCount: metadata.selectedCount,
      candidateCount: metadata.candidateCount,
    };
    if (typeof counts.scoresRowCount === "number") {
      countValues["keyword-scores.csv行数"] = counts.scoresRowCount;
    }
    const distinctValues = new Set(Object.values(countValues));
    if (distinctValues.size > 1) {
      errors.push(`source runの件数が一致しません: ${JSON.stringify(countValues)}`);
    }
  }

  if (!metadata.artifactHashes || typeof metadata.artifactHashes !== "object") {
    errors.push("source runにartifactHashesが記録されていません(旧runのため拒否します。旧runへのハッシュ後付けは行わないでください)");
  } else {
    const missing = ARTIFACT_FILENAMES.filter((f) => typeof metadata.artifactHashes[f] !== "string" || metadata.artifactHashes[f] === "");
    if (missing.length > 0) {
      errors.push(`source runのartifactHashesに不足しているファイルがあります: ${missing.join(", ")}`);
    }
  }

  if (typeof metadata.candidateSetHash !== "string" || metadata.candidateSetHash === "") {
    errors.push("source runにcandidateSetHashが記録されていません");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * requiredAttributesの文字列表現(" | "区切り)を正規化した配列に変換し、
 * ソート済みの比較キー文字列も返す(同一集合かどうかの比較に使う)。
 */
function parseAttributeList(raw) {
  const list = String(raw ?? "").split(" | ").map((s) => s.trim()).filter(Boolean);
  return { list, key: [...list].sort().join(",") };
}

/**
 * @param {string} runDir - keywords:gkp-dry-runの出力ディレクトリ(実在確認済み)
 * @returns {Promise<{ valid: boolean, errors: string[], metadata: any|null, candidatesByKeyword: Map<string, any>|null }>}
 */
export async function loadSourceRun(runDir) {
  if (!existsSync(runDir)) {
    return { valid: false, errors: [`source runディレクトリが見つかりません: ${runDir}`], metadata: null, candidatesByKeyword: null };
  }

  let metadata;
  try {
    metadata = JSON.parse(await readFile(`${runDir}/run-metadata.json`, "utf-8"));
  } catch (e) {
    return { valid: false, errors: [`run-metadata.jsonの読込に失敗: ${e.message}`], metadata: null, candidatesByKeyword: null };
  }

  // --- 成果物ファイルの読込(2026-09-07 PR#5監査対応: すべて必須化し、
  //     読込失敗を握りつぶさない。rakuten-matches.csv/rakuten-items.jsonも例外ではない) ---
  let scoresText, candidatesText, matchesText, itemsText;
  try {
    scoresText = await readFile(`${runDir}/keyword-scores.csv`, "utf-8");
    candidatesText = await readFile(`${runDir}/keyword-candidates.csv`, "utf-8");
    matchesText = await readFile(`${runDir}/rakuten-matches.csv`, "utf-8");
    itemsText = await readFile(`${runDir}/rakuten-items.json`, "utf-8");
  } catch (e) {
    return { valid: false, errors: [`source runの成果物ファイル読込に失敗: ${e.message}`], metadata, candidatesByKeyword: null };
  }

  let scores, candidates, matches, rakutenItemsByKeyword;
  try {
    scores = parseCsvRecords(scoresText);
    candidates = parseCsvRecords(candidatesText);
    matches = parseCsvRecords(matchesText);
    rakutenItemsByKeyword = JSON.parse(itemsText);
  } catch (e) {
    return { valid: false, errors: [`source runの成果物ファイル解析に失敗: ${e.message}`], metadata, candidatesByKeyword: null };
  }

  // --- run-metadataの検証(件数整合性はkeyword-scores.csvの実データ行数も含めて確認) ---
  const { valid: metaValid, errors: metaErrors } = validateSourceRunMetadata(metadata, { scoresRowCount: scores.length });
  if (!metaValid) {
    return { valid: false, errors: metaErrors, metadata, candidatesByKeyword: null };
  }

  // --- artifactHashesの再計算検証(保存後の改変検知) ---
  const artifactErrors = [];
  for (const filename of ARTIFACT_FILENAMES) {
    const actualHash = await sha256File(`${runDir}/${filename}`);
    if (actualHash !== metadata.artifactHashes[filename]) {
      artifactErrors.push(`${filename}のハッシュが記録値と一致しません(改変または破損の可能性があります)`);
    }
  }
  if (artifactErrors.length > 0) {
    return { valid: false, errors: artifactErrors, metadata, candidatesByKeyword: null };
  }

  // --- candidateSetHashの再計算検証(生成側と共通のアルゴリズムを使用) ---
  const recomputedCandidateSetHash = computeCandidateSetHash(scores.map((s) => ({ originalKeyword: s.originalKeyword })));
  if (recomputedCandidateSetHash !== metadata.candidateSetHash) {
    return {
      valid: false,
      errors: [`candidateSetHashの再計算結果がrun-metadata.jsonの記録値と一致しません(改変の可能性があります)`],
      metadata,
      candidatesByKeyword: null,
    };
  }

  // --- keyword-scores.csv内のnormalizedKeyword重複チェック ---
  const seenNormalizedKeywords = new Set();
  const duplicateNormalizedKeywords = new Set();
  for (const s of scores) {
    if (seenNormalizedKeywords.has(s.normalizedKeyword)) duplicateNormalizedKeywords.add(s.normalizedKeyword);
    seenNormalizedKeywords.add(s.normalizedKeyword);
  }
  if (duplicateNormalizedKeywords.size > 0) {
    return {
      valid: false,
      errors: [`keyword-scores.csv内でnormalizedKeywordが重複しています: ${[...duplicateNormalizedKeywords].join(", ")}`],
      metadata,
      candidatesByKeyword: null,
    };
  }

  // --- normalizedKeyword単位でのmatches/items結合 ---
  const matchesByKeyword = new Map();
  for (const m of matches) {
    if (!matchesByKeyword.has(m.normalizedKeyword)) matchesByKeyword.set(m.normalizedKeyword, []);
    matchesByKeyword.get(m.normalizedKeyword).push(m);
  }

  const candidatesByKeyword = new Map();
  for (const s of scores) {
    const keyword = s.normalizedKeyword;
    const c = candidates.find((x) => x.normalizedKeyword === keyword) ?? {};
    const keywordMatches = matchesByKeyword.get(keyword) ?? [];
    const eligibleMatches = keywordMatches.filter((m) => m.status === "ELIGIBLE");
    const dataIntegrityErrors = [];

    // ELIGIBLE itemCodeの重複チェック(rakuten-matches.csv側)
    const eligibleItemCodesRaw = eligibleMatches.map((m) => m.itemCode);
    const eligibleItemCodeSet = new Set(eligibleItemCodesRaw);
    if (eligibleItemCodeSet.size !== eligibleItemCodesRaw.length) {
      dataIntegrityErrors.push("rakuten-matches.csv内でELIGIBLEなitemCodeが重複しています");
    }

    // rakuten-items.json側のitemCode重複チェック
    const storedItems = rakutenItemsByKeyword[keyword] ?? [];
    const storedItemCodesRaw = storedItems.map((i) => i.itemCode);
    const storedItemCodeSet = new Set(storedItemCodesRaw);
    if (storedItemCodeSet.size !== storedItemCodesRaw.length) {
      dataIntegrityErrors.push("rakuten-items.json内でitemCodeが重複しています");
    }

    // 両集合の完全一致(照合結果と商品表示データの整合性)
    const onlyInMatches = [...eligibleItemCodeSet].filter((code) => !storedItemCodeSet.has(code));
    const onlyInItems = [...storedItemCodeSet].filter((code) => !eligibleItemCodeSet.has(code));
    if (onlyInMatches.length > 0 || onlyInItems.length > 0) {
      dataIntegrityErrors.push(
        `楽天照合結果(ELIGIBLE)と商品表示データ(rakuten-items.json)のitemCodeが一致しません` +
          `(照合結果のみ: ${onlyInMatches.length}件 / 表示データのみ: ${onlyInItems.length}件)`
      );
    }

    // 属性の整合性(ELIGIBLE行はすべて同一のrequiredAttributesを持ち、
    // missingAttributes/conflictingAttributesは空、matchScore=100であること)
    let requiredAttributes = [];
    if (eligibleMatches.length > 0 && dataIntegrityErrors.length === 0) {
      const firstAttrs = parseAttributeList(eligibleMatches[0].requiredAttributes);
      requiredAttributes = firstAttrs.list;
      for (const m of eligibleMatches) {
        const attrs = parseAttributeList(m.requiredAttributes);
        if (attrs.key !== firstAttrs.key) {
          dataIntegrityErrors.push("ELIGIBLE行間でrequiredAttributesが一致しません");
          break;
        }
        if ((m.missingAttributes ?? "").trim() !== "") {
          dataIntegrityErrors.push(`ELIGIBLEなitemCode「${m.itemCode}」にmissingAttributesが記録されています(ELIGIBLEの定義に反します)`);
          break;
        }
        if ((m.conflictingAttributes ?? "").trim() !== "") {
          dataIntegrityErrors.push(`ELIGIBLEなitemCode「${m.itemCode}」にconflictingAttributesが記録されています(ELIGIBLEの定義に反します)`);
          break;
        }
        if (String(m.matchScore) !== "100") {
          dataIntegrityErrors.push(`ELIGIBLEなitemCode「${m.itemCode}」のmatchScoreが100ではありません(値: ${m.matchScore})`);
          break;
        }
      }
    }

    // 検証済みの表示可能itemCode集合(両者の積集合。整合していれば両集合と同一)
    const verifiedItemCodes = new Set([...eligibleItemCodeSet].filter((code) => storedItemCodeSet.has(code)));
    const eligibleItems = storedItems.filter((i) => verifiedItemCodes.has(i.itemCode));

    candidatesByKeyword.set(keyword, {
      originalKeyword: s.originalKeyword,
      normalizedKeyword: keyword,
      businessValidated: s.businessValidated === "true",
      decisionStatus: s.decisionStatus,
      scoreBand: s.scoreBand_simulationOnly,
      eligibleForApproval: s.eligibleForApproval === "true",
      safetyStatus: s.safetyStatus,
      queryQualityStatus: s.queryQualityStatus,
      rakutenLookupStatus: s.rakutenLookupStatus,
      rakutenSupplyStatus: s.rakutenSupplyStatus,
      finalPriority: Number(s.finalPriority),
      webKeywordScoreTotal: Number(s.webKeywordScoreTotal),
      bestProductQualityScore: Number(s.bestProductQualityScore),
      cluster: c.cluster ?? "",
      monthlySearches: c.monthlySearches ?? "",
      competitionLevel: c.competitionLevel ?? "",
      // 2026-09-07 PR#5監査対応: 内部データを明確に分離する。
      eligibleMatchItemCodes: [...eligibleItemCodeSet],
      storedItemCodes: [...storedItemCodeSet],
      eligibleItemCount: dataIntegrityErrors.length === 0 ? verifiedItemCodes.size : 0,
      eligibleItems: dataIntegrityErrors.length === 0 ? eligibleItems : [],
      requiredAttributes,
      matchedAttributes: requiredAttributes, // 後方互換(pilot-draft-build.js既存参照用)
      dataIntegrityErrors,
    });
  }

  return { valid: true, errors: [], metadata, candidatesByKeyword };
}

export { MIN_ELIGIBLE_ITEMS };
