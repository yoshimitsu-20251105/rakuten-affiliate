import { createHash } from "node:crypto";
import { SITE_URL } from "../lib/site-config.js";

export const WEIGHTS = Object.freeze({
  searchIntentFit: 15, originalAnalysis: 20, comparisonSpecificity: 15, freshness: 10,
  evidence: 10, titleH1Alignment: 5, internalLinks: 5, mobileUX: 5, performance: 5,
  ctaFit: 5, affiliateCompliance: 5,
});
export const THRESHOLD = 80;

const REQUIRED = ["searchIntentFit", "originalAnalysis", "evidence"];
const DAY = 86_400_000;
const MAX_AGE = {
  searchIntentFit: 30, originalAnalysis: 90, comparisonSpecificity: 90, freshness: 30,
  evidence: 90, performance: 30, ctaFit: 90, scaledContentRisk: 30, fakeExperience: 90,
};
const EXPERIENCE = /愛用|実際に\s*(?:使用|利用|試用)|使っ\s*(?:た|てみ(?:た|ました))|使って\s*みて|試し\s*(?:た|てみ(?:た|ました))|食べて\s*み(?:た|ました)|実食|毎日\s*使っています|筆者が\s*使用|購入して\s*確かめ(?:た|ました)|愛(?:犬|猫)が\s*(?:喜んで\s*)?食べ(?:た|ました)|\b(?:I|we) (?:used|tested|tried)\b/iu;
const NO_EXPERIENCE = /(?:未使用|使用していません|使用しておりません|使っていません|試していません|実食していません|実食レビューではありません|実際に使ったわけではありません|愛用していません|\b(?:did not|never) (?:use|test|try)\b)/iu;
const DISCLOSURE = /アフィリエイト(?:広告|リンク|プログラム)|広告を含(?:み|む)|広告が含ま|affiliate (?:links?|disclosure)|(?:earn|receive) (?:a |an )?commission/iu;
const TAG = /<\/?[a-z][\w:-]*(?:"[^"]*"|'[^']*'|[^'"<>])*>/gi;
const text = (v) => typeof v === "string" && v.trim().length > 0;
const number = (v, min = 0, max = Infinity) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const sha256 = (v) => createHash("sha256").update(v, "utf8").digest("hex");
const normalize = (v) => v.normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/gu, "").replace(/\s+/gu, " ").trim();
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (v) => v.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);?/gi, (match, ref) => {
  if (!ref.startsWith("#")) return ENTITIES[ref.toLowerCase()];
  const code = /^#x/i.test(ref) ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
});
const plain = (html) => normalize(decode(html.replace(TAG, (tag) => /^<\/?(?:p|div|main|section|article|li|h[1-6]|br|footer)\b/i.test(tag) ? " " : "")));
const attrs = (tag) => {
  const result = Object.create(null);
  for (const [, key, double, single, bare] of tag.replace(/^<[^\s>]+/, "")
    .matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const name = key.toLowerCase();
    if (!Object.hasOwn(result, name)) result[name] = decode(double ?? single ?? bare ?? "");
  }
  return result;
};
const httpUrl = (value, base) => {
  if (!text(value)) return null;
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
};

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function visibleBody(markup) {
  const hidden = [];
  let cursor = 0;
  let output = "";
  for (const match of markup.matchAll(TAG)) {
    const [tag] = match;
    if (!hidden.length) output += markup.slice(cursor, match.index);
    cursor = match.index + tag.length;
    const [, close, name] = /^<(\/?)([\w:-]+)/i.exec(tag);
    const type = name.toLowerCase();
    if (close) {
      if (!hidden.length) output += tag;
      else if (hidden.at(-1) === type) hidden.pop();
    } else {
      const a = attrs(tag);
      const concealed = Object.hasOwn(a, "hidden") ||
        /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(a.style ?? "");
      if (!hidden.length && !concealed) output += tag;
      else if (!VOID_TAGS.has(type)) hidden.push(type);
    }
  }
  return output + (hidden.length ? "" : markup.slice(cursor));
}

