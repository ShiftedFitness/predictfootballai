(function () {
  // === THEME ===
  const THEME = {
    bg: '#30A278',          // page/section background
    card: '#000000',        // cards
    border: '#1a1a1a',
    text: '#FFFFFF',
    muted: '#EAEAEA',
    accent: '#FFFFFF',      // buttons/active states
    accentText: '#000000',
    good: '#7CFC00'         // lime tick
  };

  // === STYLES ===
  const css = `
    .pf-wrap{
      max-width: 750px; margin: 24px auto; padding: 16px;
      background:${THEME.bg}; color:${THEME.text};
      font-family: Inter, system-ui, Arial;
      border-radius: 14px;
    }
    .pf-top{ display:flex; justify-content:space-between; align-items:flex-end; gap:12px; flex-wrap:wrap; margin-bottom:12px }
    .pf-deadline-line{ font-weight:600; color:${THEME.text}; }
    .pf-countdown{
      font-variant-numeric: tabular-nums;
      line-height: 1; letter-spacing: 0.5px;
      color:${THEME.text};
      white-space: nowrap;
    }
    .pf-countdown .pf-digits{
      display:block; font-size: 24px; font-weight: 800;
      padding: 6px 10px; border-radius: 10px;
      background: rgba(0,0,0,0.25);
    }

    .pf-status{ color:${THEME.muted}; margin-bottom: 8px }

    .pf-card{
      background:${THEME.card}; color:${THEME.text};
      border:1px solid ${THEME.border}; border-radius: 12px;
      padding:16px; margin-bottom:12px;
    }
    .pf-teams{ font-weight:700 }

    .pf-grid{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:10px }
    .pf-pick{
      padding:12px 12px; border-radius:10px; text-align:center; cursor:pointer;
      background: transparent; color:${THEME.text};
      border:1px solid ${THEME.border}; transition: all .15s ease;
      font-weight:700; display:flex; align-items:center; justify-content:center; gap:8px;
    }
    .pf-pick:hover{ border-color:#333 }
    .pf-pick.active{
      background:${THEME.accent}; color:${THEME.accentText};
      border-color:${THEME.accent};
      font-weight: 900;
    }
    .pf-badge{ display:none; color:${THEME.good}; font-weight:900; }
    .pf-pick.active .pf-badge{ display:inline; }

    .pf-row{ display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap }
    .pf-muted{ color:${THEME.muted} }

    .pf-bar{ height:8px; background:#1F1F1F; border-radius:8px; overflow:hidden }
    .pf-bar span{ display:block; height:100%; background:${THEME.accent} }

    .pf-footer{ margin-top: 12px }
    .pf-btn{
      background:${THEME.accent}; color:${THEME.accentText};
      border: none; font-weight:900; padding:12px 18px; border-radius:10px; cursor:pointer;
      font-size:16px;
    }
    .pf-btn.secondary{
      background:${THEME.accent}; color:${THEME.accentText}; border:1px solid ${THEME.accent};
    }
    .pf-btn[disabled]{ opacity:.6; cursor:not-allowed }

    .pf-btnrow{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-start }
    .pf-spinner{
      display:inline-block; width:16px; height:16px; border-radius:50%;
      border:2px solid rgba(0,0,0,0.25); border-top-color:${THEME.accentText};
      animation: pfspin 0.7s linear infinite; vertical-align: -3px; margin-right:8px;
    }
    @keyframes pfspin{ to{ transform: rotate(360deg) } }
    .pf-hidden{ display:none !important; }
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  // === HELPERS ===
  async function j(url, opt) {
    const r = await fetch(url, opt);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
  function el(html) { const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstChild; }

  function formatCountdown(ms) {
    if (ms <= 0) return '00d 00h 00m 00s';
    const s = Math.floor(ms/1000);
    const d = Math.floor(s/86400);
    const h = Math.floor((s%86400)/3600);
    const m = Math.floor((s%3600)/60);
    const sec = s%60;
    const pad = (n)=>String(n).padStart(2,'0');
    return `${pad(d)}d ${pad(h)}h ${pad(m)}m ${pad(sec)}s`;
  }

  // Renamed to formatUK and set to Europe/London
  function formatUK(date) {
    if (!date) return 'n/a';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', // UK local time (GMT in winter, BST in summer)
        year:'numeric', month:'short', day:'2-digit',
        hour:'2-digit', minute:'2-digit'
      }).format(new Date(date));
    } catch {
      return new Date(date).toLocaleString('en-GB');
    }
  }

  // === MAIN ===
  async function renderPicks(container, cfg) {
    // Allow URL params to override week/userId
    const qs = new URLSearchParams(location.search);
    const base   = cfg.base || '/.netlify/functions';
    let week     = String(qs.get('week')   ?? cfg.week);
    let userId   = String(qs.get('userId') ?? cfg.userId);

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
        <div id="pf-matches"></div>
        <div id="pf-actions" class="pf-footer"></div>
        <div id="pf-summary" style="margin-top:24px"></div>
      </div>
    `);
    container.appendChild(wrap);
    wrap.querySelector('#pf-week').textContent = week;

    // Load week + user picks
    const data = await j(`${base}/get-week?week=${encodeURIComponent(week)}&userId=${encodeURIComponent(userId)}`);
    let locked = !!data.locked;
    const matches = (data.matches || []).slice();
    const picks = {};
    (data.predictions || []).forEach(p => { picks[p['Match']] = p['Pick'] || ''; });

    // Global deadline = earliest Lockout Time among matches
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
    const summaryEl = wrap.querySelector('#pf-summary');

    // Start in edit mode if not locked; but if all picks chosen, start in view mode
    let editMode = !locked;
    const allChosen = matches.length>0 && matches.every(m => !!picks[m.id]);
    if (!locked && allChosen) editMode = false;

   function renderHeaderVisibility() {
  // Always show countdown; hide only the absolute line when editing
  if (!locked && editMode) {
    deadlineLineEl.classList.add('pf-hidden');   // hide "Deadline (UK Time): ..."
  } else {
    deadlineLineEl.classList.remove('pf-hidden');
  }
  digitsEl.parentElement.classList.remove('pf-hidden'); // ensure countdown visible
}
    }

    function renderDeadlineLine() {
      // Only show absolute UK time when not editing
      if (!locked && editMode) {
        deadlineLineEl.textContent = '';
      } else {
        const when = deadline ? `${formatUK(deadline)} UK Time` : 'n/a';
        deadlineLineEl.textContent = `Deadline (UK Time): ${when}`;
      }
    }

    function renderEdit() {
      statusEl.textContent = ''; // no helper text
      matchesEl.innerHTML = ''; actionsEl.innerHTML = '';

      matches.forEach(m => {
        const cur = picks[m.id] || '';
        const card = el(`<div class="pf-card">
          <div class="pf-teams">${m['Home Team']} v ${m['Away Team']}</div>
          <div class="pf-grid">
            ${['HOME','DRAW','AWAY'].map(opt => `
              <button class="pf-pick ${cur===opt?'active':''}" data-match="${m.id}" data-val="${opt}">
                <span class="pf-label">${opt}</span><span class="pf-badge">✓</span>
              </button>
            `).join('')}
          </div>
        </div>`);
        card.querySelectorAll('.pf-pick').forEach(btn=>{
          btn.addEventListener('click', ()=>{
            const mid = btn.getAttribute('data-match');
            const val = btn.getAttribute('data-val');
            picks[mid] = val;
            // Toggle active & tick in this card’s row only
            card.querySelectorAll('.pf-pick').forEach(b=>b.classList.remove('active'));
            btn.classList.add('active');
          });
        });
        matchesEl.appendChild(card);
      });

      const btnRow = el(`<div class="pf-btnrow"></div>`);
      const saveBtn = el(`<button class="pf-btn" id="pf-save">Save picks</button>`);
      btnRow.appendChild(saveBtn);
      actionsEl.appendChild(btnRow);

      saveBtn.addEventListener('click', async ()=>{
        const payload = matches.map(m => ({ match_id: m.id, pick: picks[m.id] || '' }));
        if (payload.some(p => !p.pick)) { alert('Choose a pick for all five matches.'); return; }

        // Loading state
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<span class="pf-spinner"></span>Saving…`;
        matchesEl.querySelectorAll('.pf-pick').forEach(b=>b.disabled = true);

        try {
          await j(`${base}/submit-picks`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, week: Number(week), picks: payload })
          });
          // Flip to view mode after success
          editMode = false;
          render();
        } catch (e) {
          alert('Save failed. Please try again.');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save picks';
          matchesEl.querySelectorAll('.pf-pick').forEach(b=>b.disabled = false);
        }
      });
    }

    function renderPreView() {
      statusEl.textContent = 'Your saved picks.';
      matchesEl.innerHTML = ''; actionsEl.innerHTML = '';

      matches.forEach(m => {
        const myPick = picks[m.id] || '(none)';
        const card = el(`<div class="pf-card">
          <div class="pf-row" style="justify-content:space-between">
            <div class="pf-teams">${m['Home Team']} v ${m['Away Team']}</div>
            <div><span class="pf-muted">Your pick:</span> <strong>${myPick}</strong></div>
          </div>
        </div>`);
        matchesEl.appendChild(card);
      });

      const btnRow = el(`<div class="pf-btnrow"></div>`);
      const editBtn = el(`<button class="pf-btn secondary" style="font-size:18px;padding:14px 18px;">Edit picks</button>`);
      editBtn.addEventListener('click', ()=>{ editMode = true; render(); });
      btnRow.appendChild(editBtn);
      actionsEl.appendChild(btnRow);
    }

    async function renderPost() {
      statusEl.textContent = 'Deadline passed. Picks locked.';
      matchesEl.innerHTML = ''; actionsEl.innerHTML = ''; summaryEl.innerHTML = '';

      const sum = await j(`${base}/summary?week=${encodeURIComponent(week)}&userId=${encodeURIComponent(userId)}`);
      summaryEl.innerHTML = '<h3 style="margin:0 0 8px">Summary</h3>';

      (sum.perMatch || []).forEach(pm => {
        const m = matches.find(x => x.id === pm.match_id);
        const myPick = picks[m.id] || '(none)';
        const countsBit = (pm.total != null && pm.count)
          ? `<div class="pf-muted" style="margin-top:6px">(${pm.count.HOME} home, ${pm.count.DRAW} draw, ${pm.count.AWAY} away • total ${pm.total})</div>`
          : '';
        const card = el(`<div class="pf-card">
          <div class="pf-row" style="justify-content:space-between">
            <div class="pf-teams">${m['Home Team']} v ${m['Away Team']}</div>
            <div><span class="pf-muted">Your pick:</span> <strong>${myPick}</strong></div>
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
        if (editMode) renderEdit(); else renderPreView();
      }
    }

    // Countdown
    function tick() {
      if (!deadline) { digitsEl.textContent='--'; return; }
      const now = Date.now();
      const diff = new Date(deadline).getTime() - now;
      digitsEl.textContent = formatCountdown(diff);
      if (diff <= 0 && !locked) {
        locked = true; // flip to locked once deadline passes
        render();
      }
    }
    tick();
    const timerId = setInterval(tick, 1000);

    // Initial render
    render();
  }

  // Expose global init
  window.PredictFootballPicks = { render: renderPicks };
})();
