/**
 * ts-howto.js — the "how to play" popovers.
 *
 * Extracted from team-page.js so the Games hub runs the same code rather than
 * a second copy that drifts. One open at a time; closes on Escape or a click
 * outside.
 *
 * The buttons are siblings of the card anchors, so nothing here has to cancel
 * a navigation that was never going to start.
 */
(function () {
  'use strict';

  function init() {
    var btns = document.querySelectorAll('.howto');
    if (!btns.length) return;

    function closeAll(except) {
      for (var i = 0; i < btns.length; i++) {
        if (btns[i] === except) continue;
        btns[i].setAttribute('aria-expanded', 'false');
        var pop = document.getElementById(btns[i].getAttribute('aria-controls'));
        if (pop) pop.hidden = true;
      }
    }

    Array.prototype.forEach.call(btns, function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var pop = document.getElementById(btn.getAttribute('aria-controls'));
        if (!pop) return;
        var open = btn.getAttribute('aria-expanded') === 'true';
        closeAll(btn);
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        pop.hidden = open;
      });
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.howto, .howpop')) closeAll(null);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll(null);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
