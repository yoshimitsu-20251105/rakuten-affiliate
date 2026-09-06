// live/fixtureの厳格分離(2026-09-06 正式CLI対応)。
//
// 【背景】.envを読み込まずに一回限りスクリプトを実行してしまい、実際の楽天APIではなく
// テスト用fixtureへ静かにフォールバックしていたことに気づかないまま実データとして
// 扱ってしまう事故が過去に発生した(2026-09-05マージ前最終監査(3周目))。
// 正式CLIでは、この種の事故を構造的に起こしえないようにする:
//   - --rakuten-source live: 認証情報が無ければAPIを1件も呼ばず、必ず例外を投げる。
//     fixtureへは絶対にフォールバックしない。
//   - --rakuten-source fixture: 明示指定時のみ使用可能。使用した場合は呼び出し側で
//     eligibleForApproval/eligibleForExport/eligibleForPublishを強制的にfalseへ倒す
//     (このモジュールはsearch関数を返すだけで、その強制はCLI側の責務)。
//   - どちらでもない値、または未指定は例外にする(呼び出し側で安全にデフォルト値を
//     補わない。安全側に倒すため常にエラーにする)。

import { searchRakutenItemsLive, searchRakutenItemsFixture } from "./rakuten-match.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRakutenConfigured() {
  return Boolean(process.env.RAKUTEN_APP_ID && process.env.RAKUTEN_SECRET);
}

/**
 * @param {'live'|'fixture'} rakutenSource
 * @returns {{ search: (keyword: string) => Promise<{items:any[], count:number, source:string}>, usedFixtureFallback: boolean }}
 */
export function createStrictRakutenSearchFn(rakutenSource) {
  if (rakutenSource === "live") {
    if (!isRakutenConfigured()) {
      throw new Error(
        "RAKUTEN_APP_ID/RAKUTEN_SECRETが未設定のため、--rakuten-source live を実行できません。" +
          ".envを読み込んで実行してください(例: npm run keywords:gkp-dry-run -- --rakuten-source live ...)。" +
          "fixtureへの自動フォールバックは行いません(fail closed)。"
      );
    }
    return {
      search: async (keyword) => {
        const result = await searchRakutenItemsLive(keyword);
        await sleep(1200); // 楽天APIのレート制限(1秒1回)を守る
        return result;
      },
      usedFixtureFallback: false,
    };
  }

  if (rakutenSource === "fixture") {
    return {
      search: (keyword) => searchRakutenItemsFixture(keyword),
      usedFixtureFallback: true,
    };
  }

  throw new Error(
    `--rakuten-source は "live" または "fixture" のいずれかを明示的に指定してください(指定値: ${JSON.stringify(rakutenSource)})。` +
      "未指定の完全dry-runは安全のためエラーにします。"
  );
}
