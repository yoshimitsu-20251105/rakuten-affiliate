// timeout・retry・backoffを備えた共通fetchラッパー。
// 4xx認証エラー(401/403)は無限retryせず即座に失敗として返す。
//
// 【2026-09-06 PR#4監査対応】以前はbackoff間隔が500ms/1000msとなっており、
// 呼び出し元(rakuten-match.js)が守ろうとしているレート制限(最低1.2秒間隔)より
// 短かった。429/5xxでの内部再試行にも最低1.2秒(MIN_RETRY_INTERVAL_MS)を
// 適用し、楽天APIへの呼び出し間隔が常にレート制限を満たすようにする。

export const MIN_RETRY_INTERVAL_MS = 1200;

/**
 * @param {string|URL} url
 * @param {RequestInit & { timeoutMs?: number, maxRetries?: number, minRetryIntervalMs?: number }} options
 */
export async function fetchWithRetry(url, options = {}) {
  const { timeoutMs = 10000, maxRetries = 2, minRetryIntervalMs = MIN_RETRY_INTERVAL_MS, ...fetchOptions } = options;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...fetchOptions, signal: controller.signal });
      clearTimeout(timer);

      // 認証エラー(401/403)は再試行しても解決しないため、即座に返す
      if (res.status === 401 || res.status === 403) {
        return res;
      }
      // rate limit / 一時的サーバーエラーはbackoffして再試行
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        await sleep(backoffMs(attempt, minRetryIntervalMs));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt, minRetryIntervalMs));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error("fetchWithRetry: 予期しない終了");
}

function backoffMs(attempt, minRetryIntervalMs) {
  return Math.max(minRetryIntervalMs, 500 * 2 ** attempt);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
