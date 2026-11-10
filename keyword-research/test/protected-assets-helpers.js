// PR #40 extends the same content guards with explicit experiment-closure
// validation. Share that implementation so Safety tests cannot use an older
// policy that rejects approved closures or weakens production/LP protection.
export {
  permittedGeneratedUpdate,
  captureProtectedTree,
  assertProtectedTreeUnchanged,
  assertHistoricalProtection,
} from "./experiment-review-protection-helpers.js";
