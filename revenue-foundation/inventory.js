import { readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { createHash } from "node:crypto";
import { SITE_URL } from "../lib/site-config.js";

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
  .map((match) => [match[1].toLowerCase(), match[2] ?? match[3]]));
const strip = (html) => html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ")
  .replace(/&(amp|lt|gt|quot|nbsp|#39);/gi, " ").replace(/\s+/g, " ").trim();
const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const bigrams = (value) => new Set(Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2)));
const similar = (left, right) => {
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter((gram) => right.has(gram)).length;
  return shared * 2 / (left.size + right.size);
};
const site = new URL(SITE_URL.replace(/\/$/, "") + "/");

function pageInfo(path, html, sitemap) {
  const headings = [...html.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].map((m) => strip(m[1]));
  const title = strip(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const body = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? "";
  const robots = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]))
    .filter((meta) => ["robots", "googlebot"].includes(meta.name?.toLowerCase())).map((meta) => meta.content ?? "").join(",");
  const links = [...html.matchAll(/<a\b[^>]*>/gi)].map((match) => attrs(match[0])).filter((link) => link.href);
  const targets = links.flatMap((link) => {
    try {
      const url = new URL(link.href, new URL(path, site));
      return url.origin === site.origin && url.pathname.startsWith(site.pathname)
        ? [url.pathname.slice(site.pathname.length) || "index.html"] : [];
    } catch {
      return [];
    }
  });
  const affiliateLinks = links.filter((link) => /^https:\/\/(?:hb|a)\.afl\.rakuten\.co\.jp\//i.test(link.href));
  const characters = [...strip(body).replace(/\s/g, "")].length;
  const shop = posix.basename(path).split("_")[0];
  const productFamily = title.normalize("NFKC").toLowerCase().replace(/\d+(?:\.\d+)?\s*(?:kg|g|ml|l|個|袋|本|枚|尾|食|セット|パック|人前)/gu, "").replace(/[\p{P}\p{Z}\s]/gu, "");
  return { pagePath: path, title,
    indexability: { robotsDirective: /\b(?:noindex|none)\b/i.test(robots) ? "NOINDEX" : "INDEX_ALLOWED_BY_PAGE",
      inSitemap: sitemap.has(new URL(path, site).href), googleIndexState: "UNKNOWN" },
    contentDepth: { mainTextCharacters: characters, sectionHeadings: headings.length, originalValue: "UNKNOWN" },
    shop, productFamily,
    affiliateProductValidity: { affiliateLinks: affiliateLinks.length, sponsoredLinks: affiliateLinks.filter((link) => /(?:^|\s)sponsored(?:\s|$)/i.test(link.rel ?? "")).length,
      destinationValidity: "UNKNOWN", commercialIntent: affiliateLinks.length ? "PRODUCT_CTA_PRESENT" : "UNKNOWN" },
    internalLinkRole: { inboundPages: 0, outboundPages: new Set(targets.filter((target) => target !== path)).size },
    searchConsole: { availability: "UNKNOWN", impressions: null, clicks: null },
    targets: new Set(targets.filter((target) => target !== path)),
  };
}

export async function buildLegacyInventory(root) {
  const articles = (await readdir(join(root, "articles"))).filter((file) => file.endsWith(".html")).sort();
  const rankings = (await readdir(join(root, "rankings"))).filter((file) => file.endsWith(".html")).sort();
  const sitemapXml = await readFile(join(root, "sitemap.xml"), "utf8");
  const sitemap = new Set([...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim()));
  const allPages = ["index.html", ...articles.map((file) => "articles/" + file), ...rankings.map((file) => "rankings/" + file)];
  const pages = await Promise.all(allPages.map(async (path) => pageInfo(path, await readFile(join(root, path), "utf8"), sitemap)));
  const byPath = new Map(pages.map((page) => [page.pagePath, page]));
  const articlesOnly = pages.filter((page) => page.pagePath.startsWith("articles/"));
  for (const page of pages) {
    for (const target of page.targets) {
      const linked = byPath.get(target);
      if (linked) linked.internalLinkRole.inboundPages++;
    }
  }
  const clusters = new Map();
  const profiles = articlesOnly.map((page) => ({ page, grams: bigrams(page.productFamily) }));
  for (const [index, profile] of profiles.entries()) {
    for (const other of profiles.slice(index + 1)) {
      const left = profile.page;
      const right = other.page;
      if (!left.productFamily || left.shop !== right.shop ||
        left.productFamily !== right.productFamily && similar(profile.grams, other.grams) < 0.87) continue;
      const group = new Set([...(clusters.get(left.pagePath) ?? [left.pagePath]), ...(clusters.get(right.pagePath) ?? [right.pagePath])]);
      for (const path of group) clusters.set(path, group);
    }
  }
  const inventory = articlesOnly.map(({ shop, productFamily, targets, ...page }) => {
    const group = clusters.get(page.pagePath);
    const duplicateCluster = group ? { id: digest([...group].sort().join("\n")), memberCount: group.size,
      method: "SAME_SHOP_NORMALIZED_TITLE_BIGRAM_SIMILARITY" } : null;
    const needsReview = !page.affiliateProductValidity.affiliateLinks || !page.indexability.inSitemap ||
      page.indexability.robotsDirective === "NOINDEX" ||
      page.affiliateProductValidity.sponsoredLinks !== page.affiliateProductValidity.affiliateLinks ||
      !page.internalLinkRole.inboundPages || page.contentDepth.mainTextCharacters < 350;
    return { ...page, duplicateCluster, cannibalizationRisk: duplicateCluster ? "POSSIBLE" : "UNKNOWN",
      recommendedDisposition: duplicateCluster ? "CONSOLIDATE" : needsReview ? "IMPROVE" : "KEEP",
      confidence: "LOW" };
  });
  const priority = { CONSOLIDATE: 0, IMPROVE: 1, KEEP: 2 };
  return { schemaVersion: 1, pageCount: inventory.length, applyChanges: false,
    inventory: inventory.sort((a, b) => priority[a.recommendedDisposition] - priority[b.recommendedDisposition]) };
}
