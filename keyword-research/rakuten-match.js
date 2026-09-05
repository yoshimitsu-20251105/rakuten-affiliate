// 楽天商品照合層。
//
// 【厳守】
// - 楽天APIの検索結果総数 `count` は商品供給数(競合量)であり、検索需要ではない。
//   このモジュールはcountをスコアリングに使わない(rakutenSupplyFitはELIGIBLE件数のみを使う)。
// - 「国産」「無添加」等は、取得した実データ(itemName/catchcopy/itemCaption)に明記が
//   ある場合だけ一致とする。書かれていない属性を推定しない。
// - キーワードの必須属性と矛盾する商品(例: 猫用キーワードに対し明確に犬用と書かれた商品)は除外する。

import { extractAttributes } from "./attributes.js";
import { fetchWithRetry } from "./http.js";
import { readFile } from "node:fs/promises";

const FIXTURE_FILE = new URL("./fixtures/rakuten-items.fixture.json", import.meta.url);

const EXCLUSIVE_GROUPS = [
  ["species:dog", "species:cat"],
  ["lifeStage:puppy", "lifeStage:kitten", "lifeStage:senior", "lifeStage:adult"],
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRakutenConfigured() {
  return Boolean(process.env.RAKUTEN_APP_ID && process.env.RAKUTEN_SECRET);
}

/**
 * 実際の楽天商品検索API呼び出し(select-products.jsと同じ認証方式: Referer+Origin)。
 * @param {string} keyword
 * @returns {Promise<{ items: any[], count: number, source: 'live' }>}
 */
export async function searchRakutenItemsLive(keyword, { hits = 30 } = {}) {
  const appId = process.env.RAKUTEN_APP_ID;
  const accessKey = process.env.RAKUTEN_SECRET;
  const affiliateId = process.env.RAKUTEN_AFFILIATE_ID;
  const APP_URL = "https://yoshimitsu-20251105.github.io/rakuten-affiliate/";
  const APP_ORIGIN = "https://yoshimitsu-20251105.github.io";

  const url = new URL("https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701");
  url.searchParams.set("applicationId", appId);
  url.searchParams.set("accessKey", accessKey);
  if (affiliateId) url.searchParams.set("affiliateId", affiliateId);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("hits", String(hits));
  url.searchParams.set("sort", "-reviewCount");
  url.searchParams.set("format", "json");

  const res = await fetchWithRetry(url, {
    headers: { accessKey, Authorization: `Bearer ${accessKey}`, Origin: APP_ORIGIN },
    referrer: APP_URL,
    referrerPolicy: "no-referrer-when-downgrade",
    timeoutMs: 10000,
    maxRetries: 2,
  });
  // 【2026-09-05 マージ前最終監査(3周目)対応】以前はHTTPステータスを一切確認せず、
  // レスポンスbodyに`error`/`errors`フィールドがあるかどうかだけで異常を判定していた。
  // 429/5xx等がbackoff後もエラーステータスのまま返り、かつそのbodyが`error`/`errors`
  // という名前のフィールドを持たない形(例: 空body、別形式のエラーオブジェクト、
  // Itemsフィールドが欠損した200以外のレスポンス)だった場合、異常なHTTP応答が
  // 「商品0件の正常なレスポンス」として誤ってNO_MATCH扱いされてしまう欠陥があった。
  // res.okを最優先でチェックし、非2xxは(bodyの中身に関わらず)必ずAPI_ERRORとして
  // 呼び出し元(pipeline.js)へ例外を投げる。
  if (!res.ok) {
    let bodyPreview = "";
    try {
      const text = await res.text();
      bodyPreview = text.slice(0, 200); // レスポンス全文は保存・表示しない(先頭200文字のみ)
    } catch {
      // bodyの読み取り自体に失敗した場合は無視してステータスのみ報告する
    }
    throw new Error(`楽天APIエラー: HTTP ${res.status}${bodyPreview ? ` - ${bodyPreview}` : ""}`);
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`楽天APIエラー: レスポンスのJSON解析に失敗(${e.message})`);
  }
  if (data.error || data.errors) {
    const msg = data.error ? `${data.error} ${data.error_description ?? ""}` : `${data.errors.errorCode} ${data.errors.errorMessage ?? ""}`;
    throw new Error(`楽天APIエラー: ${msg}`);
  }
  if (!Array.isArray(data.Items)) {
    // Itemsフィールドが配列でない(欠損・null等)場合は「商品0件」と「異常応答」を
    // 区別できないため、安全側に倒してエラーとして扱う(黙って空配列にしない)。
    throw new Error("楽天APIエラー: レスポンスにItemsフィールドが存在しない、または配列ではない");
  }
  return { items: data.Items.map((w) => w.Item), count: data.count ?? 0, source: "live" };
}

/**
 * fixtureフォールバック(楽天API未設定時)。単純なキーワード部分一致で候補を返す。
 */
export async function searchRakutenItemsFixture(keyword) {
  const raw = await readFile(FIXTURE_FILE, "utf-8");
  /** @type {any[]} */
  const all = JSON.parse(raw);
  const items = all.filter((item) => keywordMatchesItemLoosely(keyword, item));
  return { items, count: items.length, source: "fixture" };
}

function keywordMatchesItemLoosely(keyword, item) {
  const text = normalizeText(`${item.itemName} ${item.catchcopy ?? ""}`);
  const tokens = normalizeText(keyword).split(" ").filter(Boolean);
  // ゆるい一致: キーワードトークンの半分以上がitem内に出現すれば候補とする(fixtureは母数が少ないため)
  const hitCount = tokens.filter((t) => text.includes(t)).length;
  return tokens.length === 0 || hitCount / tokens.length >= 0.34;
}

