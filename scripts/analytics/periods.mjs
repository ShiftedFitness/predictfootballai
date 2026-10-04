/**
 * periods.mjs
 *
 * The comparison windows the weekly report is built on.
 *
 * At small-site traffic volumes a single week is mostly noise, so the report
 * deliberately shows three horizons and labels which one decisions should be
 * made on:
 *
 *   momentum   last 7 complete days vs the 7 before  — anomaly detection only
 *   decision   last 28 complete days vs the 28 before — this drives choices
 *   trend      rolling 90 days                        — is it compounding?
 *
 * "Complete" matters. GA4 and Search Console both lag, and including today
 * or yesterday drags every number down and invents declines that aren't
 * real. Search Console is the worse offender — its data is typically 2-3
 * days behind — so it gets its own, later, cutoff.
 */

const DAY = 86400000;

const iso = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * @param lagDays how many trailing days to treat as incomplete and exclude.
 *   GA4 settles within about a day; Search Console needs three.
 */
export function windows(now = new Date(), lagDays = 1) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - lagDays * DAY);

  const back = (n) => new Date(end.getTime() - n * DAY);

  return {
    lagDays,
    momentum: {
      label: 'Last 7 days',
      current: { startDate: iso(back(6)), endDate: iso(end) },
      previous: { startDate: iso(back(13)), endDate: iso(back(7)) },
    },
    decision: {
      label: 'Last 28 days',
      current: { startDate: iso(back(27)), endDate: iso(end) },
      previous: { startDate: iso(back(55)), endDate: iso(back(28)) },
    },
    trend: {
      label: 'Rolling 90 days',
      current: { startDate: iso(back(89)), endDate: iso(end) },
    },
  };
}

/** Percentage change, guarding the "was zero" case that would divide by zero. */
export function delta(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c === 0 ? { abs: 0, pct: null } : { abs: c, pct: null };
  return { abs: c - p, pct: ((c - p) / p) * 100 };
}

/** "+18.4%" / "−12.0%" / "new" / "—" */
export function fmtDelta(d) {
  if (!d) return '—';
  if (d.pct === null) return d.abs > 0 ? 'new' : d.abs < 0 ? 'gone' : '—';
  if (Math.abs(d.pct) < 0.05) return '0%';
  const sign = d.pct > 0 ? '+' : '−';
  return `${sign}${Math.abs(d.pct).toFixed(1)}%`;
}
