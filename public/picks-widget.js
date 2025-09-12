(function () {
  const css = `
    .pf-wrap{max-width:720px;margin:16px auto;padding:16px;background:#0E0E0E;color:#E5E7EB;font-family:Inter,system-ui,Arial}
    .pf-card{background:#111827;border:1px solid #1F2937;border-radius:12px;padding:16px;margin-bottom:12px}
    .pf-row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
    .pf-teams{font-weight:600}
    .pf-muted{color:#9CA3AF}
    .pf-btn{background:#0FF0FC;border:none;color:#0E0E0E;font-weight:700;padding:10px 16px;border-radius:8px;cursor:pointer}
    .pf-btn[disabled]{opacity:.6;cursor:not-allowed}
    .pf-radios label{margin-right:12px;cursor:pointer}
    .pf-bar{height:8px;background:#1F2937;border-radius:8px;overflow:hidden}
    .pf-bar span{display:block;height:100%;background:#0FF0FC}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  async function j(url, opt) {
    const r = await fetch(url, opt);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  function el(html) { const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstChild; }

  async function renderPicks(container, cfg) {
    const base = cfg.base || '/.netlify/functions';
    const week = String(cfg.week);
    const userId = String(cfg.userId);

    container.innerHTML = '';
    const wrap = el(`<div class="pf-wrap">
      <h2 style="margin:0 0 8px">Week <span id="pf-week"></span> Picks</h2>
      <div id="pf-status" class="pf-muted" style="margin-bottom:12px"></div>
      <div id="pf-matches"></div>
      <button id="pf-save" class="pf-btn" style="margin-top:8px">Save Picks</button>
      <div id="pf-summary" style="margin-top:24px"></div>
    </div>`);
    container.appendChild(wrap);
    wrap.querySelector('#pf-week').textContent = week;

    const data = await j(`${base}/get-week?week=${encodeURIComponent(week)}&userId=${encodeURIComponent(userId)}`);
    const locked = !!data.locked;
    const matches = data.matches || [];
    const picks = {};
    (data.predictions || []).forEach(p => { picks[p['Match']] = p['Pick'] || ''; });

    const status = wrap.querySelector('#pf-status');
    const saveBtn = wrap.querySelector('#pf-save');
    const list = wrap.querySelector('#pf-matches');

    function renderPre() {
      status.textContent = 'Select your picks. You can change them until the deadline.';
      saveBtn.disabled = false;
      list.innerHTML = '';
      matches.forEach(m => {
        const cur = picks[m.id] || '';
        const card = el(`<div class="pf-card">
          <div class="pf-row">
            <div>
              <div class="pf-teams">${m['Home Team']} v ${m['Away Team']}</div>
              <div class="pf-muted">Lockout: ${m['Lockout Time'] ? new Date(m['Lockout Time']).toLocaleString() : 'n/a'}</div>
            </div>
            <div class="pf-radios">
              ${['HOME','DRAW','AWAY'].map(opt => `
                <label><input type="radio" name="m_${m.id}" value="${opt}" ${cur===opt?'checked':''}> ${opt}</label>
              `).join('')}
            </div>
          </div>
        </div>`);
        card.addEventListener('change', e => {
          if (e.target && e.target.name === `m_${m.id}`) picks[m.id] = e.target.value;
        });
        list.appendChild(card);
      });

      saveBtn.onclick = async () => {
        const payload = matches.map(m => ({ match_id: m.id, pick: picks[m.id] || '' }));
        if (payload.some(p => !p.pick)) { alert('Choose a pick for all five matches.'); return; }
        await j(`${base}/submit-picks`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, week: Number(week), picks: payload })
        });
        alert('Saved! You can edit until the deadline.');
      };
    }

    async function renderPost() {
      status.textContent = 'Deadline passed. Picks locked. Showing summary.';
      saveBtn.disabled = true;
      list.innerHTML = '';
      const sum = await j(`${base}/summary?week=${encodeURIComponent(week)}&userId=${encodeURIComponent(userId)}`);
      const box = wrap.querySelector('#pf-summary');
      box.innerHTML = '<h3 style="margin:0 0 8px">Summary</h3>';
      (sum.perMatch || []).forEach(pm => {
        const m = matches.find(x => x.id === pm.match_id);
        const card = el(`<div class="pf-card">
          <div class="pf-teams">${m['Home Team']} v ${m['Away Team']}</div>
          <div class="pf-muted">HOME ${pm.pct.HOME}%</div><div class="pf-bar"><span style="width:${pm.pct.HOME}%"></span></div>
          <div class="pf-muted" style="margin-top:6px">DRAW ${pm.pct.DRAW}%</div><div class="pf-bar"><span style="width:${pm.pct.DRAW}%"></span></div>
          <div class="pf-muted" style="margin-top:6px">AWAY ${pm.pct.AWAY}%</div><div class="pf-bar"><span style="width:${pm.pct.AWAY}%"></span></div>
        </div>`);
        box.appendChild(card);
      });
      if ((sum.samePickUsers || []).length) {
        const card = el(`<div class="pf-card"><strong>Same 5-pick combo as you:</strong> ${sum.samePickUsers.length} user(s)</div>`);
        box.appendChild(card);
      }
    }

    if (!locked) renderPre(); else renderPost();
  }

  // expose global init
  window.PredictFootballPicks = { render: renderPicks };
})();