function normalizeText(s) {
  return String(s ?? "").normalize("NFKC").toLowerCase();
}

/**
 * 環境変数の有無に応じてlive/fixtureを自動選択する検索関数を返す。
 * @returns {{ search: (keyword: string) => Promise<{items:any[], count:number, source:string}>, usedFixtureFallback: boolean }}
 */
export function createRakutenSearchFn() {
  if (isRakutenConfigured()) {
    return {
      search: async (keyword) => {
        const result = await searchRakutenItemsLive(keyword);
        await sleep(1200); // 楽天APIのレート制限(1秒1回)を守る
        return result;
      },
      usedFixtureFallback: false,
    };
  }
  // 【2026-09-05 マージ前最終監査(3周目)対応】RAKUTEN_APP_ID/RAKUTEN_SECRETが
  // 未設定(例: --env-file-if-exists=.envを付け忘れて実行した場合)だと、ここで
  // 静かに9件のみのテスト用fixtureへフォールバックする。これに気づかず「実データの
  // 楽天照合結果」として扱うと、実際の楽天在庫とは無関係な少数固定データを分析している
  // ことになり、実行結果の解釈を誤る(2026-09-05のマージ前最終監査で実際に発生した事故:
  // .envを読み込まずにこの関数を直接呼び出すスクリプトを実行し、fixtureフォールバック
  // に気づかないまま「楽天ELIGIBLE件数が90→47に激減した」と誤認した)。
  // このモジュールを直接呼び出すすべての呼び出し元(CLIに限らない)で必ず気づけるよう、
  // ここで一度だけ警告を出す。
  console.warn(
    "[rakuten-match] 警告: RAKUTEN_APP_ID/RAKUTEN_SECRETが未設定のため、実際の楽天APIではなく" +
      "keyword-research/fixtures/rakuten-items.fixture.json(テスト用の9件の固定データ)へ" +
      "フォールバックしています。実データの楽天照合結果ではありません。" +
      "`node --env-file-if-exists=.env ...`のように.envを読み込んで実行してください。"
  );
  return {
    search: (keyword) => searchRakutenItemsFixture(keyword),
    usedFixtureFallback: true,
  };
}

/**
 * @param {string} canonicalKeyword
 * @param {string[]} requiredAttributes
 * @param {any[]} items
 * @param {{ minEligibleProductsForRankingPage: number }} matchingRules
 * @returns {{ matches: import('./types.js').KeywordProductMatch[], eligibleCount: number, supplyCount: number }}
 */
export function matchKeywordToItems(canonicalKeyword, requiredAttributes, items, matchingRules) {
  const matches = items.map((item) => matchOneItem(canonicalKeyword, requiredAttributes, item));
  const eligibleCount = matches.filter((m) => m.status === "ELIGIBLE").length;
  return { matches, eligibleCount, supplyCount: items.length };
}

function matchOneItem(canonicalKeyword, requiredAttributes, item) {
  const itemText = normalizeText(`${item.itemName ?? ""} ${item.catchcopy ?? ""} ${item.itemCaption ?? ""}`);
  const itemAttributeTags = new Set(extractAttributes(itemText));

  if (requiredAttributes.length === 0) {
    return {
      canonicalKeyword,
      itemCode: item.itemCode,
      requiredAttributes,
      matchedAttributes: [],
      missingAttributes: [],
      conflictingAttributes: [],
      matchScore: 100,
      status: "ELIGIBLE",
      reasons: ["キーワードから明示的な必須属性が抽出できなかったため、条件検証をスキップしELIGIBLE扱い"],
    };
  }

  const matched = requiredAttributes.filter((a) => itemAttributeTags.has(a));
  const missing = requiredAttributes.filter((a) => !itemAttributeTags.has(a));
  const conflicting = [];
  for (const required of requiredAttributes) {
    const group = EXCLUSIVE_GROUPS.find((g) => g.includes(required));
    if (!group) continue;
    const conflictTag = [...itemAttributeTags].find((tag) => group.includes(tag) && tag !== required);
    if (conflictTag && !itemAttributeTags.has(required)) {
      conflicting.push(conflictTag);
    }
  }

  const matchScore = Math.round((matched.length / requiredAttributes.length) * 100);
  const reasons = [];
  let status;
  if (conflicting.length > 0) {
    status = "REJECTED";
    reasons.push(`必須属性と矛盾する記載を検出(${conflicting.join(", ")})のため除外`);
  } else if (missing.length === 0) {
    status = "ELIGIBLE";
    reasons.push("必須属性がすべて商品データ(itemName/catchcopy/itemCaption)に明記されていることを確認");
  } else if (matched.length > 0) {
    status = "NEEDS_MANUAL_REVIEW";
    reasons.push(`一部属性(${missing.join(", ")})が商品データに明記されておらず、根拠不十分のため手動確認が必要`);
  } else {
    status = "REJECTED";
    reasons.push("必須属性がいずれも商品データに明記されておらず、根拠なしのため除外");
  }

  return {
    canonicalKeyword,
    itemCode: item.itemCode,
    requiredAttributes,
    matchedAttributes: matched,
    missingAttributes: missing,
    conflictingAttributes: conflicting,
    matchScore,
    status,
    reasons,
  };
}
