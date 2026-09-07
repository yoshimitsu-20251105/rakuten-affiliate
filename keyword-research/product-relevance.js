// 商品関連性判定の共通モジュール(2026-09-07 PR#6対応、同日追加監査対応)。
//
// 【背景】2026-09-07にPhase 3A下書き「キャットフード グレインフリー」で、
// 犬用おやつ(ジャーキー)がQuality Score 98で1位表示される誤判定が発生した。
// 商品名に「キャットフード」「猫」がSEOキーワードとして併記されていたため、
// rakuten-match.js既存の必須属性一致判定(itemName+catchcopy+itemCaption全体からの
// 属性抽出)ではspecies:catが検出され、同時にspecies:dogが検出されていても
// 「必須属性が見つかった」ことが優先され、除外されなかった(下記EXCLUSIVE_GROUPS判定は
// 必須属性そのものが商品側に無い場合しか矛盾とみなさない設計だったため機能しなかった)。
//
// 【追加監査(同日)で判明した抜け穴】主食/おやつ判定が「requiredの反対語のみが商品名に
// あり、required語が無い」場合しかREJECTEDにしていなかったため、商品名に主食語・おやつ語
// の両方がSEO目的で併記されている場合(例: 「猫用 おやつ ジャーキー キャットフード
// グレインフリー」、required=productType:staple)は、staple語(キャットフード)も
// treat語(おやつ・ジャーキー)も両方検出され、既存条件(「treat検出かつstaple未検出」)に
// 該当せず通過してしまっていた。requiresStaple/requiresTreat/hasStapleInTitle/
// hasTreatInTitleを明示的に分離した判定表へ書き直し、両方検出時は
// AMBIGUOUS_PRODUCT_TYPEとして必ずREJECTEDにする。
//
// このモジュールは、必須属性が「商品名(itemName)を中心に」確認できるかどうかを最優先で
// 判定する、既存のitemAttributeTags抽出とは独立したゲートを提供する。
// rakuten-match.js(照合時点)とpilot-draft-build.js(Phase 3A下書き生成時点、
// 保存済みデータに対する独立した多層防御)の両方から同じ関数を呼び出し、
// 判定ロジックを二重実装しない。

import { extractAttributes } from "./attributes.js";

const SPECIES_TAGS = ["species:dog", "species:cat"];
const STAPLE_TAG = "productType:staple";
const TREAT_TAG = "productType:treat";
// 【2026-09-07 Phase 3B対応】公開ページの必須主原料(例: 豚肉ドッグフードページの
// ingredient:pork)。動物種と同じく「itemNameで確認できるか」を最優先根拠とする
// (catchcopyだけに書かれている場合は自動採用せず要確認扱いにする)。
const TITLE_REQUIRED_INGREDIENT_TAGS = ["ingredient:pork"];

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

