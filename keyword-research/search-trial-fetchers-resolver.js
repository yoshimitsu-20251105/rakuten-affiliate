// Phase 3C(検索公開試験レポート)専用: ライブ実行ゲートを通過した場合にだけ、
// 実際のGoogle APIクライアントに紐づいたfetchersを組み立てる層(2026-09-11監査対応)。
//
// clientFactory引数により、Google APIクライアントの生成そのものをテストから
// 差し替えられる(テストではcreateLiveGoogleClientsを一切呼ばず、mockクライアントを
// 返すfake factoryを渡すことで、実際のgoogle.auth.GoogleAuthに一切触れずに
// 「ゲート通過後の配線」だけを検証できる)。

import { assertLiveExecutionAllowed } from "./search-trial-live-gate.js";
import {
  createLiveGoogleClients,
  fetchSearchConsolePageMetrics,
  fetchUrlInspectionStatus,
  fetchGA4PageMetrics,
  fetchGA4CustomDimensionAvailability,
  fetchRakutenPerformance,
} from "./search-trial-analytics-clients.js";

/**
 * @param {{ liveFlag: boolean, env: Record<string, string|undefined>, clientFactory?: typeof createLiveGoogleClients }} options
 * @returns {object} search-trial-report-build.js の buildSearchTrialReport() へそのまま渡せる fetchers
 * @throws {Error} ライブ実行ゲートを満たさない場合(Google APIクライアントは一切生成しない)
 */
export function resolveLiveFetchers({ liveFlag, env, clientFactory = createLiveGoogleClients }) {
  const { keyFilePath } = assertLiveExecutionAllowed({ liveFlag, env });
  const clients = clientFactory({ keyFilePath });

  return {
    fetchSearchConsolePageMetrics: (args) => fetchSearchConsolePageMetrics({ ...args, client: clients.searchconsole }),
    fetchUrlInspectionStatus: (args) => fetchUrlInspectionStatus({ ...args, client: clients.searchconsole }),
    fetchGA4PageMetrics: (args) => fetchGA4PageMetrics({ ...args, client: clients.analyticsdata }),
    fetchGA4CustomDimensionAvailability: () => fetchGA4CustomDimensionAvailability({ client: clients.analyticsdata }),
    fetchRakutenPerformance,
  };
}