function inspectHtml(html, target) {
  const visible = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template|noscript|textarea)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "");
  const head = visible.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] ?? "";
  const body = visibleBody(visible.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, ""));
  const title = plain(head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "");
  const headings = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)].map((match) => plain(match[1]));
  const viewport = [...head.matchAll(TAG)].filter(([tag]) => /^<meta\b/i.test(tag)).map(([tag]) => attrs(tag))
    .find((tag) => tag.name?.trim().toLowerCase() === "viewport");
  const baseTag = [...head.matchAll(TAG)].find(([tag]) => /^<base\b/i.test(tag));
  const base = (baseTag && httpUrl(attrs(baseTag[0]).href, target)) || target;
  const links = [...body.matchAll(TAG)].filter(([tag]) => /^<a\b/i.test(tag)).map(([tag]) => {
    const a = attrs(tag);
    return { url: httpUrl(a.href, base), rel: (a.rel ?? "").toLowerCase().split(/\s+/), href: a.href ?? "" };
  });
  const internal = links.some(({ url, href }) => url && url.origin === target.origin && !href.trim().startsWith("#") &&
    (url.pathname !== target.pathname || url.search !== target.search));
  const affiliates = links.filter(({ url, rel }) => rel.includes("sponsored") || url &&
    /(?:^|\.)afl\.rakuten\.co\.jp$|(?:^|\.)a\.r10\.to$/i.test(url.hostname));
  const affiliateLabels = [...body.matchAll(/(<a\b(?:"[^"]*"|'[^']*'|[^'"<>])*>)([\s\S]*?)<\/a\s*>/gi)]
    .filter(([, tag]) => {
      const a = attrs(tag);
      const url = httpUrl(a.href, base);
      return url && affiliates.some((link) => link.url?.href === url.href);
    }).map(([, , label]) => plain(label)).filter(text);
  const content = plain(body);
  const main = body.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)\s*>/i)?.[1] ?? body;
  const sentences = body.replace(/<\/?(?:p|div|main|section|article|li|h[1-6]|br|footer)\b[^>]*>/gi, "\n")
    .split(/[。！？!?\n]+/u).map(plain).filter(text);
  return {
    content, main: plain(main), title, headings, viewport, internal, affiliates, affiliateLabels,
    disclosure: DISCLOSURE.test(content),
    claims: [...new Set(sentences.filter((sentence) => EXPERIENCE.test(sentence.replace(NO_EXPERIENCE, ""))))],
  };
}

const hasQuote = (value, page) => text(value) && normalize(value).length >= 8 && page.main.includes(normalize(value));
const timestamp = (value) => typeof value === "string" && /^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;

function evidenceByUse(register, targetHash, asOf) {
  const byUse = new Map();
  const seen = new Set();
  for (const item of register) {
    if (!text(item?.id) || seen.has(item.id)) throw Error("Invalid or duplicate verified evidence ID");
    seen.add(item.id);
    const age = asOf - timestamp(item.observedAt);
    if (!targetHash || item.targetHash !== targetHash || !text(item.sourceRef) || item.isSynthetic !== false ||
      item.evidenceType !== "FACT" || !Object.hasOwn(MAX_AGE, item.appliesTo) ||
      !number(age, 0, MAX_AGE[item.appliesTo] * DAY) ||
      !item.observation || typeof item.observation !== "object" || Array.isArray(item.observation)) continue;
    const rows = byUse.get(item.appliesTo) ?? [];
    rows.push(item);
    byUse.set(item.appliesTo, rows);
  }
  return byUse;
}

