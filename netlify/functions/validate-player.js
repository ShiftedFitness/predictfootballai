// netlify/functions/validate-player.js
const {
  ADALO_API_BASE,
  ADALO_API_KEY,
  PREMIER_LEAGUE_PLAYERS_COLLECTION,      // by Country
  PREMIER_LEAGUE_PLAYERS_CLUB,            // by Club (Team)
  UCL_GOALS_COLLECTION,                   // goals by player (Champions League)
  BRITISH_PLAYERS_EUROPE_COLLECTION       // British players in Europe top 5 (ex EPL)
} = process.env;

// Map front-end "collection" keys to actual Adalo collection IDs from env
const COLLECTION_MAP = {
  'prem_country': PREMIER_LEAGUE_PLAYERS_COLLECTION,
  'prem_club': PREMIER_LEAGUE_PLAYERS_CLUB,
  'ucl_goals': UCL_GOALS_COLLECTION,
  'british_europe': BRITISH_PLAYERS_EUROPE_COLLECTION
};

function normalize(s){
  return String(s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9\s.-]/g,'').trim();
}
function lev(a,b){
  const m=a.length,n=b.length; if(!m) return n; if(!n) return m;
  const d=Array.from({length:m+1},(_,i)=>Array(n+1).fill(0));
  for(let i=0;i<=m;i++) d[i][0]=i; for(let j=0;j<=n;j++) d[0][j]=j;
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

async function fetchAll({ collectionKey, filterKey, filterValue, fieldName }){
  const collectionId = COLLECTION_MAP[collectionKey] || PREMIER_LEAGUE_PLAYERS_COLLECTION;
  const base = collectionsBase();
  let offset = 0;
  const out = [];

  while(true){
    const url = new URL(`${base}/${collectionId}`);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', '1000');
    if(filterKey && filterValue){
      url.searchParams.set('filterKey', filterKey);
      url.searchParams.set('filterValue', filterValue);
    }
    const res = await fetch(url.toString(), { headers: { Authorization:`Bearer ${ADALO_API_KEY}`, 'Content-Type':'application/json' }});
    if(!res.ok){ const t=await res.text(); throw new Error(`Adalo ${res.status}: ${t}`); }
    const data = await res.json();
    const rows = (data.records || []).filter(r => r && r.Player);
    for(const r of rows){
      const numeric = Number(r[fieldName] || 0); // e.g., Matches or Goals
      out.push({
        player: r.Player,
        norm: normalize(r.Player),
        matches: numeric,          // <- unified name used by the frontend/scorer
        starts:  Number(r.Starts||0),
        goals:   Number(r.Goals||0),
        mins:    Number(r.Mins||0),
        country: r.Country || '',
        team:    r.Team || ''
      });
    }
    if(!data.offset) break;
    offset = data.offset;
  }
  return out;
}

exports.handler = async (event) => {
  try{
    const qs = new URLSearchParams(event.queryStringParameters || {});
    const collectionKey = qs.get('collection') || 'prem_country';
    const filterKey     = qs.get('filterKey') || '';
    const filterValue   = qs.get('filterValue') || '';
    const fieldName     = qs.get('fieldName') || 'Matches';

    // Bulk fetch for cache / stats preview
    if(qs.get('fetchAll')){
      const list = await fetchAll({ collectionKey, filterKey, filterValue, fieldName });
      return { statusCode: 200, body: JSON.stringify(list) };
    }

    // Single-guess validation
    const { guess } = JSON.parse(event.body || '{}');
    if(!guess){ return { statusCode:400, body: JSON.stringify({ valid:false, message:'No guess provided' }) }; }

    const target = normalize(guess);
    const list = await fetchAll({ collectionKey, filterKey, filterValue, fieldName });

    // exact → contains → similarity
    let best = list.find(it => it.norm === target) || list.find(it => it.norm.includes(target));
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
          matches: best.matches,   // unified numeric returned
          starts:  best.starts,
          goals:   best.goals,
          mins:    best.mins,
          meta: { country: best.country, team: best.team, fieldName }
        })
      };
    }
    return { statusCode: 200, body: JSON.stringify({ valid:false, message:`❌ ${guess} not found.` }) };
  }catch(err){
    return { statusCode: 500, body: JSON.stringify({ valid:false, error: err.message }) };
  }
};
