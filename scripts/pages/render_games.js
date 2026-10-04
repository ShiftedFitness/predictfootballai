/**
 * render_games.js — the Games hub's markup.
 *
 * Today's challenge sits at the top because it is the reason to come back, and
 * because the Daily had been a separate destination somebody had to find. The
 * daily itself is still fetched by the same function and the streak still read
 * by the same ts-streak.js, so nothing about anybody's existing run changes.
 */
const { esc, num, SITE } = require('./build_games');

/** The six cards. One featured, five beside it — the club-page arrangement. */
function cards(GAMES, BRAND) {
  return GAMES.map((g) => {
    const how = g.how ? `<button type="button" class="howto" aria-expanded="false"
          aria-controls="how-${esc(g.key)}"><span class="vh">How to play ${esc(g.name)}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" aria-hidden="true"><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/>
            <path d="M12 17h.01"/></svg></button>
        <div class="howpop" id="how-${esc(g.key)}" role="note" hidden>${esc(g.how)}</div>` : '';
    const open = `<a class="game-go${g.featured ? ' feat' : ''}" href="${esc(g.path)}" data-game="${esc(g.key)}">`;
    if (g.featured) {
      return `<li class="feat">
        ${open}
          <span class="artbox">${g.art(BRAND)}</span>
          <span class="gtext">
            <span class="gtag">Most played</span>
            <span class="gname">${esc(g.name)}</span>
            <span class="gblurb">${esc(g.long || g.blurb)}</span>
            <span class="gplay">Play ${esc(g.name)}<svg viewBox="0 0 16 16" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              aria-hidden="true"><path d="M3 8h9M9 4.5 12.5 8 9 11.5"/></svg></span>
          </span>
        </a>${how}
      </li>`;
    }
    return `<li>
        ${open}
          <span class="artbox">${g.art(BRAND)}</span>
          <span class="gtext">
            <span class="gname">${esc(g.name)}</span>
            <span class="gblurb">${esc(g.blurb)}</span>
          </span>
        </a>${how}
      </li>`;
  }).join('\n      ');
}

