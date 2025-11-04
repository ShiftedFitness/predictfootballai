// netlify/functions/validate-player.js
const { ADALO_API_BASE, ADALO_API_KEY, PREMIER_LEAGUE_PLAYERS_COLLECTION } = process.env;

function normalize(s){
  return String(s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9\s.-]/g,'').trim();
}
function lev(a,b){
  const m=a.length,n=b.length; if(!m) return n; if(!n) return m;
  const d=Array.from({length:m+1},(_,i)=>Array(n+1).fill(0));
  for(let i=0;i<=m;i++) d[i][0]=i;
  for(let j=0;j<=n;j++) d[0][j]=j;
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++){
    const c=a[i-1]===b[j-1]?0:1;
    d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+c);
  }
  return d[m][n];
}
function sim(a,b){ const A=normalize(a),B=normalize(b); if(!A||!B) return 0; return 1 - (lev(A,B)/Math.max(A.length,B.length)); }

function collectionsBase(){
  const base = String(ADALO_API_BASE || '').replace(/\/+$/,'');
  return base.includes('/collections') ? base : `${base}/collections`;
}

// Optional allow-list so only expected categories are queryable
const COUNTRY_ALLOWLIST = new Set(['Spain','France','Brazil']);

async function fetchAllByCountry(country){
  const base = collectionsBase();
  const wantCountry = COUNTRY_ALLOWLIST.has(country) ? country : null;

  let offset = 0;
  const all = [];
  while(true){
    const url = new URL(`${base}/${PREMIER_LEAGUE_PLAYERS_COLLECTION}`);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', '1000');
    if (wantCountry){
      url.searchParams.set('filterKey', 'Country');
      url.searchParams.set('filterValue', wantCountry);
    }
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${ADALO_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    if(!res.ok){
      const t = await res.text();
      throw new Error(`Adalo fetch ${res.status}: ${t}`);
    }
    const data = await res.json();
    const rows = (data.records || []).filter(r => r && r.Player);
    for(const r of rows){
      all.push({
        player: r.Player,
        norm: normalize(r.Player),
        matches: Number(r.Matches||0),
        starts:  Number(r.Starts||0),
        goals:   Number(r.Goals||0),
        mins:    Number(r.Mins||0),
        country: r.Country || ''
      });
    }
    if(!data.offset) break;
    offset = data.offset;
  }
  return all;
}

exports.handler = async (event) => {
  try{
    const qs = new URLSearchParams(event.queryStringParameters || {});
    const country = qs.get('country') || ''; // enforced via fetchAllByCountry

    // 1) Bulk fetch for SPA cache (country-scoped)
    if(qs.get('fetchAll')){
      const list = await fetchAllByCountry(country);
      return { statusCode: 200, body: JSON.stringify(list) };
    }

    // 2) Single-guess validation (country-scoped)
    const { guess } = JSON.parse(event.body || '{}');
    if(!guess){
      return { statusCode: 400, body: JSON.stringify({ valid:false, message:'No guess provided' }) };
    }

    const target = normalize(guess);
    const list = await fetchAllByCountry(country);

    // exact → contains → similarity
    let best = list.find(it => it.norm === target);
    if(!best) best = list.find(it => it.norm.includes(target));
    if(!best){
      let top={rec:null,conf:0};
      for(const it of list){
        const s = sim(it.norm, target);
        if(s > top.conf) top = { rec: it, conf: s };
      }
      if(top.rec && top.conf >= 0.78) best = top.rec;
    }

    if(best){
      return {
        statusCode: 200,
        body: JSON.stringify({
          valid: true,
          canonical: best.player,
          matches: best.matches,
          starts:  best.starts,
          goals:   best.goals,
          mins:    best.mins,
          country: best.country
        })
      };
    }
    return { statusCode: 200, body: JSON.stringify({ valid:false, message:`❌ ${guess} not found.` }) };
  }catch(err){
    return { statusCode: 500, body: JSON.stringify({ valid:false, error: err.message }) };
  }
};