function pushReasonCode(reasonCodes, code) {
  if (!reasonCodes.includes(code)) reasonCodes.push(code);
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
        pushReasonCode(reasonCodes, "MULTI_SPECIES_NOT_SPECIFIC");
      } else {
        pushReasonCode(reasonCodes, "AMBIGUOUS_SPECIES");
      }
      status = "REJECTED";
    } else if (!hasRequiredInTitle && hasOppositeInTitle) {
      // itemNameに反対動物種だけが明確に存在する(必須動物種は無い)。
      // catchcopy/itemCaptionに必須動物種が書かれていても上書きして採用しない。
      pushReasonCode(reasonCodes, "OPPOSITE_SPECIES_IN_ITEM_NAME");
      status = "REJECTED";
    } else if (!hasRequiredInTitle && !hasOppositeInTitle) {
      // itemNameだけでは必須動物種を確認できない。
      if (fullTextTagSet.has(requiredTag)) {
        // catchcopy/itemCaptionでは確認できる → 自動採用はせず要確認扱い。
        pushReasonCode(reasonCodes, "REQUIRED_SPECIES_NOT_CONFIRMED_IN_TITLE");
        if (status !== "REJECTED") status = "REVIEW_REQUIRED";
      } else {
        // どこにも必須動物種の根拠が無い。
        pushReasonCode(reasonCodes, "REQUIRED_SPECIES_NOT_CONFIRMED");
        status = "REJECTED";
      }
    }
    // hasRequiredInTitle && !hasOppositeInTitle の場合は問題なし(何もしない)。
  }

  // --- B. 主食/おやつの矛盾判定(itemName優先、SEOキーワード詰め込み対策) ---
  //
  // 【同日追加監査対応】以前は「反対語だけが商品名にあり、required語が無い」場合しか
  // REJECTEDにしていなかったため、商品名に主食語・おやつ語の両方がSEO目的で併記されて
  // いる場合(例: 「猫用 おやつ ジャーキー キャットフード グレインフリー」)に、staple/treat
  // どちらも検出されて既存条件に該当せず通過してしまっていた。requiresStaple/
  // requiresTreat/hasStapleInTitle/hasTreatInTitleを明示的に分離し、以下の判定表に従う。
  //
  //   requiresStaple  requiresTreat  hasStapleInTitle  hasTreatInTitle  → 結果
  //   true            true           (any)             (any)           REQUIRED_PRODUCT_TYPE_CONFLICT(異常ケース、fail closed)
  //   true            false          true              true            AMBIGUOUS_PRODUCT_TYPE(SEOキーワード詰め込みの可能性)
  //   true            false          false             true            TREAT_PRODUCT_FOR_STAPLE_QUERY
  //   true            false          true              false           問題なし
  //   true            false          false             false           問題なし(productType自体の確認必須化は対象外)
  //   false           true           true              true            AMBIGUOUS_PRODUCT_TYPE
  //   false           true           true              false           STAPLE_PRODUCT_FOR_TREAT_QUERY
  //   false           true           false             true            問題なし
  //   false           true           false             false           問題なし
  //   false           false          (any)             (any)           対象外(判定しない)
  const requiresStaple = required.includes(STAPLE_TAG);
  const requiresTreat = required.includes(TREAT_TAG);
  const hasStapleInTitle = titleTagSet.has(STAPLE_TAG);
  const hasTreatInTitle = titleTagSet.has(TREAT_TAG);

  if (requiresStaple && requiresTreat) {
    // requiredAttributes自体がstaple/treatを同時に要求する異常ケース。判定不能のため安全側でREJECTED。
    pushReasonCode(reasonCodes, "REQUIRED_PRODUCT_TYPE_CONFLICT");
    status = "REJECTED";
  } else if (requiresStaple && hasStapleInTitle && hasTreatInTitle) {
    pushReasonCode(reasonCodes, "AMBIGUOUS_PRODUCT_TYPE");
    status = "REJECTED";
  } else if (requiresStaple && !hasStapleInTitle && hasTreatInTitle) {
    pushReasonCode(reasonCodes, "TREAT_PRODUCT_FOR_STAPLE_QUERY");
    status = "REJECTED";
  } else if (requiresTreat && hasStapleInTitle && hasTreatInTitle) {
    pushReasonCode(reasonCodes, "AMBIGUOUS_PRODUCT_TYPE");
    status = "REJECTED";
  } else if (requiresTreat && hasStapleInTitle && !hasTreatInTitle) {
    pushReasonCode(reasonCodes, "STAPLE_PRODUCT_FOR_TREAT_QUERY");
    status = "REJECTED";
  }

  // --- C. 必須主原料の確認(itemName優先、2026-09-07 Phase 3B対応) ---
  // 「豚肉」等の主原料訴求は、catchcopyだけに書かれている場合は自動採用しない
  // (seller文言のSEO詰め込みで根拠にしない)。itemNameで確認できない場合、
  // catchcopy/itemCaptionで確認できればREVIEW_REQUIRED、どこにも無ければREJECTED。
  for (const requiredTag of required) {
    if (!TITLE_REQUIRED_INGREDIENT_TAGS.includes(requiredTag)) continue;
    if (titleTagSet.has(requiredTag)) continue; // itemNameで確認済み、問題なし。
    if (fullTextTagSet.has(requiredTag)) {
      pushReasonCode(reasonCodes, "INGREDIENT_NOT_CONFIRMED_IN_TITLE");
      if (status !== "REJECTED") status = "REVIEW_REQUIRED";
    } else {
      pushReasonCode(reasonCodes, "INGREDIENT_NOT_CONFIRMED");
      status = "REJECTED";
    }
  }

  return { status, reasonCodes, detectedTitleAttributes, detectedFullTextAttributes };
}
