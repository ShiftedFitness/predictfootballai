(function () {
  // === THEME (TeleStats Fives) ===
  const THEME = {
    bg: '#131920',         // dark panel bg (matches --bg-card)
    card: '#0F1318',       // card bg (matches --bg-panel)
    border: 'rgba(255,255,255,0.06)',
    text: '#F0F0F0',
    muted: '#7A8A9E',
    accent: '#FFD60A',     // yellow CTA
    accentText: '#0B0F12',
    good: '#32FF7E',       // TeleStats green
    cyan: '#00E5FF'
  };

  // === STYLES (TeleStats dark theme) ===
  const css = `
    .pf-wrap{ max-width: 750px; margin: 0 auto; padding: 16px 0; color:${THEME.text}; font-family: Inter, system-ui, Arial; }
    .pf-top{ display:flex; justify-content:space-between; align-items:flex-end; gap:12px; flex-wrap:wrap; margin-bottom:12px }
    .pf-deadline-line{ font-weight:600; color:${THEME.text}; font-size:13px }
    .pf-countdown{ font-variant-numeric: tabular-nums; line-height: 1; letter-spacing: 0.5px; color:${THEME.cyan}; white-space: nowrap; }
    .pf-countdown .pf-digits{ display:block; font-size: 22px; font-weight: 800; padding: 6px 10px; border-radius: 10px; background: rgba(0,229,255,0.08); font-family: 'Space Mono', monospace; }
    .pf-status{ color:${THEME.muted}; margin-bottom: 8px; font-size:13px }
    .pf-card{ background:${THEME.card}; color:${THEME.text}; border:1px solid ${THEME.border}; border-radius: 12px; padding:16px; margin-bottom:12px; }
    .pf-teams{ font-weight:700; font-size:15px }
    .pf-grid{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:10px }
    .pf-pick{ padding:12px 12px; border-radius:10px; text-align:center; cursor:pointer; background: transparent; color:${THEME.text}; border:1px solid ${THEME.border}; transition: all .15s ease; font-weight:700; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; }
    .pf-pick:hover{ border-color: rgba(0,229,255,0.3) }
    .pf-pick.active{ background:${THEME.accent}; color:${THEME.accentText}; border-color:${THEME.accent}; font-weight: 900; }
    .pf-badge{ display:none; color:${THEME.accentText}; font-weight:900; }
    .pf-pick.active .pf-badge{ display:inline; }
    .pf-pick-pct{ font-size:11px; opacity:0.7; font-weight:600 }
    .pf-pick.active .pf-pick-pct{ opacity:1 }
    .pf-row{ display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap }
    .pf-muted{ color:${THEME.muted} }
    .pf-bar{ height:8px; background:rgba(255,255,255,0.06); border-radius:8px; overflow:hidden }
    .pf-bar span{ display:block; height:100%; background:${THEME.cyan} }
    .pf-footer{ margin-top: 12px }
    .pf-btn{ background:${THEME.accent}; color:${THEME.accentText}; border: none; font-weight:900; padding:12px 18px; border-radius:10px; cursor:pointer; font-size:16px; transition: background .12s }
    .pf-btn:hover{ background:#E6C009 }
    .pf-btn.secondary{ background:transparent; color:${THEME.text}; border:1px solid rgba(255,255,255,0.15); }
    .pf-btn.secondary:hover{ border-color:${THEME.cyan}; color:${THEME.cyan} }
    .pf-btn[disabled]{ opacity:.5; cursor:not-allowed }
    .pf-btnrow{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-start }
    .pf-spinner{ display:inline-block; width:16px; height:16px; border-radius:50%; border:2px solid rgba(255,255,255,0.2); border-top-color:${THEME.cyan}; animation: pfspin 0.7s linear infinite; vertical-align:-3px; margin-right:8px; }
    @keyframes pfspin{ to{ transform: rotate(360deg) } }
    .pf-hidden{ display:none !important; }
    .pf-error{ background:rgba(224,85,85,0.15); border:1px solid rgba(224,85,85,0.3); color:#E05555; padding:10px 12px; border-radius:10px; margin:8px 0; white-space:pre-wrap }

    /* Enrichment styles */
    .pf-enrich{ margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.06) }
    .pf-section-label{ font-size:10px; text-transform:uppercase; letter-spacing:1px; color:${THEME.muted}; font-weight:700; margin:8px 0 4px }
    .pf-pred-bar{ display:flex; height:28px; border-radius:6px; overflow:hidden; margin:4px 0; font-size:11px; font-weight:700 }
    .pf-pred-seg{ display:flex; align-items:center; justify-content:center; min-width:28px; transition: all .15s }
    .pf-pred-seg.home{ background:#00E5FF; color:#0B0F12 }
    .pf-pred-seg.draw{ background:#FFD60A; color:#0B0F12 }
    .pf-pred-seg.away{ background:#32FF7E; color:#0B0F12 }
    .pf-legend{ display:flex; gap:12px; margin:4px 0 2px; font-size:10px; color:${THEME.muted} }
    .pf-legend-dot{ width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:3px; vertical-align:middle }
    .pf-form-row{ display:flex; align-items:center; gap:5px; margin:4px 0 }
    .pf-form-label{ font-size:11px; color:${THEME.muted}; min-width:70px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
    .pf-form-badge{ width:20px; height:20px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:800; flex-shrink:0 }
    .pf-form-badge.w{ background:${THEME.good}; color:#000 }
    .pf-form-badge.d{ background:#666; color:#fff }
    .pf-form-badge.l{ background:#E05555; color:#fff }
    .pf-h2h{ font-size:12px; color:${THEME.text}; margin:2px 0 }
    .pf-advice{ font-size:12px; color:${THEME.text}; margin-top:2px; padding:8px 10px; background:rgba(255,255,255,0.04); border-radius:8px; line-height:1.4 }

    /* Preview mode pick chips */
    .pf-pick-chip{ display:inline-block; padding:4px 12px; border-radius:8px; font-weight:800; font-size:13px; background:${THEME.accent}; color:${THEME.accentText} }

    /* Probability summary */
    .pf-prob-card{ background:${THEME.card}; border:1px solid ${THEME.border}; border-radius:12px; padding:16px; margin-bottom:12px }
    .pf-prob-title{ font-weight:800; font-size:16px; margin-bottom:12px; font-family:'Space Mono',monospace }
    .pf-prob-row{ display:flex; align-items:center; gap:10px; margin:6px 0 }
    .pf-prob-label{ font-size:13px; color:${THEME.muted}; min-width:90px }
    .pf-prob-bar-wrap{ flex:1; height:20px; background:rgba(255,255,255,0.06); border-radius:6px; overflow:hidden; position:relative }
    .pf-prob-bar-fill{ height:100%; border-radius:6px; transition:width .3s ease }
    .pf-prob-val{ font-size:13px; font-weight:700; min-width:50px; text-align:right }
    .pf-commentary{ margin-top:12px; padding:10px 12px; background:rgba(255,255,255,0.04); border-radius:8px; font-size:13px; color:${THEME.muted}; line-height:1.5 }
    .pf-dist-grid{ display:grid; grid-template-columns:repeat(6,1fr); gap:6px; margin-top:10px }
    .pf-dist-item{ text-align:center; padding:8px 4px; background:rgba(255,255,255,0.03); border-radius:8px; border:1px solid ${THEME.border} }
    .pf-dist-num{ font-size:18px; font-weight:800; display:block }
    .pf-dist-label{ font-size:10px; color:${THEME.muted}; margin-top:2px; display:block }
    .pf-dist-pct{ font-size:12px; font-weight:700; display:block; margin-top:4px }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // === HELPERS ===
  function el(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstChild;
  }
  function showError(container, msg) {
    container.appendChild(el(`<div class="pf-error">${msg}</div>`));
  }

  function formatCountdown(ms) {
    if (ms <= 0) return '00d 00h 00m 00s';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d)}d ${pad(h)}h ${pad(m)}m ${pad(sec)}s`;
  }

  function formatUK(date) {
    if (!date) return 'n/a';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric', month: 'short', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      }).format(new Date(date));
    } catch {
      return new Date(date).toLocaleString('en-GB');
    }
  }

  // === ENRICHMENT HELPERS ===
  function hasEnrichment(m) {
    return !!(m['Prediction Home'] || m['Prediction Draw'] || m['Prediction Away'] || m['Home Form'] || m['Away Form']);
  }

  function getMatchPredictions(m) {
    return {
      home: Number(m['Prediction Home']) || 0,
      draw: Number(m['Prediction Draw']) || 0,
      away: Number(m['Prediction Away']) || 0
    };
  }

  function formBadgesHtml(formStr) {
    if (!formStr) return '';
    return formStr.split('').map(c => {
      const cls = c.toUpperCase() === 'W' ? 'w' : c.toUpperCase() === 'D' ? 'd' : 'l';
      return `<span class="pf-form-badge ${cls}">${c.toUpperCase()}</span>`;
    }).join('');
  }

  function parseH2H(m) {
    try {
      const raw = m['H2H Summary'];
      if (!raw) return [];
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch { return []; }
  }

  function h2hSummaryText(h2hArr, homeTeam) {
    if (!Array.isArray(h2hArr) || h2hArr.length === 0) return '';
    let homeWins = 0, draws = 0, awayWins = 0;
    h2hArr.forEach(h => {
      if (h.homeGoals === h.awayGoals) { draws++; return; }
      if (h.homeTeam === homeTeam) {
        if (h.homeGoals > h.awayGoals) homeWins++; else awayWins++;
      } else if (h.awayTeam === homeTeam) {
        if (h.awayGoals > h.homeGoals) homeWins++; else awayWins++;
      } else {
        if (h.homeWinner) homeWins++; else if (h.awayWinner) awayWins++; else draws++;
      }
    });
    return `Last ${h2hArr.length} meetings: ${homeWins} home wins, ${draws} draws, ${awayWins} away wins`;
  }

  // Render enrichment HTML for EDIT MODE — full detail to help users pick
  function renderEnrichmentHtml(m) {
    if (!hasEnrichment(m)) return '';

    const pred = getMatchPredictions(m);
    const total = pred.home + pred.draw + pred.away || 1;
    const homeTeam = m['Home Team'] || '';
    const awayTeam = m['Away Team'] || '';
    const advice = m['Prediction Advice'] || '';
    const h2h = parseH2H(m);
    const h2hText = h2hSummaryText(h2h, homeTeam);

    let html = '<div class="pf-enrich">';

    // Predicted outcome bar with label and legend
    if (pred.home || pred.draw || pred.away) {
      html += `
        <div class="pf-section-label">Predicted Outcome</div>
        <div class="pf-pred-bar">
          <div class="pf-pred-seg home" style="width:${pred.home/total*100}%">${pred.home}%</div>
          <div class="pf-pred-seg draw" style="width:${pred.draw/total*100}%">${pred.draw}%</div>
          <div class="pf-pred-seg away" style="width:${pred.away/total*100}%">${pred.away}%</div>
        </div>
        <div class="pf-legend">
          <span><span class="pf-legend-dot" style="background:#00E5FF"></span>Home Win</span>
          <span><span class="pf-legend-dot" style="background:#FFD60A"></span>Draw</span>
          <span><span class="pf-legend-dot" style="background:#32FF7E"></span>Away Win</span>
        </div>
      `;
    }

    // Form (only if data exists)
    if (m['Home Form'] || m['Away Form']) {
      html += '<div class="pf-section-label">Recent Form</div>';
      if (m['Home Form']) {
        html += `<div class="pf-form-row"><span class="pf-form-label">${homeTeam}</span>${formBadgesHtml(m['Home Form'])}</div>`;
      }
      if (m['Away Form']) {
        html += `<div class="pf-form-row"><span class="pf-form-label">${awayTeam}</span>${formBadgesHtml(m['Away Form'])}</div>`;
      }
    }

    // H2H
    if (h2hText) {
      html += `<div class="pf-section-label">Head to Head</div><div class="pf-h2h">${h2hText}</div>`;
    }

    // Analysis / advice
    if (advice) {
      html += `<div class="pf-section-label">Analysis</div><div class="pf-advice">${advice}</div>`;
    }

    html += '</div>';
    return html;
  }

  // === PROBABILITY CALCULATIONS ===
  // Exact Poisson binomial: enumerate all 2^5 = 32 outcomes
  function calculateProbabilities(matches, picks) {
    const probs = matches.map(m => {
      const mid = String(m.id);
      const pick = picks[mid];
      if (!pick || !hasEnrichment(m)) return 0;
      const pred = getMatchPredictions(m);
      const pctMap = { HOME: pred.home, DRAW: pred.draw, AWAY: pred.away };
      return (pctMap[pick] || 0) / 100;
    });

    // If no enrichment data at all, return null
    if (probs.every(p => p === 0)) return null;

    const n = probs.length;
    const dist = new Array(n + 1).fill(0);

    // Enumerate all 2^n outcomes
    for (let mask = 0; mask < (1 << n); mask++) {
      let p = 1;
      let correct = 0;
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          p *= probs[i];
          correct++;
        } else {
          p *= (1 - probs[i]);
        }
      }
      dist[correct] += p;
    }

    const fullHouse = dist[n];
    const blanks = dist[0];

    // Expected value
    const expected = probs.reduce((s, p) => s + p, 0);

    // Risk profile
    const favourites = probs.filter(p => p >= 0.40).length;

    let commentary = '';
    if (favourites >= 4) {
      commentary = "Playing it safe this week — mostly favourites. Solid strategy, but the rewards for a full house are slimmer.";
    } else if (favourites >= 3) {
      commentary = "A balanced set of picks — some favourites, some punts. A sensible approach with decent upside.";
    } else if (favourites >= 1) {
      commentary = "Feeling adventurous! A few risky picks in the mix. No risk, no reward — a full house here would be something special.";
    } else {
      commentary = "Going full maverick! All underdogs and long shots. If this comes off, you deserve a standing ovation.";
    }

    return { dist, fullHouse, blanks, expected, commentary, probs };
  }

  function renderProbabilitySummary(matches, picks) {
    const calc = calculateProbabilities(matches, picks);
    if (!calc) return '';

    const fmtPct = (v) => {
      const pct = v * 100;
      if (pct < 0.1 && pct > 0) return '<0.1%';
      if (pct >= 10) return pct.toFixed(1) + '%';
      return pct.toFixed(2) + '%';
    };

    // Colours for the distribution
    const distColours = ['#E05555', '#e65100', '#ff9800', '#fdd835', '#32FF7E', '#00E5FF'];

    let distHtml = '<div class="pf-dist-grid">';
    for (let i = 0; i <= 5; i++) {
      distHtml += `
        <div class="pf-dist-item">
          <span class="pf-dist-num" style="color:${distColours[i]}">${i}</span>
          <span class="pf-dist-label">correct</span>
          <span class="pf-dist-pct">${fmtPct(calc.dist[i])}</span>
        </div>
      `;
    }
    distHtml += '</div>';

    return `
      <div class="pf-prob-card">
        <div class="pf-prob-title">Your Picks Analysis</div>

        <div class="pf-prob-row">
          <span class="pf-prob-label">Full House</span>
          <div class="pf-prob-bar-wrap">
            <div class="pf-prob-bar-fill" style="width:${Math.min(calc.fullHouse*100, 100)}%;background:${THEME.good}"></div>
          </div>
          <span class="pf-prob-val" style="color:${THEME.good}">${fmtPct(calc.fullHouse)}</span>
        </div>

        <div class="pf-prob-row">
          <span class="pf-prob-label">Blanks</span>
          <div class="pf-prob-bar-wrap">
            <div class="pf-prob-bar-fill" style="width:${Math.min(calc.blanks*100, 100)}%;background:#E05555"></div>
          </div>
          <span class="pf-prob-val" style="color:#E05555">${fmtPct(calc.blanks)}</span>
        </div>

        <div class="pf-prob-row">
          <span class="pf-prob-label">Expected</span>
          <div class="pf-prob-bar-wrap">
            <div class="pf-prob-bar-fill" style="width:${calc.expected/5*100}%;background:${THEME.accent}"></div>
          </div>
          <span class="pf-prob-val" style="color:${THEME.accent}">${calc.expected.toFixed(1)} / 5</span>
        </div>

        ${distHtml}

        <div class="pf-commentary">${calc.commentary}</div>
      </div>
    `;
  }

  // === MAIN ===
  async function renderPicks(container, cfg) {
    try {
      const qs = new URLSearchParams(location.search);

      let week = String(qs.get('week') ?? cfg.week);
      let userId = String(cfg.userId);

      // HARD STOP if not logged in / missing user id
      const userIdOk =
        userId &&
        userId !== 'undefined' &&
        userId !== 'null' &&
        String(userId).trim() !== '' &&
        String(userId).trim() !== '0';

      if (!userIdOk) {
        container.innerHTML = '';
        const wrap = el(`
          <div class="pf-wrap">
            <div class="pf-card">
              <h2 style="margin:0 0 6px 0">Login required</h2>
              <div class="pf-muted">
                You need to log in to see and submit picks.<br/>
                Please return to the app, log in, and open Picks again.
              </div>
            </div>
          </div>
        `);
        container.appendChild(wrap);
        return;
      }
      userId = String(userId).trim();

      container.innerHTML = '';
      const wrap = el(`
        <div class="pf-wrap">
          <div class="pf-top">
            <div>
              <h2 style="margin:0 0 4px 0">Week <span id="pf-week"></span> Picks</h2>
              <div id="pf-deadline-line" class="pf-deadline-line"></div>
            </div>
            <div class="pf-countdown"><span id="pf-digits" class="pf-digits">--</span></div>
          </div>

          <div id="pf-status" class="pf-status"></div>
          <div id="pf-prob-summary"></div>
          <div id="pf-matches"></div>
          <div id="pf-actions" class="pf-footer"></div>
          <div id="pf-summary" style="margin-top:24px"></div>
        </div>
      `);
      container.appendChild(wrap);

      // Load week + picks via Supabase data layer
      let data;
      try {
        data = await PredictData.getWeek(week, userId);
      } catch (e) {
        showError(wrap, `Failed to load week data.\n${e.message}`);
        return;
      }

      let locked = !!data.locked;
      const matches = (data.matches || []).slice();

      // picks: matchId -> 'HOME'/'DRAW'/'AWAY'
      const picks = {};
      (data.predictions || []).forEach(p => {
        const mid = String(p['Match'] ?? p.match_id ?? '').trim();
        const pk = String(p['Pick'] ?? '').trim().toUpperCase();
        if (mid) picks[mid] = pk;
      });

      // Deadline
      const deadlines = matches
        .map(m => m['Lockout Time'] ? new Date(m['Lockout Time']) : null)
        .filter(Boolean)
        .sort((a,b)=>a-b);
      const deadline = deadlines[0] || null;

      const deadlineLineEl = wrap.querySelector('#pf-deadline-line');
      const digitsEl = wrap.querySelector('#pf-digits');
      const statusEl = wrap.querySelector('#pf-status');
      const matchesEl = wrap.querySelector('#pf-matches');
      const actionsEl = wrap.querySelector('#pf-actions');
      const probSummaryEl = wrap.querySelector('#pf-prob-summary');
      const summaryEl = wrap.querySelector('#pf-summary');

      // Display chosen week
      wrap.querySelector('#pf-week').textContent = String(data.week || week);

      let editMode = !locked;

      // If user already has all picks chosen for this week, default to preview mode
      const allChosen = matches.length > 0 && matches.every(m => !!picks[String(m.id)]);
      if (!locked && allChosen) editMode = false;

      function renderHeaderVisibility() {
        if (!locked && editMode) {
          deadlineLineEl.classList.add('pf-hidden');
        } else {
          deadlineLineEl.classList.remove('pf-hidden');
        }
      }

      function renderDeadlineLine() {
        if (!locked && editMode) {
          deadlineLineEl.textContent = '';
        } else {
          const when = deadline ? `${formatUK(deadline)} UK Time` : 'n/a';
          deadlineLineEl.textContent = `Deadline (UK Time): ${when}`;
        }
      }

      // Update probability summary when picks change
      function updateProbSummary() {
        if (!probSummaryEl) return;
        const allPicked = matches.length > 0 && matches.every(m => !!picks[String(m.id)]);
        const anyEnrich = matches.some(m => hasEnrichment(m));
        if (allPicked && anyEnrich) {
          probSummaryEl.innerHTML = renderProbabilitySummary(matches, picks);
        } else {
          probSummaryEl.innerHTML = '';
        }
      }

      // === EDIT MODE: full enrichment to help users decide ===
      function renderEdit() {
        statusEl.textContent = '';
        matchesEl.innerHTML = '';
        actionsEl.innerHTML = '';
        summaryEl.innerHTML = '';
        probSummaryEl.innerHTML = '';

        matches.forEach(m => {
          const mid = String(m.id);
          const cur = picks[mid] || '';
          const pred = getMatchPredictions(m);
          const showPct = hasEnrichment(m);

          const card = el(`<div class="pf-card">
            <div class="pf-teams">${m['Home Team']} v ${m['Away Team']}</div>
            ${renderEnrichmentHtml(m)}
            <div class="pf-grid">
              ${['HOME','DRAW','AWAY'].map(opt => {
                const pct = showPct ? (opt === 'HOME' ? pred.home : opt === 'DRAW' ? pred.draw : pred.away) : null;
                return `
                  <button class="pf-pick ${cur===opt?'active':''}" data-match="${mid}" data-val="${opt}">
                    <span class="pf-label">${opt}</span>
                    ${pct !== null ? `<span class="pf-pick-pct">${pct}%</span>` : ''}
                    <span class="pf-badge">&check;</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>`);

          card.querySelectorAll('.pf-pick').forEach(btn => {
            btn.addEventListener('click', () => {
              const mId = btn.getAttribute('data-match');
              const val = btn.getAttribute('data-val');
              picks[mId] = val;
              card.querySelectorAll('.pf-pick').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              updateProbSummary();
            });
          });

          matchesEl.appendChild(card);
        });

        // Show probability summary if all picks already selected
        updateProbSummary();

        const btnRow = el(`<div class="pf-btnrow"></div>`);
        const saveBtn = el(`<button class="pf-btn" id="pf-save">Save picks</button>`);
        btnRow.appendChild(saveBtn);
        actionsEl.appendChild(btnRow);

        saveBtn.addEventListener('click', async () => {
          if (!userId || userId === '0') {
            alert('You need to log in to submit picks.');
            return;
          }

          const payload = matches.map(m => ({ match_id: m.id, pick: picks[String(m.id)] || '' }));
          if (payload.some(p => !p.pick)) {
            alert('Choose a pick for all five matches.');
            return;
          }

          saveBtn.disabled = true;
          saveBtn.innerHTML = `<span class="pf-spinner"></span>Saving\u2026`;
          matchesEl.querySelectorAll('.pf-pick').forEach(b => b.disabled = true);

          try {
            await PredictData.submitPicks(userId, Number(data.week || week), payload);
            editMode = false;
            render();
          } catch (e) {
            alert('Save failed. Please try again.\n' + e.message);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save picks';
            matchesEl.querySelectorAll('.pf-pick').forEach(b => b.disabled = false);
          }
        });
      }

      // === PREVIEW MODE: clean, just picks + analysis at top ===
      function renderPreView() {
        statusEl.textContent = 'Your saved picks';
        matchesEl.innerHTML = '';
        actionsEl.innerHTML = '';
        summaryEl.innerHTML = '';
        probSummaryEl.innerHTML = '';

        // Show analysis FIRST (at top)
        updateProbSummary();

        // Then show clean pick cards — NO enrichment clutter
        matches.forEach(m => {
          const mid = String(m.id);
          const myPick = picks[mid] || '(none)';
          const card = el(`<div class="pf-card">
            <div class="pf-row" style="justify-content:space-between">
              <div class="pf-teams">${m['Home Team']} v ${m['Away Team']}</div>
              <span class="pf-pick-chip">${myPick}</span>
            </div>
          </div>`);
          matchesEl.appendChild(card);
        });

        const btnRow = el(`<div class="pf-btnrow"></div>`);
        const editBtn = el(`<button class="pf-btn secondary" style="font-size:18px;padding:14px 18px;">Edit picks</button>`);
        editBtn.addEventListener('click', () => { editMode = true; render(); });
        btnRow.appendChild(editBtn);
        actionsEl.appendChild(btnRow);
      }

      // === POST MODE: locked, show summary ===
      async function renderPost() {
        statusEl.textContent = 'Deadline passed. Picks locked.';
        matchesEl.innerHTML = '';
        actionsEl.innerHTML = '';
        summaryEl.innerHTML = '';
        probSummaryEl.innerHTML = '';

        // Show analysis at top
        updateProbSummary();

        let sum;
        try {
          sum = await PredictData.getSummary(data.week || week, userId);
        } catch (e) {
          showError(wrap, `Failed to load summary.\n${e.message}`);
          return;
        }

        summaryEl.innerHTML = '<h3 style="margin:0 0 8px">Summary</h3>';
        (sum.perMatch || []).forEach(pm => {
          const m = matches.find(x => String(x.id) === String(pm.match_id));
          if (!m) return;

          const myPick = picks[String(m.id)] || '(none)';
          const countsBit = (pm.total != null && pm.count)
            ? `<div class="pf-muted" style="margin-top:6px">(${pm.count.HOME} home, ${pm.count.DRAW} draw, ${pm.count.AWAY} away \u2022 total ${pm.total})</div>`
            : '';
          const card = el(`<div class="pf-card">
            <div class="pf-row" style="justify-content:space-between">
              <div class="pf-teams">${m['Home Team']} v ${m['Away Team']}</div>
              <span class="pf-pick-chip">${myPick}</span>
            </div>
            <div class="pf-muted" style="margin-top:8px">HOME ${pm.pct.HOME}%</div>
            <div class="pf-bar"><span style="width:${pm.pct.HOME}%"></span></div>
            <div class="pf-muted" style="margin-top:6px">DRAW ${pm.pct.DRAW}%</div>
            <div class="pf-bar"><span style="width:${pm.pct.DRAW}%"></span></div>
            <div class="pf-muted" style="margin-top:6px">AWAY ${pm.pct.AWAY}%</div>
            <div class="pf-bar"><span style="width:${pm.pct.AWAY}%"></span></div>
            ${countsBit}
          </div>`);
          summaryEl.appendChild(card);
        });

        const matchesMsg = (sum.samePickUsers || []).length
          ? `<strong>${(sum.samePickUsers||[]).length}</strong> user(s) have the exact same 5-pick combo as you.`
          : `No one matched your exact 5-pick combo. You maverick.`;
        const foot = el(`<div class="pf-card">${matchesMsg}</div>`);
        summaryEl.appendChild(foot);
      }

      function render() {
        renderHeaderVisibility();
        renderDeadlineLine();
        if (locked) {
          renderPost();
        } else {
          if (editMode) renderEdit();
          else renderPreView();
        }
      }

      function tick() {
        if (!deadline) { digitsEl.textContent = '--'; return; }
        const diff = new Date(deadline).getTime() - Date.now();
        digitsEl.textContent = formatCountdown(diff);
        if (diff <= 0 && !locked) {
          locked = true;
          render();
        }
      }

      tick();
      setInterval(tick, 1000);

      render();
    } catch (err) {
      container.appendChild(el(`<div class="pf-error">Widget crashed:\n${err.message || err}</div>`));
    }
  }

  window.PredictFootballPicks = { render: renderPicks };
})();
