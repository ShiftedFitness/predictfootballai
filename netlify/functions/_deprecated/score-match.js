const { ADALO, adaloFetch, listAll } = require('./_adalo.js');
const U = (s)=> String(s||'').trim().toUpperCase();
const relId = (v)=> Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
const ok = (b)=>({statusCode:200,headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
const err=(c,m)=>({statusCode:c,body:JSON.stringify({error:m})});

exports.handler = async (event)=>{
  try{
    if (event.httpMethod !== 'POST') return err(405,'POST only');
    const secret = (event.headers['x-admin-secret']||'').trim();
    if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) return err(401,'Unauthorised');

    const { match_id } = JSON.parse(event.body||'{}');
    if (!match_id) return err(400,'match_id required');

    const [match, preds] = await Promise.all([
      (async()=>{
        const list = await listAll(ADALO.col.matches, 2000);
        return list.find(m => String(m.id) === String(match_id));
      })(),
      (async()=>{
        const all = await listAll(ADALO.col.predictions, 20000);
        return all.filter(p => String(relId(p['Match'])) === String(match_id));
      })()
    ]);

    if (!match) return err(404,'match not found');

    const correct = U(match['Correct Result']);
    if (!correct) return err(400,'Correct Result not set on match');

    let updated = 0;
    for (const p of preds){
      const pick = U(p['Pick']);
      const should = (pick && pick === correct) ? 1 : 0;
      const current = (typeof p['Points Awarded']==='number') ? Number(p['Points Awarded']) : null;
      if (current === null || current !== should){
        await adaloFetch(`${ADALO.col.predictions}/${p.id}`, { method:'PUT', body: JSON.stringify({ 'Points Awarded': should }) });
        updated++;
      }
    }
    return ok({ ok:true, match_id, updated });
  }catch(e){ return err(500,String(e)); }
};
