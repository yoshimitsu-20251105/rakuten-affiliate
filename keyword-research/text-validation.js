// 汎用テキスト検証ユーティリティ(2026-09-07 Phase 3B対応で抽出)。
// pilot-draft-approval.js(Phase 3A)とpublication-approval.js(Phase 3B)の両方が
// 同じ検証ロジックを使うため、二重実装を避けてここへ集約する。
//
// 【重要】制御文字判定は正規表現リテラルで書かない(過去にnormalize.jsでエスケープ
// 表記が実際の制御バイトへ変換され、ファイルが破損する事故があったため)。
// 文字コードの比較だけで実装する。

/**
 * @param {any} value
 * @returns {boolean}
 */
export function isValidIsoDate(value) {
  return typeof value === "string" && value !== "" && Number.isFinite(Date.parse(value));
}

/**
 * @param {string} s
 * @returns {boolean}
 */
export function containsControlCharacters(s) {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
