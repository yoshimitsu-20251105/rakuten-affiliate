import { assert, keys, text, slug, PURPOSES } from "./model.js";
export const PROFILES = Object.freeze([
  { channel: "note", version: "v1", purpose: "AFFILIATE_NOTE_ACQUISITION", utmApplicable: true, source: "note", medium: "referral", trafficGrain: "CAMPAIGN_CONTENT", contentPurpose: "AFFILIATE_LP_ACQUISITION" },
  { channel: "x", version: "v1", purpose: "AFFILIATE_MONETIZATION", utmApplicable: true, source: "x", medium: "social", trafficGrain: "CAMPAIGN_CONTENT", contentPurpose: "AFFILIATE_LP_ACQUISITION" },
  { channel: "organic_search", version: "v1", purpose: "AFFILIATE_MONETIZATION", utmApplicable: false, source: null, medium: null, trafficGrain: "ORGANIC_PAGE_PERIOD", contentPurpose: "EXISTING_LP_ORGANIC_OBSERVATION" },
]);
export function channelProfile(channel, extensions = []) {
  const seen = new Set(PROFILES.map((p) => p.channel));
  for (const p of extensions) {
    keys(p, ["channel", "version", "purpose", "utmApplicable", "source", "medium", "trafficGrain", "contentPurpose"]);
    assert(slug(p.channel) && !seen.has(p.channel) && text(p.version) && p.purpose === "AFFILIATE_MONETIZATION", "Invalid/duplicate extension profile"); seen.add(p.channel);
    assert(p.utmApplicable === true && text(p.source) && text(p.medium) && p.trafficGrain === "CAMPAIGN_CONTENT" && p.contentPurpose === "AFFILIATE_LP_ACQUISITION", "Unsupported extension behavior");
  }
  return [...PROFILES, ...extensions].find((p) => p.channel === channel) ?? null;
}
