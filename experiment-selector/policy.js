import { hash } from "../learning-engine/model.js";

export const GROUP = "AFFILIATE_MONETIZATION";
export const REVENUE_CLASSES = ["AFFILIATE_ACQUISITION", "AFFILIATE_NOTE_ACQUISITION", "DIRECT_REVENUE_VALIDATION"];
export const NON_REVENUE_CLASSES = ["SEO", "INDEXING", "DISCOVERY", "SEO_DISCOVERY", "MEASUREMENT_ONLY"];
export const TRACKS = ["OBSERVED_PERFORMANCE", "EXPLORATION"];
export const POLICY = Object.freeze({ version: "experiment-selector-v1", maxSelectionsPerRun: 1,
  initialMaxConcurrentMonetizationExperiments: 1, defaultMissingConcurrency: null, tracks: TRACKS,
  unknownComparison: "NO_SELECTION", ties: "NO_SELECTION", implicitTrackFallback: false, automatedActions: false });
export const POLICY_HASH = hash(POLICY);

// Compatibility contracts for declared legacy objectives, not title/keyword
// heuristics. If any objective field changes, the classification becomes UNKNOWN.
export const OBJECTIVE_FIELDS = ["hypothesis", "falsificationCondition", "trafficSource", "successThreshold", "killThreshold"];
export const LEGACY_OBJECTIVES = Object.freeze({
  "exp-2026-09-10-senior-dog-pork": ["23e0c157cc1c2076a02fa6b9d546b136ea6b0cbac8fa31c9f1c19ad4045ccbe3", "SEO_DISCOVERY"],
  "exp-2026-09-10-grain-free-cat-food": ["df5885b0041c7a79f16cb10a3e16bb3cd05e0767d83e9cd47e83e9964c09bc04", "SEO_DISCOVERY"],
  "exp-2026-10-05-grain-free-dog-food": ["84e3cbd37b516bec6cb943494d0ac8993fc26a9d47c514320475572189332f7b", "SEO_DISCOVERY"],
  "exp-2026-10-05-senior-cat-food": ["84e3cbd37b516bec6cb943494d0ac8993fc26a9d47c514320475572189332f7b", "SEO_DISCOVERY"],
  "exp-2026-10-05-domestic-additive-free-dog-treats": ["84e3cbd37b516bec6cb943494d0ac8993fc26a9d47c514320475572189332f7b", "SEO_DISCOVERY"],
  "exp-2026-10-13-grain-free-dog-channel-note-vs-x": ["9f9a99bc305413142bb9b1e239a22f59753c267eaffa1429db256361c7b30ad3", "AFFILIATE_ACQUISITION"],
});
export const objectiveHash = (e) => hash(Object.fromEntries(OBJECTIVE_FIELDS.map((k) => [k, e[k] ?? null])));
