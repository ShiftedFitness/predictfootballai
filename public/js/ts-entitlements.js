/**
 * ts-entitlements.js — ONE definition of who can do what.
 *
 * Before this, the answer lived in four places that disagreed:
 *
 *   - public/community/index.html decided publishing with
 *     `TSAuth.getTier() === 'paid'`.
 *   - ts-data.js decided play limits with its own numbers.
 *   - public/upgrade/index.html described the rules in prose and a table,
 *     both of which were wrong (see AUDIT below).
 *   - create-checkout.js knew about plans nothing else knew about.
 *
 * This file is the client's copy of the rules. It is DESCRIPTIVE, not
 * enforcement: nothing here is a security boundary, because the browser is not
 * one. Server-side enforcement is tracked separately and is still outstanding
 * — see URGENT_TODO.md.
 *
 * ── AUDIT, 5 Oct 2026 ─────────────────────────────────────────────────────
 * Two things the upgrade page claimed that the code does not do:
 *
 *   1. "Day Pass: Community game creation ✗". Wrong. TSAuth.getTier() returns
 *      'paid' for an unexpired Day Pass, and the builder gates on exactly
 *      that, so Day Pass holders have always been able to create. Somebody
 *      paid £0.99 and was told they could not use something they could.
 *
 *   2. "Referral: Create games ✗". Wrong, and understated twice over:
 *      redeem-promo.js sets tier 'paid' with NO expiry, so a promo code grants
 *      LIFETIME Pro, creation included.
 *
 * The copy has been corrected to match the code. No entitlement was changed,
 * because changing one would change what existing customers already hold.
 */
(function () {
  'use strict';

  /**
   * Published-game allowances.
   *
   * Configurable here rather than scattered through the builder, so a change
   * of mind is one edit. These describe the INTENDED model from the Phase 2
   * brief; the free tier's ability to publish is not yet live, because turning
   * it on is an entitlement change that affects what Pro is worth to people
   * who have already paid for it. See the report.
   */
  var LIMITS = {
    anonymous: { publish: 0, drafts: 1 },
    free: { publish: 0, drafts: 3 },
    paid: { publish: Infinity, drafts: Infinity },
  };

  function tier() {
    try {
      if (!window.TSAuth || !TSAuth.getTier) return 'anonymous';
      return TSAuth.getTier();
    } catch (_) { return 'anonymous'; }
  }

  /** Lifetime Pro, a running Day Pass, or a redeemed code — all 'paid'. */
  function isPaid() { return tier() === 'paid'; }

  /** True when a Day Pass is what is paying for this, so copy can say so. */
  function isDayPass() {
    try {
      var u = TSAuth.getUser && TSAuth.getUser();
      return !!(u && u.tier === 'paid' && u.pro_expires_at &&
                new Date(u.pro_expires_at) > new Date());
    } catch (_) { return false; }
  }

  function limits() { return LIMITS[tier()] || LIMITS.anonymous; }

  function can(what) {
    var l = limits();
    if (what === 'publish') return l.publish > 0;
    if (what === 'saveDraft') return l.drafts > 0;
    if (what === 'advancedFilters') return isPaid();
    return false;
  }

  /**
   * Should this person be shown an upgrade prompt?
   *
   * Never to somebody who already holds the thing being advertised. A paying
   * customer being asked to upgrade is the fastest way to look like the site
   * does not know who they are.
   */
  function shouldPromptUpgrade() { return !isPaid(); }

  window.TSEntitlements = {
    tier: tier, isPaid: isPaid, isDayPass: isDayPass,
    limits: limits, can: can, shouldPromptUpgrade: shouldPromptUpgrade,
    LIMITS: LIMITS,
  };
})();
