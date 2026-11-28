const GSC_METRICS = ["impressions", "clicks"];

export function gscCoverage(report, rows, day0, asOf) {
  const { window, eligibleDays, excluded, awaitingFinalDataByMetric } = report;
  const result = {};
  for (const metric of GSC_METRICS) {
    const pending = new Set(awaitingFinalDataByMetric[metric]);
    const observed = rows.filter(({ date, [metric]: value }) =>
      date >= window.start && date <= window.end && !excluded.includes(date) && !pending.has(date) && value != null);
    const missingDays = eligibleDays - observed.length - pending.size;
    result[metric] = {
      observedTotal: observed.length ? observed.reduce((sum, row) => sum + row[metric], 0) : null,
      observedDays: observed.length,
      missingDays,
      pendingDays: pending.size,
      complete: eligibleDays > 0 && missingDays === 0 && pending.size === 0,
    };
  }
  return {
    day0, asOf, ...result,
    observedCtr: result.impressions.observedTotal > 0 &&
      rows.filter((row) => row.date >= window.start && row.date <= window.end &&
        !excluded.includes(row.date) && !awaitingFinalDataByMetric.impressions.includes(row.date))
        .every((row) => (row.clicks == null) === (row.impressions == null)) &&
      result.clicks.observedTotal != null
      ? result.clicks.observedTotal / result.impressions.observedTotal : null,
  };
}

export function reviewSuggestion(approvedReview, coverage, completed, asOf) {
  if (!approvedReview || asOf <= approvedReview.date) return "WAIT_FOR_REVIEW_DATE";
  if (!completed || !coverage.impressions.complete) return "HOLD_INCOMPLETE";
  const observed = coverage.impressions.observedTotal;
  if (observed >= approvedReview.success) return "SUCCESS_CANDIDATE";
  if (observed <= approvedReview.falsification) return "FALSIFICATION_CANDIDATE";
  return "HOLD_INTERMEDIATE";
}
