// Phase 3C(検索公開試験レポート)専用: 実API(GA4 Data API / Search Console API)への
// 接続を許可する前提条件をすべて満たしているかを検証するゲート(2026-09-11監査対応)。
//
// 【背景】開発・テスト中に、ローカルに実在するcredentials/ga-search-console-key.json
// 経由で実際のGA4/Search Console APIへ複数回、意図せず読み取りアクセスしてしまう
// 事故が発生した。原因は「認証ファイルが存在すれば接続してしまう」設計だったこと。
// このモジュールは、次の4条件をすべて満たさない限りGoogle APIクライアントの生成
// そのものを一切行わせない、明示的なopt-inゲートとして機能する。
//
//   1. --live フラグ(呼び出し側であるCLIの引数)
//   2. 環境変数 SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED=true
//   3. 環境変数 GA_SEARCH_CONSOLE_KEY_FILE(認証ファイルの絶対パス)
//   4. 3のパスが実在し、有効なサービスアカウントJSON(client_email・private_keyを
//      含む)として読み込めること
//
// 認証ファイルの既定パスへの自動fallbackは行わない(credentials/ga-search-console-key.json
// が実在するだけでは、このゲートは絶対に通過しない)。
//
// エラーメッセージには、認証ファイルの実際のパス・内容・サービスアカウントの
// メールアドレス等は一切含めない(ゲートが失敗したという事実と、どの条件が
// 満たされていないかだけを伝える)。

import { existsSync, readFileSync } from "node:fs";

/**
 * @param {{ liveFlag: boolean, env: Record<string, string|undefined> }} options
 * @returns {{ keyFilePath: string }} ゲートを通過した場合のみ、検証済みの認証ファイルパスを返す
 * @throws {Error} 4条件のいずれか1つでも満たさない場合(Google APIクライアントは一切生成しない)
 */
export function assertLiveExecutionAllowed({ liveFlag, env }) {
  if (liveFlag !== true) {
    throw new Error("実APIへの接続には --live の指定が必要です(未指定のためAPI呼び出しは行いません)");
  }
  if (env.SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED !== "true") {
    throw new Error("実APIへの接続には環境変数 SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED=true が必要です(未設定のためAPI呼び出しは行いません)");
  }
  const keyFilePath = env.GA_SEARCH_CONSOLE_KEY_FILE;
  if (typeof keyFilePath !== "string" || keyFilePath.trim() === "") {
    throw new Error(
      "実APIへの接続には環境変数 GA_SEARCH_CONSOLE_KEY_FILE(認証ファイルのパス)が必要です。既定パスへの自動fallbackは行いません(API呼び出しは行いません)"
    );
  }
  if (!existsSync(keyFilePath)) {
    throw new Error("GA_SEARCH_CONSOLE_KEY_FILE が指す認証ファイルが見つかりません(API呼び出しは行いません)");
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(keyFilePath, "utf-8"));
  } catch {
    throw new Error("GA_SEARCH_CONSOLE_KEY_FILE が指すファイルの形式が不正です(JSONとして読み込めません。API呼び出しは行いません)");
  }
  if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
    throw new Error(
      "GA_SEARCH_CONSOLE_KEY_FILE が指すファイルの形式が不正です(サービスアカウントJSONに必要な項目がありません。API呼び出しは行いません)"
    );
  }

  return { keyFilePath };
}