function externalPoints(name, o, page, asOf) {
  switch (name) {
    case "searchIntentFit":
      if (!text(o.query) || !count(o.reviewedResults) || o.reviewedResults < 3 ||
        !["TRANSACTIONAL", "COMMERCIAL", "INFORMATIONAL", "NAVIGATIONAL"].includes(o.intent) || !hasQuote(o.pageQuote, page)) return null;
      return ["TRANSACTIONAL", "COMMERCIAL"].includes(o.intent) ? 15 : 0;
    case "originalAnalysis":
      if (!hasQuote(o.pageQuote, page) || !["UNIT_COST", "MEASURED_TEST", "COMPARATIVE_ANALYSIS", "NONE"].includes(o.method) ||
        !count(o.independentInputs) || typeof o.reproducible !== "boolean") return null;
      return o.method !== "NONE" && o.independentInputs >= 2 && o.reproducible ? 20 : 0;
    case "comparisonSpecificity":
      if (!hasQuote(o.pageQuote, page) || !count(o.comparedProducts) || !count(o.comparisonCriteria)) return null;
      return o.comparedProducts >= 2 && o.comparisonCriteria >= 2 ? 15 : 0;
    case "freshness": {
      const age = asOf - timestamp(o.checkedAt);
      if (!number(age) || typeof o.materialFactsCurrent !== "boolean") return null;
      return age <= 30 * DAY && o.materialFactsCurrent ? 10 : 0;
    }
    case "evidence":
      if (!hasQuote(o.pageQuote, page) || !count(o.checkedClaims) || !count(o.supportedClaims) ||
        o.checkedClaims === 0 || o.supportedClaims > o.checkedClaims) return null;
      return o.checkedClaims === o.supportedClaims ? 10 : 0;
    case "performance":
      if (!number(o.lcpMs) || !number(o.inpMs) || !number(o.cls) || o.device !== "MOBILE") return null;
      return (o.lcpMs <= 2500 ? 2 : 0) + (o.inpMs <= 200 ? 2 : 0) + (o.cls <= 0.1 ? 1 : 0);
    case "ctaFit":
      if (!text(o.linkLabel) || typeof o.destinationMatches !== "boolean" ||
        !page.affiliateLabels.includes(normalize(o.linkLabel))) return null;
      return o.destinationMatches ? 5 : 0;
    default:
      return null;
  }
}

function scaledRisk(page, rows) {
  if (page.main.replace(/\s/g, "").length < 100) return "FAIL";
  const observed = rows.map(({ observation: o }) => {
    if (!count(o.comparedPages) || o.comparedPages < 1 || !number(o.maxSimilarity, 0, 1) ||
      !count(o.doorwayPages) || !count(o.thinPages) || o.doorwayPages > o.comparedPages || o.thinPages > o.comparedPages) return "UNKNOWN";
    return o.maxSimilarity >= 0.9 || o.doorwayPages > 0 || o.thinPages > 0 ? "FAIL" : "PASS";
  });
  return observed.includes("FAIL") ? "FAIL" : observed.includes("PASS") ? "PASS" : "UNKNOWN";
}

