// 【2026-09-11監査対応】search-trial-fetchers-resolver.js のテスト。
// ライブ実行ゲートを満たした「正常系」も、実際のcreateLiveGoogleClients/
// google.auth.GoogleAuthには一切触れず、注入したmock clientFactoryだけで確認する
// (このファイルはネットワークアクセスを一切行わない)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveLiveFetchers } from "../search-trial-fetchers-resolver.js";
import { createLiveGoogleClients } from "../search-trial-analytics-clients.js";

async function withFakeKeyFile(fn) {
  const dir = await mkdtemp(join(tmpdir(), "search-trial-fetchers-resolver-test-"));
  try {
    const keyFilePath = join(dir, "fake-key.json");
    await writeFile(keyFilePath, JSON.stringify({ client_email: "fake@example-not-real.iam.gserviceaccount.com", private_key: "FAKE" }), "utf-8");
    return await fn(keyFilePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function makeMockClients() {
  const calls = [];
  const searchconsole = {
    searchanalytics: { query: async (req) => { calls.push(["searchanalytics.query", req]); return { data: { rows: [] } }; } },
    urlInspection: { index: { inspect: async (req) => { calls.push(["urlInspection.index.inspect", req]); return { data: { inspectionResult: { indexStatusResult: { verdict: "PASS" } } } }; } } },
  };
  const analyticsdata = {
    properties: {
      runReport: async (req) => { calls.push(["runReport", req]); return { data: { rows: [] } }; },
      getMetadata: async (req) => { calls.push(["getMetadata", req]); return { data: { dimensions: [] } }; },
    },
  };
  return { searchconsole, analyticsdata, calls };
}

test("ライブ実行ゲートを満たさない場合、clientFactoryは一切呼び出されない(Google APIクライアント生成0件)", () => {
  let factoryCalled = false;
  const clientFactory = () => {
    factoryCalled = true;
    throw new Error("呼ばれてはいけない");
  };
  assert.throws(() => resolveLiveFetchers({ liveFlag: false, env: {}, clientFactory }));
  assert.equal(factoryCalled, false, "ゲートを満たさない場合、clientFactory(実クライアント生成)は絶対に呼び出されないこと");
});

test("ライブ実行ゲートを満たす場合、注入したmock clientFactoryだけが使われ、実際のcreateLiveGoogleClientsは使われない", async () => {
  await withFakeKeyFile(async (keyFilePath) => {
    const mock = makeMockClients();
    let factoryArgs = null;
    const clientFactory = (args) => {
      factoryArgs = args;
      return { searchconsole: mock.searchconsole, analyticsdata: mock.analyticsdata };
    };

    const fetchers = resolveLiveFetchers({ liveFlag: true, env: { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: keyFilePath }, clientFactory });

    assert.equal(factoryArgs.keyFilePath, keyFilePath);

    await fetchers.fetchSearchConsolePageMetrics({ pageUrl: "https://example.test/x.html", startDate: "2026-09-10", endDate: "2026-09-16" });
    await fetchers.fetchUrlInspectionStatus({ pageUrl: "https://example.test/x.html" });
    await fetchers.fetchGA4PageMetrics({ pageUrl: "https://example.test/x.html", startDate: "2026-09-10", endDate: "2026-09-16" });
    await fetchers.fetchGA4CustomDimensionAvailability();
    const rakuten = await fetchers.fetchRakutenPerformance();

    assert.ok(mock.calls.some((c) => c[0] === "searchanalytics.query"), "mockのsearchanalytics.queryが実際に呼ばれたこと");
    assert.ok(mock.calls.some((c) => c[0] === "urlInspection.index.inspect"));
    assert.ok(mock.calls.some((c) => c[0] === "runReport"));
    assert.ok(mock.calls.some((c) => c[0] === "getMetadata"));
    assert.equal(rakuten.status, "NOT_CONNECTED");
  });
});

test("clientFactory未指定時の既定値はcreateLiveGoogleClients(本番用の実クライアント生成関数)である", () => {
  // 既定値の「参照」を確認するだけで、実際に呼び出しはしない(呼び出せばgoogle.auth.
  // GoogleAuthのインスタンス化まで進むため、このテストでは意図的に発火させない)。
  const source = resolveLiveFetchers.toString();
  assert.match(source, /clientFactory\s*=\s*createLiveGoogleClients/);
  assert.equal(typeof createLiveGoogleClients, "function");
});
