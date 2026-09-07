// 商品関連性判定の共通モジュール(2026-09-07 PR#6対応)。
//
// 【背景】2026-09-07にPhase 3A下書き「キャットフード グレインフリー」で、
// 犬用おやつ(ジャーキー)がQuality Score 98で1位表示される誤判定が発生した。
// 商品名に「キャットフード」「猫」がSEOキーワードとして併記されていたため、
// rakuten-match.js既存の必須属性一致判定(itemName+catchcopy+itemCaption全体からの
// 属性抽出)ではspecies:catが検出され、同時にspecies:dogが検出されていても
// 「必須属性が見つかった」ことが優先され、除外されなかった(下記EXCLUSIVE_GROUPS判定は
// 必須属性そのものが商品側に無い場合しか矛盾とみなさない設計だったため機能しなかった)。
//
// このモジュールは、必須属性が「商品名(itemName)を中心に」確認できるかどうかを最優先で
// 判定する、既存のitemAttributeTags抽出とは独立したゲートを提供する。
// rakuten-match.js(照合時点)とpilot-draft-source-run.js(Phase 3A下書き生成時点、
// 保存済みデータに対する独立した多層防御)の両方から同じ関数を呼び出し、
// 判定ロジックを二重実装しない。

import { extractAttributes } from "./attributes.js";

const SPECIES_TAGS = ["species:dog", "species:cat"];
const STAPLE_TAG = "productType:staple";
const TREAT_TAG = "productType:treat";

// 「犬猫用」「犬猫兼用」「犬・猫用」等、明示的に両方の動物種を対象とする商品の表記。
// 専用ランキング(猫専用・犬専用)では、この種の商品を自動採用しない。
const MULTI_SPECIES_PHRASES = ["犬猫", "猫犬"];

function oppositeSpeciesTag(tag) {
  return tag === "species:cat" ? "species:dog" : "species:cat";
}

function containsMultiSpeciesPhrase(text) {
  const s = String(text ?? "");
  return MULTI_SPECIES_PHRASES.some((phrase) => s.includes(phrase));
}

/**
 * 必須属性(requiredAttributes)に対して、商品名(itemName)を最優先の根拠として
 * 商品の関連性を判定する。itemName内に明確な矛盾(反対の動物種・反対の商品種別)が
 * あれば、catchcopy/itemCaptionに必須キーワードが含まれていても採用しない
 * (SEOキーワード詰め込み対策)。
 *
 * @param {{
 *   requiredAttributes: string[],
 *   itemName?: string,
 *   catchcopy?: string,
 *   itemCaption?: string,
 * }} params
 * @returns {{
 *   status: "RELEVANT" | "REJECTED" | "REVIEW_REQUIRED",
 *   reasonCodes: string[],
 *   detectedTitleAttributes: string[],
 *   detectedFullTextAttributes: string[],
 * }}
 */
export function evaluateProductRelevance({ requiredAttributes, itemName, catchcopy, itemCaption }) {
  const required = requiredAttributes ?? [];
  const titleText = String(itemName ?? "");
  const fullText = `${titleText} ${catchcopy ?? ""} ${itemCaption ?? ""}`;

  const detectedTitleAttributes = extractAttributes(titleText);
  const detectedFullTextAttributes = extractAttributes(fullText);
  const titleTagSet = new Set(detectedTitleAttributes);
  const fullTextTagSet = new Set(detectedFullTextAttributes);

  const reasonCodes = [];
  let status = "RELEVANT";

  // --- A. 動物種の矛盾判定(itemName優先) ---
  for (const requiredTag of required) {
    if (!SPECIES_TAGS.includes(requiredTag)) continue;
    const opposite = oppositeSpeciesTag(requiredTag);
    const hasRequiredInTitle = titleTagSet.has(requiredTag);
    const hasOppositeInTitle = titleTagSet.has(opposite);

    if (hasRequiredInTitle && hasOppositeInTitle) {
      // itemNameに必須動物種・反対動物種の両方が存在する。
      if (containsMultiSpeciesPhrase(titleText)) {
        reasonCodes.push("MULTI_SPECIES_NOT_SPECIFIC");
      } else {
        reasonCodes.push("AMBIGUOUS_SPECIES");
      }
      status = "REJECTED";
    } else if (!hasRequiredInTitle && hasOppositeInTitle) {
      // itemNameに反対動物種だけが明確に存在する(必須動物種は無い)。
      // catchcopy/itemCaptionに必須動物種が書かれていても上書きして採用しない。
      reasonCodes.push("OPPOSITE_SPECIES_IN_ITEM_NAME");
      status = "REJECTED";
    } else if (!hasRequiredInTitle && !hasOppositeInTitle) {
      // itemNameだけでは必須動物種を確認できない。
      if (fullTextTagSet.has(requiredTag)) {
        // catchcopy/itemCaptionでは確認できる → 自動採用はせず要確認扱い。
        reasonCodes.push("REQUIRED_SPECIES_NOT_CONFIRMED_IN_TITLE");
        if (status !== "REJECTED") status = "REVIEW_REQUIRED";
      } else {
        // どこにも必須動物種の根拠が無い。
        reasonCodes.push("REQUIRED_SPECIES_NOT_CONFIRMED");
        status = "REJECTED";
      }
    }
    // hasRequiredInTitle && !hasOppositeInTitle の場合は問題なし(何もしない)。
  }

  // --- B. 主食/おやつの矛盾判定(itemName優先、SEOキーワード詰め込み対策) ---
  if (required.includes(STAPLE_TAG) && titleTagSet.has(TREAT_TAG) && !titleTagSet.has(STAPLE_TAG)) {
    reasonCodes.push("TREAT_PRODUCT_FOR_STAPLE_QUERY");
    status = "REJECTED";
  }
  if (required.includes(TREAT_TAG) && titleTagSet.has(STAPLE_TAG) && !titleTagSet.has(TREAT_TAG)) {
    reasonCodes.push("STAPLE_PRODUCT_FOR_TREAT_QUERY");
    status = "REJECTED";
  }

  return { status, reasonCodes, detectedTitleAttributes, detectedFullTextAttributes };
}
