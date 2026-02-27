/* ============================================================
   Goal Recreator — Game Engine
   Sensible Soccer-style top-down pixel-art football game
   Supports: DRIBBLE mode (Maradona) + VOLLEY mode (Van Basten)
   ============================================================ */

(function () {
  'use strict';

  /* ── DOM refs ──────────────────────────────────────────── */
  let canvas, ctx;
  const $ = id => document.getElementById(id);

  /* ── Screens ───────────────────────────────────────────── */
  let introScreen, gameScreen, endScreen;

  /* ── Level ─────────────────────────────────────────────── */
  let level = null;
  let levelIndex = 0;

  /* ── Game state ────────────────────────────────────────── */
  let state = 'idle';
  // idle | playing | shooting | tackled | goalCelebration | ended
  // Volley adds: crossWait | crossing | volleyShot

  let player, ball, defenders, keeper, passer;
  let timeRemaining = 0;
  let lastTs = 0;
  let gameTime = 0;          // total elapsed game time
  let invulnTimer = 0;
  let tackleMsg = 0;
  let hintText = '';
  let hintTimer = 0;
  let showTutorial = true;
  let chevronPhase = 0;
  let shotAnim = null;
  let goalFlash = 0;
  let endReason = '';

  /* ── Volley-specific state ─────────────────────────────── */
  let crossTimer = 0;        // time since last cross reset
  let crossActive = false;
  let crossProgress = 0;     // 0..1
  let crossBall = { groundX: 0, groundY: 0, drawX: 0, drawY: 0, height: 0, visible: false };
  let crossCount = 0;        // how many crosses delivered
  let volleyQuality = 0;

  /* ── Scoring ───────────────────────────────────────────── */
  let pathSamples = [];
  let defendersPassed = new Set();
  let sampleAccum = 0;
  const SAMPLE_INTERVAL = 0.1;

  /* ── Input ─────────────────────────────────────────────── */
  const keys = {};
  const joy = { active: false, dx: 0, dy: 0, touchId: null, cx: 0, cy: 0 };
  let shootReq = false;

  /* ── Constants ─────────────────────────────────────────── */
  const PLAYER_SPEED = 210;
  const INV_TIME     = 1.5;
  const TACKLE_MSG   = 1.0;
  const SHOT_SPEED   = 700;
  const PITCH_GREEN  = '#3D8B37';
  const PITCH_GREEN2 = '#358230';
  const LINE_COLOR   = 'rgba(255,255,255,0.85)';
  const STRIPE_W     = 30;

  const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  /* ================================================================
     SPRITE DRAWING — Sensible Soccer style with multiple hair types
     ================================================================ */

  function drawShadow(cx, cy, r) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx + 1, cy + r + 3, r * 1.0, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Build a merged kit: base kit + per-entity overrides (hair, hairStyle, skin).
   */
  function mergeKit(baseKit, entity) {
    return {
      ...baseKit,
      hair:      entity.hair      || baseKit.hair      || '#5C4033',
      hairStyle: entity.hairStyle || baseKit.hairStyle || 'short',
      skin:      entity.skin      || baseKit.skin      || '#F5CBA7'
    };
  }

  /**
   * Draw a Sensible Soccer style player sprite.
   * Supports hair styles: curly, short, receding, balding, medium, swept, curlyshort
   */
  function drawPlayer(cx, cy, kit, dir, isMoving, time, blink) {
    if (blink && Math.floor(time * 10) % 2 === 0) return;

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    const s = 1.6;

    // Shadow
    drawShadow(cx, cy, 12 * s);

    // Leg animation
    const legCycle = isMoving ? Math.sin(time * 14) * 4 * s : 0;

    // ── Legs (socks + boots) ────────────────────────────
    const legY = Math.round(cy + 5 * s);
    const legW = Math.round(3 * s);
    const legH = Math.round(8 * s);
    const bootH = Math.round(2.5 * s);
    ctx.fillStyle = kit.socks;
    ctx.fillRect(Math.round(cx - 5 * s + legCycle), legY, legW, legH);
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(Math.round(cx - 5 * s + legCycle), legY + legH - bootH, legW, bootH);
    ctx.fillStyle = kit.socks;
    ctx.fillRect(Math.round(cx + 2 * s - legCycle), legY, legW, legH);
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(Math.round(cx + 2 * s - legCycle), legY + legH - bootH, legW, bootH);

    // ── Shorts ──────────────────────────────────────────
    ctx.fillStyle = kit.shorts;
    ctx.fillRect(Math.round(cx - 6 * s), Math.round(cy + 1.5 * s), Math.round(12 * s), Math.round(5 * s));

    // ── Shirt / torso ───────────────────────────────────
    const torsoW = Math.round(14 * s);
    const torsoH = Math.round(10 * s);
    const torsoX = Math.round(cx - 7 * s);
    const torsoY = Math.round(cy - 8 * s);

    if (kit.stripes && kit.shirtColors.length >= 2) {
      const sw = Math.max(2, Math.round(3 * s));
      for (let i = 0; i < torsoW; i++) {
        ctx.fillStyle = kit.shirtColors[Math.floor(i / sw) % kit.shirtColors.length];
        ctx.fillRect(torsoX + i, torsoY, 1, torsoH);
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(cx - 3 * s, torsoY);
      ctx.lineTo(cx, torsoY + 3 * s);
      ctx.lineTo(cx + 3 * s, torsoY);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = kit.shirtColors[0];
      ctx.fillRect(torsoX, torsoY, torsoW, torsoH);
      ctx.fillStyle = kit.shorts === '#1E3A5F' ? '#1E3A5F' : '#444';
      ctx.fillRect(Math.round(cx - 4 * s), torsoY, Math.round(8 * s), Math.round(1.5 * s));
    }

    // Sleeves + arms
    const sleeveColor = kit.shirtColors[0];
    const armW = Math.round(3 * s);
    ctx.fillStyle = sleeveColor;
    ctx.fillRect(Math.round(cx - 10 * s), Math.round(cy - 6 * s), armW, Math.round(3 * s));
    ctx.fillRect(Math.round(cx + 7 * s), Math.round(cy - 6 * s), armW, Math.round(3 * s));
    ctx.fillStyle = kit.skin;
    ctx.fillRect(Math.round(cx - 10 * s), Math.round(cy - 3 * s), armW, Math.round(5 * s));
    ctx.fillRect(Math.round(cx + 7 * s), Math.round(cy - 3 * s), armW, Math.round(5 * s));

    // ── Head ────────────────────────────────────────────
    const headCx = cx;
    const headCy = Math.round(cy - 14 * s);
    const headR  = Math.round(7.5 * s);

    // ── Hair (drawn behind head for volume) ─────────────
    ctx.fillStyle = kit.hair || '#5C4033';
    const hs = kit.hairStyle || 'short';

    if (hs === 'curly') {
      // MARADONA — big voluminous curly mane
      ctx.beginPath();
      ctx.arc(headCx, headCy - 2 * s, headR + 4 * s, Math.PI * 0.85, Math.PI * 0.15);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(headCx - headR - 1 * s, headCy - 1 * s, 4.5 * s, 0, Math.PI * 2);
      ctx.arc(headCx + headR + 1 * s, headCy - 1 * s, 4.5 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(headCx - 5 * s, headCy - headR - 1 * s, 3.5 * s, 0, Math.PI * 2);
      ctx.arc(headCx + 5 * s, headCy - headR - 1 * s, 3.5 * s, 0, Math.PI * 2);
      ctx.arc(headCx, headCy - headR - 2 * s, 4 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(headCx, headCy + headR * 0.5, 5 * s, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = '#2C2C2C';
      for (let a = 0; a < 6; a++) {
        const ang = (a / 6) * Math.PI * 2;
        const cr = headR + 2.5 * s;
        ctx.beginPath();
        ctx.arc(headCx + Math.cos(ang) * cr, headCy - 2 * s + Math.sin(ang) * cr * 0.6, 1.5 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (hs === 'receding') {
      // Thin hair, receding at front — Beardsley
      ctx.beginPath();
      ctx.arc(headCx, headCy - 1 * s, headR + 1 * s, Math.PI * 0.75, Math.PI * 0.25, true);
      ctx.fill();
      // Scalp showing at front
      ctx.fillStyle = kit.skin;
      ctx.beginPath();
      ctx.arc(headCx, headCy - headR + 1 * s, 4 * s, Math.PI, 0);
      ctx.fill();
    } else if (hs === 'balding') {
      // Very thin/balding — Reid
      ctx.beginPath();
      ctx.arc(headCx, headCy, headR + 0.5 * s, Math.PI * 0.8, Math.PI * 0.2, true);
      ctx.fill();
      // Large skin area on top
      ctx.fillStyle = kit.skin;
      ctx.beginPath();
      ctx.arc(headCx, headCy - headR * 0.3, headR * 0.7, Math.PI * 1.1, Math.PI * 1.9);
      ctx.fill();
    } else if (hs === 'medium') {
      // 80s feathered — Hodge
      ctx.beginPath();
      ctx.arc(headCx, headCy - 1 * s, headR + 2 * s, Math.PI * 0.8, Math.PI * 0.2, true);
      ctx.fill();
      // Ear-level flicks
      ctx.beginPath();
      ctx.arc(headCx - headR - 0.5 * s, headCy + 1 * s, 2.5 * s, 0, Math.PI * 2);
      ctx.arc(headCx + headR + 0.5 * s, headCy + 1 * s, 2.5 * s, 0, Math.PI * 2);
      ctx.fill();
    } else if (hs === 'swept') {
      // VAN BASTEN — slicked back
      ctx.beginPath();
      ctx.arc(headCx, headCy - 2 * s, headR + 2 * s, Math.PI * 0.85, Math.PI * 0.15, true);
      ctx.fill();
      // Swept back lines
      ctx.strokeStyle = '#3A2A1A';
      ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(headCx + i * 2.5 * s, headCy - headR - 1 * s);
        ctx.lineTo(headCx + i * 3 * s, headCy - headR + 3 * s);
        ctx.stroke();
      }
    } else if (hs === 'curlyshort') {
      // Short curly — Shilton
      ctx.beginPath();
      ctx.arc(headCx, headCy - 1 * s, headR + 1.5 * s, Math.PI * 0.8, Math.PI * 0.2, true);
      ctx.fill();
      ctx.fillStyle = '#2C2018';
      for (let a = 0; a < 5; a++) {
        const ang = Math.PI + (a / 4) * Math.PI;
        ctx.beginPath();
        ctx.arc(headCx + Math.cos(ang) * (headR + 0.5 * s), headCy - 1 * s + Math.sin(ang) * (headR + 0.5 * s), 1.5 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Default short hair
      ctx.beginPath();
      ctx.arc(headCx, headCy - 1 * s, headR + 1.5 * s, Math.PI * 0.9, Math.PI * 0.1, true);
      ctx.fill();
    }

    // Face
    ctx.fillStyle = kit.skin;
    ctx.beginPath();
    ctx.arc(headCx, headCy, headR, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(Math.round(headCx - 4 * s), Math.round(headCy - 1.5 * s), Math.round(3 * s), Math.round(2.5 * s));
    ctx.fillRect(Math.round(headCx + 1 * s), Math.round(headCy - 1.5 * s), Math.round(3 * s), Math.round(2.5 * s));
    ctx.fillStyle = '#111';
    ctx.fillRect(Math.round(headCx - 3 * s), Math.round(headCy - 1 * s), Math.round(2 * s), Math.round(2 * s));
    ctx.fillRect(Math.round(headCx + 2 * s), Math.round(headCy - 1 * s), Math.round(2 * s), Math.round(2 * s));

    // Moustache for Maradona
    if (hs === 'curly') {
      ctx.fillStyle = kit.hair;
      ctx.fillRect(Math.round(headCx - 2 * s), Math.round(headCy + 2.5 * s), Math.round(4 * s), Math.round(1 * s));
    }

    // Shirt number
    if (kit.number) {
      ctx.fillStyle = kit.stripes ? '#1A1A1A' : '#333';
      ctx.font = `bold ${Math.round(9 * s)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(kit.number), cx, cy - 2 * s);
    }

    ctx.restore();
  }

  /* ── Ball ───────────────────────────────────────────────── */
  function drawBall(bx, by, r, heightOffset) {
    const br = r * 1.6;
    const ho = heightOffset || 0;
    ctx.save();
    // Shadow on ground
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(bx + 1, by + br + 2 + ho, br * 0.85, br * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ball body (drawn above ground if height offset)
    const drawY = by - ho;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(bx, drawY, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(bx - br * 0.15, drawY - br * 0.15, br * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx + br * 0.35, drawY + br * 0.2, br * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ================================================================
     PITCH DRAWING
     ================================================================ */

  function drawPitch() {
    const W = level.pitch.width;
    const H = level.pitch.height;

    for (let y = 0; y < H; y += STRIPE_W) {
      ctx.fillStyle = (Math.floor(y / STRIPE_W) % 2 === 0) ? PITCH_GREEN : PITCH_GREEN2;
      ctx.fillRect(0, y, W, STRIPE_W);
    }

    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 2;

    const pad = 24;
    const fL = pad, fR = W - pad, fT = pad, fB = H - pad;
    const fW = fR - fL, fH = fB - fT;
    const midY = fT + fH / 2, midX = fL + fW / 2;

    ctx.strokeRect(fL, fT, fW, fH);

    ctx.beginPath(); ctx.moveTo(fL, midY); ctx.lineTo(fR, midY); ctx.stroke();
    ctx.beginPath(); ctx.arc(midX, midY, 55, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = LINE_COLOR;
    ctx.beginPath(); ctx.arc(midX, midY, 3, 0, Math.PI * 2); ctx.fill();

    // Top penalty area
    const penW = 280, penH = 155;
    ctx.strokeRect(midX - penW / 2, fT, penW, penH);
    ctx.strokeRect(midX - 70, fT, 140, 50);
    ctx.fillStyle = LINE_COLOR;
    ctx.beginPath(); ctx.arc(midX, fT + 110, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(midX, fT + 110, 45, 0.3 * Math.PI, 0.7 * Math.PI); ctx.stroke();

    // Bottom penalty area
    ctx.strokeRect(midX - penW / 2, fB - penH, penW, penH);
    ctx.strokeRect(midX - 70, fB - 50, 140, 50);
    ctx.fillStyle = LINE_COLOR;
    ctx.beginPath(); ctx.arc(midX, fB - 110, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(midX, fB - 110, 45, 1.3 * Math.PI, 1.7 * Math.PI); ctx.stroke();

    // Goal nets (top)
    const goalW = 120, goalD = 18, goalL = midX - goalW / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(goalL, fT - goalD, goalW, goalD);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
    ctx.strokeRect(goalL, fT - goalD, goalW, goalD);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 0.5;
    for (let nx = goalL; nx <= goalL + goalW; nx += 6) {
      ctx.beginPath(); ctx.moveTo(nx, fT - goalD); ctx.lineTo(nx, fT); ctx.stroke();
    }
    for (let ny = fT - goalD; ny <= fT; ny += 6) {
      ctx.beginPath(); ctx.moveTo(goalL, ny); ctx.lineTo(goalL + goalW, ny); ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.fillRect(goalL - 2, fT - goalD, 4, goalD + 4);
    ctx.fillRect(goalL + goalW - 2, fT - goalD, 4, goalD + 4);

    ctx.strokeStyle = LINE_COLOR; ctx.lineWidth = 2;
    const cr = 12;
    ctx.beginPath(); ctx.arc(fL, fT, cr, 0, Math.PI * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(fR, fT, cr, Math.PI * 0.5, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(fL, fB, cr, -Math.PI * 0.5, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(fR, fB, cr, Math.PI, Math.PI * 1.5); ctx.stroke();
  }

  /* ── Path guidance (dribble mode only) ─────────────────── */
  function drawGuidance(time) {
    const path = level.idealPath;
    if (!path || path.length < 2) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,100,0.15)';
    ctx.lineWidth = level.pathToleranceRadius * 0.6;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,100,0.3)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    ctx.setLineDash([]);

    const totalLen = getPathLength(path);
    const spacing = 40;
    const num = Math.floor(totalLen / spacing);
    const phase = (time * 2) % 1;

    for (let i = 0; i < num; i++) {
      const t = ((i / num) + phase * (1 / num)) % 1;
      const pt = getPointAtDistance(path, t * totalLen);
      const pt2 = getPointAtDistance(path, t * totalLen + 5);
      if (!pt || !pt2) continue;
      const angle = Math.atan2(pt2.y - pt.y, pt2.x - pt.x);
      const alpha = 0.25 + 0.2 * Math.sin(time * 4 + i * 0.5);
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(angle - Math.PI / 2);
      ctx.fillStyle = `rgba(255,255,100,${alpha})`;
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(5, 3); ctx.lineTo(-5, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /* ── Shot zone highlight (dribble mode) ────────────────── */
  function drawShotZone(time) {
    const sz = level.shotZone;
    if (!sz) return;
    const scx = sz.x + sz.width / 2, scy = sz.y + sz.height / 2;
    const dist = Math.hypot(player.x - scx, player.y - scy);
    if (dist > 250) return;
    const inside = player.x >= sz.x && player.x <= sz.x + sz.width &&
                   player.y >= sz.y && player.y <= sz.y + sz.height;
    const a = inside ? 0.15 + 0.08 * Math.sin(time * 5) : 0.05 + 0.03 * Math.sin(time * 3);
    ctx.save();
    ctx.fillStyle = `rgba(255,255,100,${a})`;
    ctx.strokeStyle = `rgba(255,255,100,${a * 2.5})`;
    ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    roundRect(ctx, sz.x, sz.y, sz.width, sz.height, 6);
    ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
    if (inside) {
      ctx.fillStyle = 'rgba(255,255,100,0.7)';
      ctx.font = 'bold 11px "Space Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SHOOT!', scx, sz.y - 8);
    }
    ctx.restore();
  }

  /* ── Sweet spot indicator (volley mode) ────────────────── */
  function drawSweetSpot(time) {
    if (!level.sweetSpot) return;
    const sp = level.sweetSpot;
    const pulse = 0.6 + 0.4 * Math.sin(time * 4);
    const a = crossActive ? 0.3 * pulse : 0.1;
    ctx.save();
    ctx.strokeStyle = `rgba(255,200,50,${a})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.radius, 0, Math.PI * 2); ctx.stroke();
    if (crossActive) {
      ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.radius * 0.5 * pulse, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]);
    // Label
    if (!crossActive) {
      ctx.fillStyle = `rgba(255,200,50,0.4)`;
      ctx.font = '9px "Space Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('TARGET', sp.x, sp.y + sp.radius + 14);
    }
    ctx.restore();
  }

  /* ── Cross ball arc (volley mode) ──────────────────────── */
  function drawCrossBall(time) {
    if (!crossBall.visible) return;
    drawBall(crossBall.groundX, crossBall.groundY, ball.radius, crossBall.height);
  }

  /* ── Passer entity (volley mode) ───────────────────────── */
  function drawPasser(time) {
    if (!passer) return;
    const kit = level.passer.kit;
    const hasBall = !crossActive && state !== 'shooting' && state !== 'goalCelebration' && state !== 'ended';
    drawPlayer(passer.x, passer.y, kit, passer.dir, false, time, false);
    if (hasBall) {
      drawBall(passer.x + 12, passer.y + 8, ball.radius, 0);
    }
  }

  /* ── Helpers ───────────────────────────────────────────── */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function getPathLength(path) {
    let len = 0;
    for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    return len;
  }

  function getPointAtDistance(path, dist) {
    let acc = 0;
    for (let i = 1; i < path.length; i++) {
      const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      if (acc + seg >= dist) {
        const t = (dist - acc) / seg;
        return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t };
      }
      acc += seg;
    }
    return path[path.length - 1];
  }

  function distToPath(px, py, path) {
    let min = Infinity;
    for (let i = 1; i < path.length; i++) {
      const d = distToSeg(px, py, path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
      if (d < min) min = d;
    }
    return min;
  }

  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    let t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  /* ================================================================
     GAME LOGIC
     ================================================================ */

  function initGame(lvl) {
    level = lvl;
    state = 'playing';
    goalFlash = 0;
    endReason = '';
    showTutorial = true;
    shotAnim = null;
    gameTime = 0;

    player = {
      x: lvl.playerStart.x,
      y: lvl.playerStart.y,
      radius: 14,
      dir: lvl.playerStartDir || -Math.PI / 2,
      moving: false
    };

    ball = {
      x: player.x,
      y: player.y + 16,
      radius: 5,
      attached: lvl.type !== 'volley'   // in volley, ball starts with passer
    };

    defenders = lvl.defenders.map(d => ({
      x: d.start.x, y: d.start.y,
      radius: d.radius, speed: d.speed,
      waypoints: d.waypoints, wpIndex: 0,
      dir: 0, moving: true
    }));

    keeper = {
      x: lvl.goalkeeper.start.x, y: lvl.goalkeeper.start.y,
      radius: lvl.goalkeeper.radius, speed: lvl.goalkeeper.speed,
      waypoints: lvl.goalkeeper.waypoints, wpIndex: 0,
      dir: 0, moving: true
    };

    // Volley mode init
    if (lvl.passer) {
      passer = {
        x: lvl.passer.position.x,
        y: lvl.passer.position.y,
        dir: lvl.passer.dir || 0
      };
    } else {
      passer = null;
    }
    crossTimer = 0;
    crossActive = false;
    crossProgress = 0;
    crossBall.visible = false;
    crossCount = 0;
    volleyQuality = 0;

    timeRemaining = lvl.timeLimit;
    invulnTimer = 0;
    tackleMsg = 0;
    pathSamples = [];
    defendersPassed = new Set();
    sampleAccum = 0;
    hintText = '';
    hintTimer = 0;
  }

  /* ── Update ────────────────────────────────────────────── */
  function update(dt) {
    gameTime += dt;

    if (state === 'goalCelebration') {
      goalFlash -= dt;
      if (goalFlash <= 0) { state = 'ended'; showEndScreen(); }
      return;
    }

    if (state === 'ended' || state === 'idle') return;

    // Timer
    timeRemaining -= dt;
    if (timeRemaining <= 0) {
      timeRemaining = 0;
      endReason = 'time';
      state = 'ended';
      showEndScreen();
      return;
    }

    if (invulnTimer > 0) invulnTimer -= dt;
    if (tackleMsg > 0) tackleMsg -= dt;
    if (hintTimer > 0) hintTimer -= dt;

    // Shot animation (shared between modes)
    if (state === 'shooting' && shotAnim) {
      shotAnim.t += dt;
      const p = Math.min(shotAnim.t / shotAnim.duration, 1);
      const ease = 1 - Math.pow(1 - p, 2);
      ball.x = shotAnim.sx + (shotAnim.tx - shotAnim.sx) * ease;
      ball.y = shotAnim.sy + (shotAnim.ty - shotAnim.sy) * ease;

      const dK = Math.hypot(ball.x - keeper.x, ball.y - keeper.y);
      if (dK < keeper.radius + ball.radius + 4) {
        endReason = 'saved'; state = 'ended'; showEndScreen(); return;
      }
      const ga = level.goalArea;
      if (ball.x >= ga.x && ball.x <= ga.x + ga.width && ball.y >= ga.y && ball.y <= ga.y + ga.height) {
        endReason = 'goal'; state = 'goalCelebration'; goalFlash = 1.5; return;
      }
      if (p >= 1) { endReason = 'saved'; state = 'ended'; showEndScreen(); return; }
      moveEntity(keeper, dt);
      return;
    }

    // Tackle freeze (dribble mode)
    if (state === 'tackled') {
      if (tackleMsg <= 0) { state = 'playing'; invulnTimer = INV_TIME; }
      return;
    }

    // ── Player movement (both modes) ────────────────────
    let dx = 0, dy = 0;
    if (keys['ArrowUp'] || keys['KeyW']) dy -= 1;
    if (keys['ArrowDown'] || keys['KeyS']) dy += 1;
    if (keys['ArrowLeft'] || keys['KeyA']) dx -= 1;
    if (keys['ArrowRight'] || keys['KeyD']) dx += 1;
    if (joy.active) { dx += joy.dx; dy += joy.dy; }

    const mag = Math.hypot(dx, dy);
    if (mag > 0.1) {
      const nx = dx / mag, ny = dy / mag;
      player.x += nx * PLAYER_SPEED * dt;
      player.y += ny * PLAYER_SPEED * dt;
      player.dir = Math.atan2(ny, nx);
      player.moving = true;
      showTutorial = false;
    } else {
      player.moving = false;
    }

    player.x = Math.max(30, Math.min(level.pitch.width - 30, player.x));
    player.y = Math.max(30, Math.min(level.pitch.height - 30, player.y));

    // Ball at feet
    if (ball.attached) {
      if (player.moving) {
        ball.x = player.x + Math.cos(player.dir) * 16;
        ball.y = player.y + Math.sin(player.dir) * 16;
      } else {
        // Stationary: ball resting at feet (below sprite center)
        ball.x = player.x + 2;
        ball.y = player.y + 18;
      }
    }

    // Move defenders + keeper
    defenders.forEach(d => moveEntity(d, dt));
    moveEntity(keeper, dt);

    // ── Mode-specific logic ─────────────────────────────
    if (level.type === 'volley') {
      updateVolley(dt);
    } else {
      updateDribble(dt);
    }

    // Shoot request
    if (shootReq) {
      shootReq = false;
      if (level.type === 'volley') handleVolleyShoot();
      else handleDribbleShoot();
    }
  }

  /* ── Dribble-specific update ───────────────────────────── */
  function updateDribble(dt) {
    // Collision with defenders
    if (invulnTimer <= 0) {
      for (const d of defenders) {
        if (Math.hypot(player.x - d.x, player.y - d.y) < player.radius + d.radius) {
          state = 'tackled'; tackleMsg = TACKLE_MSG;
          player.x = level.playerStart.x; player.y = level.playerStart.y;
          ball.x = player.x; ball.y = player.y + 16;
          return;
        }
      }
      if (Math.hypot(player.x - keeper.x, player.y - keeper.y) < player.radius + keeper.radius) {
        state = 'tackled'; tackleMsg = TACKLE_MSG;
        player.x = level.playerStart.x; player.y = level.playerStart.y;
        ball.x = player.x; ball.y = player.y + 16;
        return;
      }
    }

    // Track defenders passed
    defenders.forEach((d, i) => { if (player.y < d.y - 20) defendersPassed.add(i); });

    // Path sampling
    sampleAccum += dt;
    if (sampleAccum >= SAMPLE_INTERVAL) {
      sampleAccum -= SAMPLE_INTERVAL;
      pathSamples.push(distToPath(player.x, player.y, level.idealPath));
    }
  }

  function handleDribbleShoot() {
    const sz = level.shotZone;
    if (!sz) return;
    const inside = player.x >= sz.x && player.x <= sz.x + sz.width &&
                   player.y >= sz.y && player.y <= sz.y + sz.height;
    if (!inside) { hintText = 'Too far! Get closer to the goal'; hintTimer = 1.5; return; }

    const ga = level.goalArea;
    const tx = ga.x + ga.width / 2 + (player.x - 300) * 0.2;
    const ty = ga.y + ga.height * 0.3;
    const dist = Math.hypot(tx - player.x, ty - player.y);

    ball.attached = false;
    shotAnim = { sx: ball.x, sy: ball.y, tx, ty, t: 0, duration: dist / SHOT_SPEED };
    state = 'shooting';
  }

  /* ── Volley-specific update ────────────────────────────── */
  function updateVolley(dt) {
    // Cross timer
    if (!crossActive && state === 'playing') {
      crossTimer += dt;
      if (crossTimer >= level.passer.crossDelay) {
        crossActive = true;
        crossProgress = 0;
        crossCount++;
        crossBall.visible = true;
      }
    }

    // Cross ball in flight
    if (crossActive) {
      crossProgress += dt / level.passer.crossDuration;
      if (crossProgress >= 1) {
        // Ball landed — missed
        crossActive = false;
        crossBall.visible = false;
        crossTimer = 0; // reset for next cross
        hintText = crossCount === 1 ? 'Missed! Get to the target zone...' : 'Missed! Try again...';
        hintTimer = 1.5;
      } else {
        // Calculate ball arc position
        const p = level.passer;
        const t = crossProgress;
        // Bezier ground path (arcing from passer toward target)
        const cpX = (p.position.x + p.crossTarget.x) / 2;
        const cpY = Math.min(p.position.y, p.crossTarget.y) - 80;
        crossBall.groundX = (1 - t) * (1 - t) * p.position.x + 2 * (1 - t) * t * cpX + t * t * p.crossTarget.x;
        crossBall.groundY = (1 - t) * (1 - t) * p.position.y + 2 * (1 - t) * t * cpY + t * t * p.crossTarget.y;
        crossBall.height = p.crossPeak * 4 * t * (1 - t);
      }
    }

    // Collision with defenders (no tackle reset, just push back)
    for (const d of defenders) {
      const dist = Math.hypot(player.x - d.x, player.y - d.y);
      if (dist < player.radius + d.radius + 2) {
        const nx = (player.x - d.x) / dist;
        const ny = (player.y - d.y) / dist;
        player.x = d.x + nx * (player.radius + d.radius + 3);
        player.y = d.y + ny * (player.radius + d.radius + 3);
      }
    }
  }

  function handleVolleyShoot() {
    if (!crossActive) {
      hintText = 'Wait for the cross!';
      hintTimer = 1.5;
      return;
    }

    // Check distance to ball's ground position
    const bDist = Math.hypot(player.x - crossBall.groundX, player.y - crossBall.groundY);
    if (bDist > 55) {
      hintText = 'Too far from the ball!';
      hintTimer = 1.2;
      return;
    }

    // Timing accuracy: ideal is around 85-95% through the cross
    const idealT = 0.88;
    const timingDiff = Math.abs(crossProgress - idealT);
    const timingAcc = Math.max(0, 1 - timingDiff / (level.timingWindow * 0.5));

    // Position accuracy: distance from sweet spot
    const sp = level.sweetSpot;
    const spotDist = Math.hypot(player.x - sp.x, player.y - sp.y);
    const posAcc = Math.max(0, 1 - spotDist / sp.radius);

    volleyQuality = timingAcc * 0.55 + posAcc * 0.45;

    crossActive = false;
    crossBall.visible = false;

    if (volleyQuality > 0.35) {
      // Volley attempt — animate shot toward far corner
      const ga = level.goalArea;
      const farCornerX = player.x > 300 ? ga.x + 12 : ga.x + ga.width - 12;
      const targetY = ga.y + 8;
      // Quality affects accuracy — lower quality aims more central
      const accuracy = volleyQuality;
      const tx = farCornerX * accuracy + (ga.x + ga.width / 2) * (1 - accuracy);
      const ty = targetY;
      const dist = Math.hypot(tx - player.x, ty - player.y);

      ball.attached = false;
      ball.x = player.x;
      ball.y = player.y;
      shotAnim = { sx: player.x, sy: player.y, tx, ty, t: 0, duration: dist / (SHOT_SPEED * 0.9) };
      state = 'shooting';
    } else {
      // Mis-hit — ball goes wide
      hintText = 'Mis-hit! Bad timing...';
      hintTimer = 1.5;
      crossTimer = 0;
      crossCount++;
    }
  }

  function moveEntity(e, dt) {
    if (!e.waypoints || e.waypoints.length === 0) return;
    const target = e.waypoints[e.wpIndex];
    const ddx = target.x - e.x, ddy = target.y - e.y;
    const dist = Math.hypot(ddx, ddy);
    const mv = e.speed * 60 * dt;
    if (dist < mv) {
      e.x = target.x; e.y = target.y;
      e.wpIndex = (e.wpIndex + 1) % e.waypoints.length;
    } else {
      e.x += (ddx / dist) * mv;
      e.y += (ddy / dist) * mv;
    }
    e.dir = Math.atan2(ddy, ddx);
  }

  /* ── Scoring ───────────────────────────────────────────── */
  function calculateScore() {
    const goalMade = endReason === 'goal';

    if (level.type === 'volley') {
      const timingScore = Math.round(volleyQuality * 100);
      const timeBonus = Math.max(0, Math.round(timeRemaining * 10) / 10);
      let stars = 1;
      if (goalMade) stars += 2;
      if (timingScore >= 70) stars += 1;
      if (timeBonus >= 4) stars += 1;
      return { goalMade, volleyTiming: timingScore, timeBonus, crossAttempts: crossCount, stars, mode: 'volley' };
    }

    // Dribble scoring
    let pathAcc = 0;
    if (pathSamples.length > 0) {
      const avg = pathSamples.reduce((a, b) => a + b, 0) / pathSamples.length;
      pathAcc = Math.max(0, Math.min(100, Math.round(100 * (1 - avg / (level.pathToleranceRadius * 2.5)))));
    }
    const timeBonus = Math.max(0, Math.round(timeRemaining * 10) / 10);
    const beaten = defendersPassed.size;
    let stars = 1;
    if (goalMade) stars += 1;
    if (pathAcc >= 60) stars += 1;
    if (beaten >= 4) stars += 1;
    if (timeBonus >= 5) stars += 1;
    return { goalMade, pathAcc, timeBonus, beaten, stars, mode: 'dribble' };
  }

  /* ================================================================
     DRAWING
     ================================================================ */

  function draw(time) {
    const W = level.pitch.width, H = level.pitch.height;
    ctx.clearRect(0, 0, W, H);
    drawPitch();

    if (level.type === 'volley') {
      drawSweetSpot(time);
      drawPasser(time);
    } else {
      drawGuidance(time);
      drawShotZone(time);
    }

    // Defenders
    defenders.forEach((d, i) => {
      const kit = mergeKit(level.defenderKit, level.defenders[i]);
      drawPlayer(d.x, d.y, kit, d.dir, d.moving, time, false);
    });

    // Goalkeeper
    drawPlayer(keeper.x, keeper.y, level.goalkeeperKit, keeper.dir, keeper.moving, time, false);

    // Cross ball in flight (volley mode)
    if (level.type === 'volley') drawCrossBall(time);

    // Ball (if detached and in shot flight)
    if (!ball.attached && state === 'shooting') drawBall(ball.x, ball.y, ball.radius, 0);

    // Player
    const blinking = invulnTimer > 0;
    drawPlayer(player.x, player.y, level.playerKit, player.dir, player.moving, time, blinking);

    // Ball attached to player (dribble mode)
    if (ball.attached) drawBall(ball.x, ball.y, ball.radius, 0);

    // ── HUD: Timer ──────────────────────────────────────
    ctx.save();
    const tStr = Math.ceil(timeRemaining).toString();
    ctx.font = 'bold 28px "Space Mono", monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    const tw = ctx.measureText(tStr).width + 20;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx, W - tw - 16, 8, tw + 8, 36, 6); ctx.fill();
    ctx.fillStyle = timeRemaining <= 5 ? (Math.sin(time * 8) > 0 ? '#FF4444' : '#FFD60A') : '#FFFFFF';
    ctx.fillText(tStr, W - 16, 14);
    ctx.font = '10px "Space Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('TIME', W - 16, 44);
    ctx.restore();

    // ── Volley mode: cross incoming hint ────────────────
    if (level.type === 'volley' && !crossActive && state === 'playing') {
      const untilCross = level.passer.crossDelay - crossTimer;
      if (untilCross < 1.5 && untilCross > 0) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,200,50,0.8)';
        ctx.font = 'bold 16px "Space Mono", monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('CROSS INCOMING!', W / 2, H / 2);
        ctx.restore();
      }
    }

    // ── Tackle overlay ──────────────────────────────────
    if (state === 'tackled' || tackleMsg > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255,0,0,${Math.min(0.25, tackleMsg * 0.4)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#FF4444';
      ctx.font = 'bold 36px "Space Mono", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('TACKLED!', W / 2, H / 2);
      ctx.restore();
    }

    // ── Goal celebration ────────────────────────────────
    if (state === 'goalCelebration') {
      const a = Math.min(0.6, goalFlash * 0.5);
      ctx.save();
      ctx.fillStyle = `rgba(255,215,0,${a})`;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#FFD60A'; ctx.shadowColor = '#000'; ctx.shadowBlur = 8;
      ctx.font = 'bold 54px "Space Mono", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('GOOOAL!', W / 2, H / 2 - 20);
      ctx.font = 'bold 16px "Space Mono", monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText(level.subtitle, W / 2, H / 2 + 30);
      ctx.restore();
    }

    // ── Hints ───────────────────────────────────────────
    if (hintTimer > 0 && hintText) {
      ctx.save();
      ctx.font = 'bold 13px "Space Mono", monospace';
      const hm = ctx.measureText(hintText);
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.7, hintTimer)})`;
      roundRect(ctx, W / 2 - hm.width / 2 - 14, H - 80, hm.width + 28, 34, 8); ctx.fill();
      ctx.fillStyle = '#FFD60A'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(hintText, W / 2, H - 63);
      ctx.restore();
    }

    // ── Tutorial ────────────────────────────────────────
    if (showTutorial && state === 'playing') {
      ctx.save();
      let tut = '';
      if (level.type === 'volley') {
        tut = isMobile ? 'Move to the target zone, tap SHOOT when the cross arrives!'
                       : 'Arrow keys to position, SPACE to volley when the cross arrives!';
      } else {
        tut = isMobile ? 'Use joystick to dribble, tap SHOOT in the zone!'
                       : 'Arrow keys to dribble, SPACE to shoot in the zone!';
      }
      ctx.font = '11px "Space Mono", monospace';
      const tm = ctx.measureText(tut);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      roundRect(ctx, W / 2 - tm.width / 2 - 12, H - 50, tm.width + 24, 28, 6); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(tut, W / 2, H - 36);
      ctx.restore();
    }
  }

  /* ================================================================
     GAME LOOP
     ================================================================ */

  let rafId = null;

  function gameLoop(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    update(dt);
    draw(ts / 1000);
    if (state !== 'ended') rafId = requestAnimationFrame(gameLoop);
  }

  function startGame(idx) {
    levelIndex = idx != null ? idx : levelIndex;
    const lvl = LEVELS[levelIndex];
    initGame(lvl);

    introScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    endScreen.classList.add('hidden');

    canvas.width = lvl.pitch.width;
    canvas.height = lvl.pitch.height;

    if (isMobile) $('mobile-controls').classList.remove('hidden');

    lastTs = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(gameLoop);
  }

  /* ── End screen ────────────────────────────────────────── */
  function showEndScreen() {
    if (rafId) cancelAnimationFrame(rafId);

    const score = calculateScore();
    gameScreen.classList.add('hidden');
    endScreen.classList.remove('hidden');
    $('mobile-controls').classList.add('hidden');

    // Scroll to top so end screen is visible (fixes mobile stuck issue)
    window.scrollTo(0, 0);

    const hdr = $('end-header');
    if (endReason === 'goal') {
      hdr.textContent = 'GOAL!'; hdr.className = 'end-title goal';
    } else if (endReason === 'saved') {
      hdr.textContent = 'SAVED!'; hdr.className = 'end-title missed';
    } else {
      hdr.textContent = 'TIME UP!'; hdr.className = 'end-title missed';
    }

    $('end-level-name').textContent = level.title + ' \u2014 ' + level.subtitle;

    // Score grid — adapt to mode
    const grid = $('score-grid');
    if (score.mode === 'volley') {
      grid.innerHTML = `
        <div class="score-item"><div class="label">Goal scored</div><div id="score-goal" class="val ${score.goalMade ? 'yes' : 'no'}">${score.goalMade ? 'Yes' : 'No'}</div></div>
        <div class="score-item"><div class="label">Volley timing</div><div class="val">${score.volleyTiming}%</div></div>
        <div class="score-item"><div class="label">Time bonus</div><div class="val">${score.timeBonus}s</div></div>
        <div class="score-item"><div class="label">Cross attempts</div><div class="val">${score.crossAttempts}</div></div>
      `;
    } else {
      grid.innerHTML = `
        <div class="score-item"><div class="label">Goal scored</div><div class="val ${score.goalMade ? 'yes' : 'no'}">${score.goalMade ? 'Yes' : 'No'}</div></div>
        <div class="score-item"><div class="label">Path accuracy</div><div class="val">${score.pathAcc}%</div></div>
        <div class="score-item"><div class="label">Time bonus</div><div class="val">${score.timeBonus}s</div></div>
        <div class="score-item"><div class="label">Defenders beaten</div><div class="val">${score.beaten} / ${level.defenders.length}</div></div>
      `;
    }

    const starsEl = $('score-stars');
    starsEl.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const sp = document.createElement('span');
      sp.className = i < score.stars ? 'star filled' : 'star empty';
      sp.textContent = i < score.stars ? '\u2605' : '\u2606';
      starsEl.appendChild(sp);
    }

    // Update reference link
    $('end-ref-link').href = level.referenceVideoUrl;
  }

  /* ================================================================
     INPUT HANDLERS
     ================================================================ */

  function setupInput() {
    document.addEventListener('keydown', e => {
      keys[e.code] = true;
      if (e.code === 'Space') { e.preventDefault(); shootReq = true; }
    });
    document.addEventListener('keyup', e => { keys[e.code] = false; });

    const shootBtn = $('shoot-btn');
    if (shootBtn) {
      shootBtn.addEventListener('touchstart', e => { e.preventDefault(); shootReq = true; });
      shootBtn.addEventListener('click', () => { shootReq = true; });
    }

    // Virtual joystick
    const joyZone = $('joystick-zone');
    const joyBase = $('joystick-base');
    const joyStick = $('joystick-stick');
    if (!joyZone) return;
    const JOY_MAX = 45, DEADZONE = 8;

    joyZone.addEventListener('touchstart', e => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      joy.touchId = touch.identifier;
      joy.active = true;
      const rect = joyZone.getBoundingClientRect();
      joy.cx = touch.clientX - rect.left;
      joy.cy = touch.clientY - rect.top;
      joyBase.style.left = (joy.cx - 50) + 'px';
      joyBase.style.top = (joy.cy - 50) + 'px';
      joyBase.classList.add('active');
      joyStick.style.left = '35px'; joyStick.style.top = '35px';
    });

    joyZone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const touch of e.changedTouches) {
        if (touch.identifier !== joy.touchId) continue;
        const rect = joyZone.getBoundingClientRect();
        let ddx = touch.clientX - rect.left - joy.cx;
        let ddy = touch.clientY - rect.top - joy.cy;
        const dist = Math.hypot(ddx, ddy);
        if (dist < DEADZONE) {
          joy.dx = 0; joy.dy = 0;
          joyStick.style.left = '35px'; joyStick.style.top = '35px';
          return;
        }
        const clamped = Math.min(dist, JOY_MAX);
        const nx = ddx / dist, ny = ddy / dist;
        joy.dx = nx * (clamped / JOY_MAX);
        joy.dy = ny * (clamped / JOY_MAX);
        joyStick.style.left = (35 + nx * clamped) + 'px';
        joyStick.style.top = (35 + ny * clamped) + 'px';
      }
    });

    const endJoy = () => {
      joy.active = false; joy.dx = 0; joy.dy = 0; joy.touchId = null;
      joyBase.classList.remove('active');
    };
    joyZone.addEventListener('touchend', endJoy);
    joyZone.addEventListener('touchcancel', endJoy);
  }

  /* ================================================================
     SCREEN MANAGEMENT
     ================================================================ */

  function showIntro() {
    introScreen.classList.remove('hidden');
    gameScreen.classList.add('hidden');
    endScreen.classList.add('hidden');
    $('mobile-controls').classList.add('hidden');

    // Build level cards dynamically
    const container = $('level-list');
    container.innerHTML = '';

    LEVELS.forEach((lvl, i) => {
      const card = document.createElement('div');
      card.className = 'level-option';
      const typeBadge = lvl.type === 'volley' ? 'VOLLEY' : 'DRIBBLE';
      card.innerHTML = `
        <span class="type-badge ${lvl.type}">${typeBadge}</span>
        <div class="level-title">${lvl.title}</div>
        <div class="level-subtitle">${lvl.subtitle}</div>
        <p class="level-desc">${lvl.description}</p>
        <a href="${lvl.referenceVideoUrl}" target="_blank" rel="noopener" class="ref-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Watch the real goal
        </a>
        <button class="gr-play-btn level-play" data-idx="${i}">PLAY</button>
      `;
      container.appendChild(card);
    });

    // Attach play button handlers
    container.querySelectorAll('.level-play').forEach(btn => {
      btn.addEventListener('click', () => startGame(parseInt(btn.dataset.idx)));
    });

    // Show appropriate control hints
    if (isMobile) {
      $('controls-desktop').classList.add('hidden');
      $('controls-mobile').classList.remove('hidden');
    } else {
      $('controls-desktop').classList.remove('hidden');
      $('controls-mobile').classList.add('hidden');
    }
  }

  /* ================================================================
     INIT
     ================================================================ */

  function init() {
    canvas = $('game-canvas');
    ctx = canvas.getContext('2d');
    introScreen = $('intro-screen');
    gameScreen = $('game-screen');
    endScreen = $('end-screen');

    setupInput();
    showIntro();

    // Retry button
    $('retry-btn').addEventListener('click', () => startGame(levelIndex));
    // Back to menu
    const menuBtn = $('menu-btn');
    if (menuBtn) menuBtn.addEventListener('click', () => { showIntro(); window.scrollTo(0, 0); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
