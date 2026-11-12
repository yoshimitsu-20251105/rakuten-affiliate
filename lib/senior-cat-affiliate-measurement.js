import { SITE_URL } from "./site-config.js";

// Pilot only. Neither other LPs nor the publication template opt into this code.
export const SENIOR_CAT_PATH = "/rakuten-affiliate/rankings/senior-cat-food.html";
export const SENIOR_CAT_URL = `${SITE_URL}/rankings/senior-cat-food.html`;
export const QA_QUERY_PATTERN = "[?&]amv2_qa=1(?:&|$)";

// This runs before the unchanged GA4 bootstrap. QA labels therefore also apply
// to automatic page_view / outbound click events, not only affiliate_click.
export const SENIOR_CAT_TRACKING_TAG = `<script id="senior-cat-affiliate-measurement">(function(){
  if (window.location.pathname !== ${JSON.stringify(SENIOR_CAT_PATH)} || window.__seniorCatAffiliateClickV1) return;
  window.__seniorCatAffiliateClickV1 = true;
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function(){ window.dataLayer.push(arguments); };
  }
  var qa = new RegExp(${JSON.stringify(QA_QUERY_PATTERN)}).test(window.location.search);
  var qaLabels = null;
  if (qa) {
    qaLabels = { traffic_type: 'qa', debug_mode: true, qa_traffic: 1 };
    var qaRun = new URLSearchParams(window.location.search).get('amv2_qa_run');
    if (qaRun && /^[A-Za-z0-9_-]{1,64}$/.test(qaRun)) qaLabels.qa_run_id = qaRun;
    window.gtag('set', qaLabels);
  }
  var sent = new WeakSet();
  document.addEventListener('click', function(ev){
    var target = ev.target;
    if (target && target.nodeType === 3) target = target.parentElement;
    var anchor = target && typeof target.closest === 'function' ? target.closest('a.cta-button[href]') : null;
    if (!anchor || sent.has(ev)) return;
    var link;
    try { link = new URL(anchor.href, window.location.href); } catch (_) { return; }
    if (link.protocol !== 'https:' || link.hostname !== 'hb.afl.rakuten.co.jp' || link.port || link.username || link.password) return;
    if (typeof window.gtag !== 'function') return;
    var params = {
      page_location: window.location.href,
      page_path: window.location.pathname,
      link_url: link.href,
      link_domain: link.hostname,
      link_classes: anchor.getAttribute('class') || '',
      target_lp: ${JSON.stringify(SENIOR_CAT_URL)},
      affiliate_network: 'rakuten'
    };
    var rank = anchor.getAttribute('data-item-rank');
    if (rank && /^[1-9][0-9]*$/.test(rank)) params.item_rank = Number(rank);
    ['animal_type', 'selection_type', 'page_type'].forEach(function(key){
      var value = anchor.getAttribute('data-' + key.replace(/_/g, '-'));
      if (value) params[key] = value;
    });
    // No inferred item/shop/measurement/experiment IDs. Current CTAs do not
    // provide verified bindings for those optional fields.
    if (qaLabels) Object.keys(qaLabels).forEach(function(key){ params[key] = qaLabels[key]; });
    sent.add(ev);
    window.gtag('event', 'affiliate_click', params);
    // Leave default navigation and GA4's independent standard click untouched.
  }, true);
})();</script>`;

// A standard built-in dimension avoids requiring a new GA4 custom dimension or
// a property/filter settings change. Every existing query for this LP uses it.
export function seniorCatBusinessPageFilter(pagePath) {
  const page = { filter: { fieldName: "pagePath", stringFilter: { matchType: "EXACT", value: pagePath } } };
  if (pagePath !== SENIOR_CAT_PATH) return page;
  return { andGroup: { expressions: [page, { notExpression: { filter: {
    fieldName: "pagePathPlusQueryString",
    stringFilter: { matchType: "PARTIAL_REGEXP", value: QA_QUERY_PATTERN, caseSensitive: true },
  } } }] } };
}