export function evaluateQuality(input, { verifiedEvidence = [] } = {}) {
  if (input?.schemaVersion !== 1 || !Array.isArray(verifiedEvidence)) throw Error("Invalid Quality Gate input");
  const html = input.html ?? input.content;
  const target = httpUrl(input.targetUrl ?? input.pagePath, SITE_URL + "/");
  const targetHash = text(html) ? sha256(html) : null;
  const artifactMismatch = Boolean(targetHash && input.targetHash != null && input.targetHash !== targetHash);
  const missingHash = targetHash && input.targetHash == null;
  const asOf = timestamp(input.asOf);
  const page = target && targetHash && !artifactMismatch ? inspectHtml(html, target) : null;
  const checked = evidenceByUse(verifiedEvidence, page && !missingHash ? targetHash : null, asOf);
  const affiliate = !page?.content ? "UNKNOWN" : page.affiliates.length === 0 ? "UNKNOWN" :
    page.disclosure && page.affiliates.every(({ url, rel }) => url?.protocol === "https:" && rel.includes("sponsored")) ? "PASS" : "FAIL";
  const fake = !page?.content ? "UNKNOWN" : page.claims.every((claim) =>
    (checked.get("fakeExperience") ?? []).some(({ observation: o }) => o.claim === claim && o.actualUse === "USED") &&
    !(checked.get("fakeExperience") ?? []).some(({ observation: o }) => o.claim === claim && o.actualUse === "NOT_USED")) ? "PASS" : "FAIL";
  const staticPoints = page ? {
    titleH1Alignment: !page.title || !page.headings.length ? null :
      page.headings.length === 1 && page.headings[0] && page.title.toLowerCase().includes(page.headings[0].toLowerCase()) ? 5 : 0,
    internalLinks: page.internal ? 5 : 0,
    mobileUX: page.viewport ? (/\bwidth\s*=\s*device-width\b/i.test(page.viewport.content ?? "") &&
      !/user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\.0+)?(?:\s*[,;]|\s*$)/i.test(page.viewport.content ?? "") ? 5 : 0) : null,
    affiliateCompliance: affiliate === "PASS" ? 5 : affiliate === "FAIL" ? 0 : null,
  } : {};

  const dimensions = {};
  const accepted = new Set();
  for (const [name, maxPoints] of Object.entries(WEIGHTS)) {
    const results = (checked.get(name) ?? []).map((item) => ({ item, points: externalPoints(name, item.observation, page, asOf) }))
      .filter(({ points }) => points !== null);
    const evidenceRefs = results.map(({ item }) => item.id).sort();
    for (const id of evidenceRefs) accepted.add(id);
    const points = Object.hasOwn(staticPoints, name) ? staticPoints[name] :
      results.length ? Math.min(...results.map((result) => result.points)) : null;
    dimensions[name] = { points, maxPoints, status: points === null ? "UNKNOWN" : "ASSESSED", evidenceRefs };
  }
  const required = REQUIRED.map((name) => dimensions[name].points);
  const hardGates = {
    affiliateCompliance: affiliate,
    fakeExperience: fake,
    scaledContentRisk: page?.content ? scaledRisk(page, checked.get("scaledContentRisk") ?? []) : "UNKNOWN",
    requiredEvidence: required.includes(0) ? "FAIL" : required.includes(null) ? "UNKNOWN" : "PASS",
  };
  const rows = Object.entries(dimensions);
  const score = rows.reduce((sum, [, d]) => sum + (d.points ?? 0), 0);
  const possibleScore = score + rows.reduce((sum, [, d]) => sum + (d.points === null ? d.maxPoints : 0), 0);
  const blockingReasons = Object.entries(hardGates).filter(([, state]) => state !== "PASS").map(([name, state]) => `${name}: ${state}`);
  if (artifactMismatch) blockingReasons.push("Artifact hash mismatch");
  else if (!page?.content) blockingReasons.push("Artifact content and target required");
  else if (missingHash) blockingReasons.push("Declared artifact hash required");
  if (possibleScore < THRESHOLD) blockingReasons.push("Score below threshold");
  else if (score < THRESHOLD) blockingReasons.push("Threshold not established");
  const gateStates = Object.values(hardGates);
  const status = artifactMismatch || gateStates.includes("FAIL") || possibleScore < THRESHOLD ? "FAIL" :
    missingHash || gateStates.includes("UNKNOWN") || score < THRESHOLD ? "UNKNOWN" : "PASS";
  return { targetHash, score, threshold: THRESHOLD, status, hardGates, dimensions, blockingReasons,
    warnings: rows.filter(([, d]) => d.points === null).map(([name]) => `${name}: UNKNOWN`),
    evidence: verifiedEvidence.filter((item) => accepted.has(item.id) || ["scaledContentRisk", "fakeExperience"].includes(item.appliesTo) &&
      checked.get(item.appliesTo)?.includes(item)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
}
