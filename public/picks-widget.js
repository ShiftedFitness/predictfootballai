(function () {
  const css = `
    .pf-wrap{max-width:760px;margin:24px auto;padding:16px;background:#0E0E0E;color:#E5E7EB;font-family:Inter,system-ui,Arial}
    .pf-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}
    .pf-deadline{font-weight:600}
    .pf-countdown{font-variant-numeric:tabular-nums;background:#111827;border:1px solid #1F2937;border-radius:10px;padding:8px 12px}
    .pf-card{background:#111827;border:1px solid #1F2937;border-radius:12px;padding:16px;margin-bottom:12px}
    .pf-teams{font-weight:600}
    .pf-muted{color:#9CA3AF}
    .pf-btn{background:#0FF0FC;border:none;color:#0E0E0E;font-weight:700;padding:10px 16px;border-radius:8px;cursor:pointer}
    .pf-btn.secondary{background:transparent;color:#0FF0FC;border:1px solid #0FF0FC}
    .pf-btn[disabled]{opacity:.6;cursor:not-allowed}
    .pf-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}
    .pf-pick{padding:10px 12px;border:1px solid #1F2937;border-radius:10px;text-align:center;cursor:pointer;background:#0E0E0E}
    .pf-pick.active{background:#0FF0FC;color:#0E0E0E;border-color:#0FF0FC;font-weight:800}
    .pf-row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
    .pf-bar{height:8px;background:#1F2937;border-radius:8px;overflow:hidden}
    .pf-bar span{display:block;height:100%;background:#0FF0FC}
    .pf-note{margin-top:8px}
    .pf-footer{margin-top:16px}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

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

  async function renderPicks(container, cfg) {
    const base = cfg.base || '/.netlify/functions';
    const week = String(cfg.week);
    const userId = String(cfg.userId);

    container.innerHTML = '';
    const wrap = el(`
      <div class="pf-wrap">
        <div class="pf-top">
          <h2 style="margin:0">Week <span id="pf-week"></span> Picks</h2>
          <div class="pf-countdown"><span class="pf-deadline">Deadline:</span> <span id="pf-deadline"></span> • <span id="pf-timer">--</span></div>
        </div>
        <div id="pf-status" class="pf-muted" style="margin-bottom:8px"></div>
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
    const deadlineEl = wrap.querySelector('#pf-deadline');
    deadlineEl.textContent = deadline ? new Date(deadline).toLocaleString() : 'n/a';

    // Determine initial edit mode (pre-deadline only)
    let editMode = !locked; // pre-deadline start in edit mode
    // If all five picks are already chosen and you want to default to view mode, toggle this:
    const allChosen = matches.length>0 && matches.every(m => !!picks[m.id]);
    if (!locked && allChosen) editMode = false;

    const statusEl = wrap.querySelector('#pf-status');
    const matchesEl = wrap.querySelector('#pf-matches');
    const actionsEl = wrap.querySelector('#pf-actions');
    const summaryEl = wrap.querySelector('#pf-summary');

    function renderEdit() {
      statusEl.textContent = 'Select your picks. You can change them until the deadline.';
      actionsEl.innerHTML = '';
      matchesEl.innerHTML = '';
      matches.forEach(m => {
        const cur = picks[m.id] || '';
        const card = el(`<div class="pf-card">
          <div class="pf-teams">${m['Home Team']} v ${m['Away Team']}</div>
          <div class="pf-grid">
            ${['HOME','DRAW','AWAY'].map(opt => `
              <button class="pf-pick ${cur===opt?'active':''}" data-match="${m.id}" data-val="${opt}">${opt}</button>
            `).join('')}
          </div>
        </div>`);
        card.querySelectorAll('.pf-pick').forEach(btn=>{
          btn.addEventListener('click', ()=>{
            const mid = btn.getAttribute('data-match');
            const val = btn.getAttribute('data-val');
            picks[mid] = val;
            // toggle active styles within this card
            card.querySelectorAll('.pf-pick').forEach(b=>b.classList.remove('active'));
            btn.classList.add('active');
          });
        });
        matchesEl.appendChild(card);
      });
      const saveBtn = el(`<button class="pf-btn">Save Picks</button>`);
      saveBtn.addEventListener('click', async ()=>{
        const payload = matches.map(m => ({ match_id: m.id, pick: picks[m.id] || '' }));
        if (payload.some(p => !p.pick)) { alert('Choose a pick for all five matches.'); return; }
        await j(`${base}/submit-picks`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, week: Number(week), picks: payload })
        });
        editMode = false; // switch to view mode after save
        render();
      });
      actionsEl.appendChild(saveBtn);
    }

    async function renderPreView() {
      statusEl.textContent = 'Your saved picks (you can still edit until the deadline).';
      actionsEl.innerHTML = '';
      matchesEl.innerHTML = '';
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
      const editBtn = el(`<button class="pf-btn secondary">Edit picks</button>`);
      editBtn.addEventListener('click', ()=>{ editMode = true; render(); });
      actionsEl.appendChild(editBtn);
    }

    async function renderPost() {
      statusEl.textContent = 'Deadline passed. Picks locked. Showing summary.';
      actionsEl.innerHTML = '';
      matchesEl.innerHTML = '';
      const sum = await j(`${base}/summary?week=${encodeURIComponent(week)}&userId=${encodeURIComponent(userId)}`);
      summaryEl.innerHTML = '<h3 style="margin:0 0 8px">Summary</h3>';

      (sum.perMatch || []).forEach(pm => {
        const m = matches.find(x => x.id === pm.match_id);
        const myPick = picks[m.id] || '(none)';
        const countsBit = (pm.total != null && pm.count)
          ? `<div class="pf-note pf-muted">(${pm.count.HOME} home, ${pm.count.DRAW} draw, ${pm.count.AWAY} away • total ${pm.total})</div>`
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
      if (locked) {
        renderPost();
      } else {
        if (editMode) renderEdit(); else renderPreView();
      }
    }

    // Countdown timer
    const timerEl = wrap.querySelector('#pf-timer');
    let timerId = null;
    function tick() {
      if (!deadline) { timerEl.textContent='--'; return; }
      const now = Date.now();
      const diff = new Date(deadline).getTime() - now;
      timerEl.textContent = formatCountdown(diff);
      if (diff <= 0 && !locked) {
        locked = true; // flip to locked once deadline passes
        clearInterval(timerId);
        render(); // rerender into post-deadline
      }
    }
    if (deadline) {
      tick();
      timerId = setInterval(tick, 1000);
    } else {
      timerEl.textContent = '--';
    }

    // Initial render
    render();
  }

  window.PredictFootballPicks = { render: renderPicks };
})();
