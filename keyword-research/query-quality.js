// 検索語の品質判定(2026-09-05 GKP実データ監査対応)。
//
// 【調査結果】実データで「malformedに見えた」候補("11 キャットフード サイエンス
// シニア ダイエット ヒルズ プラス 以上 歳")を調査したところ、正規化処理による
// 空白消失やトークン結合が原因ではなく、実在する正当なブランド入り商品名
// (「ヒルズ サイエンス・ダイエット キャットフード シニア プラス 11歳以上」)を
// Google側がトークンへ分解した、正当な長いキーワードだった。単純な文字数・数字の
// 有無・ブランド名を含むことだけを理由に自動除外しない設計にしている。
//
// このモジュールが実際にMALFORMEDとするのは、意味を持たない・欠損した文字列だけ:
// - 空文字列
// - 数字のみで構成され、他の意味のあるトークンが無い
// - 1文字以下で内容を持たない
// トークン数が多いだけの場合はREVIEW_REQUIRED(人間の確認を促すが、ブランド名を
// 含むだけでは自動除外しない)。

/** @typedef {'VALID'|'REVIEW_REQUIRED'|'MALFORMED'} QueryQualityStatus */

/**
 * @param {string} canonicalKeyword
 * @param {{ queryQualityRules?: { reviewTokenCountThreshold?: number } }} config
 * @returns {{ queryQualityStatus: QueryQualityStatus, reasons: string[] }}
 */
export function classifyQueryQuality(canonicalKeyword, config) {
  const tokens = canonicalKeyword.split(" ").filter(Boolean);

  if (tokens.length === 0 || canonicalKeyword.replace(/\s/g, "").length <= 1) {
    return { queryQualityStatus: "MALFORMED", reasons: ["キーワードが空、または1文字以下で意味を成さない"] };
  }

  if (tokens.every((t) => /^[0-9]+$/.test(t))) {
    return { queryQualityStatus: "MALFORMED", reasons: ["数字のみで構成されており、商品を特定できる意味のある語を含まない"] };
  }

  const threshold = config.queryQualityRules?.reviewTokenCountThreshold ?? 6;
  if (tokens.length > threshold) {
    return {
      queryQualityStatus: "REVIEW_REQUIRED",
      reasons: [
        `トークン数が${tokens.length}語と多く、語順ソート後は人間にとって読み取りにくいため確認を推奨` +
          "(ブランド名を含む正当な長い商品名である可能性があり、これだけでは自動除外しない)",
      ],
    };
  }

  return { queryQualityStatus: "VALID", reasons: [] };
}