function render(cov, GAMES, BRAND) {
  const title = 'Football Games & Quizzes: Test Your Knowledge | TeleStats';
  const description =
    `Six free football games built from real player records — ${num(cov.players)} players, ` +
    `${cov.clubs} clubs. Play a daily challenge, or pick your own club or competition.`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'TeleStats', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Games', item: `${SITE}/games/` }] },
      { '@type': 'ItemList', name: 'TeleStats football games',
        itemListElement: GAMES.map((g, i) => ({
          '@type': 'ListItem', position: i + 1, name: g.name, url: SITE + g.path })) },
    ],
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<script src="/js/ts-analytics.js"></script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}/games/">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}/games/">
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/telestats-theme.css">
<link rel="stylesheet" href="/css/ts-page.css">
<style>
  /* ── today's challenge ───────────────────────────────────────────────────
     The reason to come back, so it is the first thing and it is not a card
     like the others. Hidden until the daily resolves: a skeleton promising a
     challenge that then fails to load is worse than one that was never there. */
  .daily { border: 1px solid var(--line-2); border-radius: 14px; overflow: hidden;
           background: var(--s1); margin-bottom: 30px; }
  .daily[hidden] { display: none; }
  .dtop { display: flex; align-items: stretch; }
  .dart { flex: 0 0 34%; display: flex; align-items: center; justify-content: center;
          background: var(--s0); border-right: 1px solid var(--line); padding: 14px;
          color: var(--fg-3); }
  /* Only the pitch gets the pitch. */
  .dart:has(.art-pitch) { background: #0C2A1B; }
  .dart svg { width: 100%; height: auto; max-height: 150px; }
  .dbody { flex: 1; min-width: 0; padding: 16px 18px 17px; }
  .dtag { display: inline-flex; align-items: center; gap: 6px; font-size: .62rem; font-weight: 700;
          text-transform: uppercase; letter-spacing: .12em; color: var(--cyan); margin-bottom: 7px; }
  .dtag i { width: 6px; height: 6px; border-radius: 50%; background: var(--cyan); }
  .dname { font-family: var(--mono); font-size: 1.22rem; font-weight: 700; margin: 0;
           letter-spacing: -.02em; }
  .dscope { font-size: .84rem; color: var(--fg-2); margin: 5px 0 0; }
  .dplay { display: inline-flex; align-items: center; gap: 7px; margin-top: 13px;
           font-size: .88rem; font-weight: 700; padding: 11px 20px; min-height: 44px;
           box-sizing: border-box; border-radius: 10px; background: var(--cyan);
           color: #06181C; text-decoration: none; }
  .dplay:hover { filter: brightness(1.08); }
  .dplay svg { width: 15px; height: 15px; }
  .dstreak { display: flex; gap: 0; border-top: 1px solid var(--line); }
  .dstreak div { flex: 1; padding: 10px 14px; }
  .dstreak div + div { border-left: 1px solid var(--line); }
  .dstreak b { display: block; font-family: var(--mono); font-size: 1.05rem; font-weight: 700;
               font-variant-numeric: tabular-nums; }
  .dstreak span { font-size: .62rem; text-transform: uppercase; letter-spacing: .1em;
                  color: var(--fg-3); }
  .ddone { color: var(--cyan); }

  /* ── the six ─────────────────────────────────────────────────────────── */
  /* Six, three across. Not 1 + 5: that leaves one card alone on a third row
     at every width, which reads as a mistake rather than a choice. */
  ul.games { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px;
             grid-template-columns: repeat(3, 1fr); }
  ul.games li { position: relative; }
  ul.games li.feat { grid-column: span 2; grid-row: span 2; }
  a.game-go { position: relative; display: flex; flex-direction: column; height: 100%;
              box-sizing: border-box; overflow: hidden; border-radius: 12px;
              background: var(--s1); border: 1px solid var(--line);
              text-decoration: none; color: var(--fg);
              transition: background .14s, border-color .14s, transform .14s; }
  a.game-go:hover, a.game-go:focus-visible { background: var(--s2); transform: translateY(-2px);
              border-color: color-mix(in srgb, var(--cyan) 50%, var(--line-2)); }
  a.game-go:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
  .artbox { display: flex; align-items: center; justify-content: center; background: var(--s0);
            border-bottom: 1px solid var(--line); color: var(--fg-3); overflow: hidden; }
  a.game-go:not(.feat) .artbox { flex: 1; min-height: 84px; padding: 10px 12px; box-sizing: border-box; }
  a.game-go:not(.feat) .art { width: 100%; height: 100%; max-height: 112px; }
  a.game-go.feat .artbox { flex: 1; min-height: 168px; padding: 14px 16px; box-sizing: border-box; }
  /* The pitch ground belongs to the pitch, not to whichever game is featured. */
  .artbox:has(.art-pitch) { background: #0C2A1B; }
  a.game-go.feat .art-pitch { width: 100%; height: 100%; min-height: 150px; }
  .artbox .art { display: block; }
  .artbox .dots { filter: drop-shadow(0 1px 3px rgba(0,0,0,.6)); }
  .gtext { padding: 13px 14px 14px; display: flex; flex-direction: column; }
  a.game-go.feat .gtext { padding: 16px 18px 17px; }
  .gtag { font-size: .62rem; font-weight: 700; text-transform: uppercase; letter-spacing: .12em;
          color: var(--cyan); margin-bottom: 6px; }
  .gname { font-family: var(--mono); font-size: .85rem; font-weight: 700; line-height: 1.25; }
  a.game-go.feat .gname { font-size: 1.3rem; letter-spacing: -.02em; }
  .gblurb { font-size: .75rem; color: var(--fg-2); line-height: 1.4; margin-top: 4px; }
  a.game-go.feat .gblurb { font-size: .87rem; max-width: 40ch; margin-top: 6px; }
  .gplay { display: inline-flex; align-items: center; gap: 5px; margin-top: 13px;
           font-size: .82rem; font-weight: 700; color: var(--cyan); }
  .gplay svg { width: 14px; height: 14px; transition: transform .14s; }
  a.game-go:hover .gplay svg { transform: translateX(3px); }

  /* ── play your way ───────────────────────────────────────────────────── */
  ul.ways { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px;
            grid-template-columns: repeat(4, 1fr); }
  ul.ways a { display: flex; flex-direction: column; gap: 3px; height: 100%; box-sizing: border-box;
              padding: 14px 15px; border-radius: 11px; text-decoration: none; color: var(--fg);
              background: var(--s1); border: 1px solid var(--line); }
  ul.ways a:hover { background: var(--s2); border-color: var(--line-2); }
  ul.ways b { font-size: .88rem; }
  ul.ways span { font-size: .75rem; color: var(--fg-2); line-height: 1.4; }

  @media (max-width: 900px) {
    ul.games li.feat { grid-column: 1 / -1; grid-row: auto; }
    a.game-go.feat { flex-direction: row; align-items: stretch; }
    a.game-go.feat .artbox { flex: 0 0 38%; border-bottom: 0;
                             border-right: 1px solid var(--line); min-height: 0; }
    a.game-go.feat .art-pitch { min-height: 124px; }
    a.game-go.feat .gtext { flex: 1; justify-content: center; }
    a.game-go:not(.feat) .artbox { flex: 0 0 auto; height: 96px; }
    a.game-go:not(.feat) .gtext { flex: 1; }
    ul.ways { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 720px) { ul.games { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 620px) {
    .dart { flex: 0 0 36%; padding: 10px; }
    .dart svg { max-height: 112px; }
    .dbody { padding: 13px 14px 15px; }
    .dname { font-size: 1.05rem; }
    .dscope { font-size: .78rem; }
    .dplay { width: 100%; justify-content: center; }
    a.game-go.feat .artbox { flex: 0 0 38%; padding: 9px 10px; }
    a.game-go.feat .art-pitch { min-height: 104px; }
    a.game-go.feat .gtext { padding: 12px 13px; }
    a.game-go.feat .gname { font-size: 1.02rem; }
    a.game-go.feat .gblurb { font-size: .76rem; }
    a.game-go:not(.feat) .artbox { flex: 0 0 auto; height: 74px; padding: 7px 9px; }
    .gtext { padding: 10px 11px 11px; }
    .gname { font-size: .8rem; }
    .gblurb { font-size: .71rem; }
    .howto { width: 34px; height: 34px; }
  }
</style>
</head>
<body>
<div class="ts-shell">
${require('./shell').fallbackHeader('/games/')}
<main class="wrap">
<nav class="crumbs"><a href="/">TeleStats</a> &rsaquo; Games</nav>

<div class="hero">
  <p class="kicker">Know your football?</p>
  <h1>Football games and quizzes built from real player records</h1>
  <p class="lede"><b>${esc(String(cov.games))} games.</b> ${num(cov.players)} players,
    ${cov.clubs} clubs, ${cov.competitions} competitions. How good are you?</p>
</div>

<section class="band">
  <h2>Today&rsquo;s challenge</h2>
  <p class="sublede">One puzzle a day, the same for everyone. Come back tomorrow for the next.</p>
  <div class="daily" id="dailyBox" hidden>
    <div class="dtop">
      <div class="dart" id="dailyArt"></div>
      <div class="dbody">
        <p class="dtag"><i></i><span id="dailyDate">Today</span></p>
        <p class="dname" id="dailyName">&nbsp;</p>
        <p class="dscope" id="dailyScope">&nbsp;</p>
        <a class="dplay" id="dailyPlay" href="/daily/">Play today&rsquo;s challenge
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
            ><path d="M3 8h9M9 4.5 12.5 8 9 11.5"/></svg></a>
      </div>
    </div>
    <div class="dstreak">
      <div><b id="dStreak">0</b><span>Current streak</span></div>
      <div><b id="dBest">0</b><span>Best streak</span></div>
      <div><b id="dPlayed">0</b><span>Days played</span></div>
    </div>
  </div>
</section>

<section class="band">
  <h2>All ${esc(String(cov.games))} games</h2>
  <p class="sublede">Every one uses the same real records. Pick a club or a competition,
    or just play.</p>
  <ul class="games">
      ${cards(GAMES, BRAND)}
  </ul>
</section>

<section class="band">
  <h2>Play your way</h2>
  <p class="sublede">Every game can be narrowed to one club, or one competition.</p>
  <ul class="ways">
    <li><a href="/teams/"><b>Choose your club</b><span>355 clubs, with their own
      records and games.</span></a></li>
    <li><a href="/competitions/"><b>Choose a competition</b><span>Europe&rsquo;s leagues
      and cups, end to end.</span></a></li>
    <li><a href="/community/"><b>Community challenges</b><span>Games built by other
      players, from the same data.</span></a></li>
    <li><a href="/ask/"><b>Ask TeleStats</b><span>A question about the data, answered
      from the data.</span></a></li>
  </ul>
</section>
</main>
${require('./shell').footer()}
</div>
<script src="/js/ts-howto.js" defer></script>
<script src="/js/ts-streak.js"></script>
<script>
(function () {
  'use strict';
  // Today's challenge, from the SAME function /daily/ calls and the SAME
  // streak store ts-streak.js keeps. Two places showing the daily must not
  // mean two answers, and must never mean two streaks.
  var API = location.hostname === 'localhost'
    ? 'http://localhost:8888/.netlify/functions' : '/.netlify/functions';
  var box = document.getElementById('dailyBox');

  fetch(API + '/daily').then(function (r) { return r.json(); }).then(function (d) {
    // The real shape: { today, challenge: { game:{key,name,path}, scope:{...},
    // url, label }, pool }. Reading d.game as a string gave undefined and the
    // box stayed hidden, which is at least the correct failure.
    var c = d && d.challenge;
    if (!c || !c.game) return;                    // stays hidden

    document.getElementById('dailyName').textContent = c.game.name;
    document.getElementById('dailyScope').textContent = c.label || '';
    var play = document.getElementById('dailyPlay');
    // The challenge's OWN url, carrying the scope and the daily marker, so
    // playing from here is the same round as playing from /daily/.
    if (c.url) play.setAttribute('href', c.url);

    // Borrow the matching game's illustration rather than draw a seventh.
    var tpl = document.querySelector('a.game-go[data-game="' + c.game.key + '"] .art');
    var art = document.getElementById('dailyArt');
    if (tpl && art) art.innerHTML = tpl.outerHTML;

    box.hidden = false;

    if (window.TSStreak && TSStreak.get) {
      var s = TSStreak.get();
      document.getElementById('dStreak').textContent = s.current || 0;
      document.getElementById('dBest').textContent = s.longest || 0;
      document.getElementById('dPlayed').textContent = s.total || 0;
      if (s.playedToday) {
        play.textContent = 'Played today \u2014 play again';
        play.classList.add('ddone');
      }
    }
  }).catch(function () { /* stays hidden */ });
})();
</script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="/js/ts-auth.js"></script>
<script src="/js/ts-data.js"></script>
<script src="/js/ts-footer.js"></script>
<script src="/js/ts-nav.js"></script>
<script>
  (async function () {
    try { await TSAuth.init(); } catch (e) { console.error('[TeleStats] Auth init failed:', e); }
    try { TSNav.render(); } catch (e) { console.error('[TeleStats] Nav render failed:', e); }
  })();
</script>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</body>
</html>`;
}

module.exports = { render };
