// search_consoleアダプター: 自サイトの実績(検索クエリ・表示回数・クリック数・CTR・掲載順位)を取得する。
// 上流の「Web全体の需要」ではなく、公開後の自サイト実績再評価に使う(仕様7章)。
// 既存のGA4/Search Console連携(test-analytics.jsで検証済み)と同じ認証情報を再利用する。

import { google } from "googleapis";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const KEY_FILE_URL = new URL("../../credentials/ga-search-console-key.json", import.meta.url);
const KEY_FILE = fileURLToPath(KEY_FILE_URL);
const DEFAULT_SITE_URL = process.env.GSC_SITE_URL || "https://yoshimitsu-20251105.github.io/rakuten-affiliate/";

async function isConfigured() {
  try {
    await readFile(KEY_FILE_URL, "utf-8");
    return true;
  } catch {
    return false;
  }
}

function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {{ startDaysAgo?: number, endDaysAgo?: number, rowLimit?: number, siteUrl?: string }} [options]
 * @returns {Promise<import('./index.js').SourceResult>}
 */
export async function fetchFromSearchConsole(options = {}) {
  const { startDaysAgo = 28, endDaysAgo = 1, rowLimit = 200, siteUrl = DEFAULT_SITE_URL } = options;

  if (!(await isConfigured())) {
    return {
      observations: [],
      meta: {
        source: "search_console",
        configured: false,
        fallbackUsed: false,
        note: "credentials/ga-search-console-key.json が見つからないためskip(他のドライランは継続)",
      },
    };
  }

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: KEY_FILE,
      scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    });
    const searchconsole = google.searchconsole({ version: "v1", auth });
    const res = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: dateNDaysAgo(startDaysAgo),
        endDate: dateNDaysAgo(endDaysAgo),
        dimensions: ["query", "page"],
        rowLimit,
      },
    });
    const rows = res.data.rows ?? [];
    const observedAt = new Date().toISOString();
    const observations = rows.map((row) => ({
      source: "search_console",
      keyword: row.keys[0],
      observedAt,
      periodStart: dateNDaysAgo(startDaysAgo),
      periodEnd: dateNDaysAgo(endDaysAgo),
      country: "JP",
      language: "ja",
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      averagePosition: row.position,
      rawReference: `${siteUrl} page=${row.keys[1]}`,
    }));
    return {
      observations,
      meta: {
        source: "search_console",
        configured: true,
        fallbackUsed: false,
        note: `Search Console(実績データ)から${observations.length}件取得(${dateNDaysAgo(startDaysAgo)}〜${dateNDaysAgo(endDaysAgo)})`,
      },
    };
  } catch (e) {
    return {
      observations: [],
      meta: {
        source: "search_console",
        configured: true,
        fallbackUsed: false,
        note: `Search Console取得失敗、この処理のみskip: ${e.message}`,
      },
    };
  }
}
