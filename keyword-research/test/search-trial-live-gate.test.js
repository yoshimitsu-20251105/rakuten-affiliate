// 【2026-09-11監査対応】search-trial-live-gate.js のテスト。
// --live・SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED・GA_SEARCH_CONSOLE_KEY_FILEの
// 4条件(認証ファイルの実在・有効なJSON形式を含む)すべてを満たさない限り、
// Google APIクライアントを生成できる情報(検証済みkeyFilePath)を一切返さないこと、
// エラーメッセージに認証ファイルの実際のパス・内容を含めないことを確認する。
// このテストは一切のネットワークアクセスを行わない(fs操作のみ)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLiveExecutionAllowed } from "../search-trial-live-gate.js";

const REAL_REPO_CREDENTIALS_PATH = fileURLToPath(new URL("../../credentials/ga-search-console-key.json", import.meta.url));

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "search-trial-live-gate-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("実credentialsが既定場所に実在しても、--live未指定ではゲートを通過しない(このテストは実ファイルの中身を読まず、パスの存在だけ扱う)", () => {
  // このリポジトリの開発機には実際の認証ファイルが存在する場合があるが、
  // 「存在するだけ」ではゲートは絶対に通過しないことを、あえてその実パスを
  // GA_SEARCH_CONSOLE_KEY_FILEに設定したうえで確認する(--liveを指定しない)。
  assert.throws(
    () => assertLiveExecutionAllowed({ liveFlag: false, env: { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: REAL_REPO_CREDENTIALS_PATH } }),
    /--live/
  );
});

test("--liveだけではゲートを通過しない(feature flag未設定)", () => {
  assert.throws(() => assertLiveExecutionAllowed({ liveFlag: true, env: {} }), /SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED/);
});

test("feature flagだけではゲートを通過しない(--live未指定)", () => {
  assert.throws(() => assertLiveExecutionAllowed({ liveFlag: false, env: { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true" } }), /--live/);
});

test("--liveとfeature flagの両方があっても、認証ファイル環境変数が無ければゲートを通過しない", () => {
  assert.throws(
    () => assertLiveExecutionAllowed({ liveFlag: true, env: { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true" } }),
    /GA_SEARCH_CONSOLE_KEY_FILE/
  );
});

test("認証ファイル環境変数が存在しないパスを指す場合はゲートを通過しない", () => {
  assert.throws(
    () =>
      assertLiveExecutionAllowed({
        liveFlag: true,
        env: { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: "/definitely/does/not/exist/key.json" },
      }),
    /見つかりません/
  );
});

test("認証ファイルの形式が不正(JSONとして読めない)場合はゲートを通過しない", async () => {
  await withTempDir(async (dir) => {
    const badFile = join(dir, "bad.json");
    await writeFile(badFile, "{ not valid json", "utf-8");
    assert.throws(
      () => assertLiveExecutionAllowed({ liveFlag: true, env: { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: badFile } }),
      /形式が不正/
    );
  });
});

test("認証ファイルがJSONとして正しくても、サービスアカウントの必須項目(client_email/private_key)が無ければゲートを通過しない", async () => {
  await withTempDir(async (dir) => {
    const badFile = join(dir, "incomplete.json");
    await writeFile(badFile, JSON.stringify({ type: "service_account" }), "utf-8");
    assert.throws(
      () => assertLiveExecutionAllowed({ liveFlag: true, env: { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: badFile } }),
      /形式が不正/
    );
  });
});

test("4条件すべてを満たす場合はkeyFilePathを返す(ゲート自体はGoogle APIクライアントを生成しない)", async () => {
  await withTempDir(async (dir) => {
    const goodFile = join(dir, "fake-service-account.json");
    const fakeContent = { type: "service_account", client_email: "fake-test-account@example-not-real.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n" };
    await writeFile(goodFile, JSON.stringify(fakeContent), "utf-8");
    const result = assertLiveExecutionAllowed({ liveFlag: true, env: { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: goodFile } });
    assert.equal(result.keyFilePath, goodFile);
  });
});

test("feature flagの値が'true'という文字列以外(例: '1'や真偽値true)の場合はゲートを通過しない(厳密一致)", () => {
  assert.throws(
    () => assertLiveExecutionAllowed({ liveFlag: true, env: { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "1", GA_SEARCH_CONSOLE_KEY_FILE: "/x" } }),
    /SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED/
  );
});

test("エラーメッセージに認証ファイルの実際のパスを含めない", () => {
  try {
    assertLiveExecutionAllowed({
      liveFlag: true,
      env: { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: "/some/secret/looking/path/key.json" },
    });
    assert.fail("この呼び出しは例外を投げるはずです");
  } catch (e) {
    assert.doesNotMatch(e.message, /\/some\/secret\/looking\/path/);
  }
});
