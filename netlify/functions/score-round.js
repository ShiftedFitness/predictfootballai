exports.handler = async (event) => {
  try{
    const { player, scores, deduct } = JSON.parse(event.body || '{}');
    if (player !== 0 && player !== 1) return { statusCode:400, body: JSON.stringify({ error:'Invalid player index' }) };
    const s = Array.isArray(scores) && scores.length===2 ? scores.slice() : [501,501];
    const d = Math.max(0, Number(deduct||0)); // appearances

    const current = s[player];
    const next = current - d;

    let bust=false, win=false, message='';
    if (d === 0){ bust=true; message='No appearances to deduct.'; }
    else if (next < 0){ bust=true; message='💥 Bust! Score unchanged.'; }
    else if (next === 0){ s[player]=0; win=true; message='🎯 Checkout! You win!'; }
    else { s[player]=next; message=`−${d} → ${next}`; }

    return { statusCode:200, body: JSON.stringify({ scores:s, bust, win, message }) };
  }catch(err){
    return { statusCode:500, body: JSON.stringify({ error: err.message }) };
  }
};
