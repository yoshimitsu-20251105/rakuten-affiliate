// timeout・retry・backoffを備えた共通fetchラッパー。
// 4xx認証エラー(401/403)は無限retryせず即座に失敗として返す。

/**
 * @param {string|URL} url
 * @param {RequestInit & { timeoutMs?: number, maxRetries?: number }} options
 */
export async function fetchWithRetry(url, options = {}) {
  const { timeoutMs = 10000, maxRetries = 2, ...fetchOptions } = options;
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
        await sleep(backoffMs(attempt));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error("fetchWithRetry: 予期しない終了");
}

function backoffMs(attempt) {
  return 500 * 2 ** attempt;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
