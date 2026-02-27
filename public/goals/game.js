/* ============================================================
   Goal Recreator — Game Engine
   Sensible Soccer-style top-down pixel-art football game
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

  /* ── Game state ────────────────────────────────────────── */
  let state = 'idle';        // idle | playing | shooting | tackled | goalCelebration | ended
  let player, ball, defenders, keeper;
  let timeRemaining = 0;
  let lastTs = 0;
  let invulnTimer = 0;       // seconds of invulnerability left
  let tackleMsg = 0;         // seconds to show "TACKLED!" text
  let hintText = '';
  let hintTimer = 0;
  let showTutorial = true;
  let chevronPhase = 0;
  let shotAnim = null;       // { x, y, tx, ty, t, duration }
  let goalFlash = 0;
  let endReason = '';        // 'goal' | 'saved' | 'time'

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
  const PLAYER_SPEED = 210;  // px/s in canvas coords
  const INV_TIME     = 1.5;
  const TACKLE_MSG   = 1.0;
  const SHOT_SPEED   = 700;  // px/s
  const PITCH_GREEN  = '#3D8B37';
  const PITCH_GREEN2 = '#358230';
  const LINE_COLOR   = 'rgba(255,255,255,0.85)';
  const STRIPE_W     = 30;   // pitch stripe width

  const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  /* ================================================================
     SPRITE DRAWING — Sensible Soccer style pixel-art players
     ================================================================
     Each player is drawn as a tiny figure (~24px tall) with:
     - Large head (distinctive hair)
     - Small body with kit colors
     - Little legs with shorts + socks
     - Shadow underneath
  */

  function drawShadow(cx, cy, r) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx + 1, cy + r + 3, r * 1.0, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Draw a Sensible Soccer style player sprite (scaled up for visibility).
   * Big head, small body, animated legs — authentic SWOS feel.
   */
  function drawPlayer(cx, cy, kit, dir, isMoving, time, blink) {
    if (blink && Math.floor(time * 10) % 2 === 0) return;

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    const s = 1.6; // scale factor — bigger sprites for SWOS feel

    // Shadow
    drawShadow(cx, cy, 12 * s);

    // Leg animation — alternating stride
    const legCycle = isMoving ? Math.sin(time * 14) * 4 * s : 0;

    // ── Legs (socks + boots) ────────────────────────────
    const legY = Math.round(cy + 5 * s);
    const legW = Math.round(3 * s);
    const legH = Math.round(8 * s);
    const bootH = Math.round(2.5 * s);
    // Left leg
    ctx.fillStyle = kit.socks;
    ctx.fillRect(Math.round(cx - 5 * s + legCycle), legY, legW, legH);
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(Math.round(cx - 5 * s + legCycle), legY + legH - bootH, legW, bootH);
    // Right leg
    ctx.fillStyle = kit.socks;
    ctx.fillRect(Math.round(cx + 2 * s - legCycle), legY, legW, legH);
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(Math.round(cx + 2 * s - legCycle), legY + legH - bootH, legW, bootH);

    // ── Shorts ──────────────────────────────────────────
    const shortW = Math.round(12 * s);
    const shortH = Math.round(5 * s);
    ctx.fillStyle = kit.shorts;
    ctx.fillRect(Math.round(cx - 6 * s), Math.round(cy + 1.5 * s), shortW, shortH);

    // ── Shirt / torso ───────────────────────────────────
    const torsoW = Math.round(14 * s);
    const torsoH = Math.round(10 * s);
    const torsoX = Math.round(cx - 7 * s);
    const torsoY = Math.round(cy - 8 * s);

    if (kit.stripes && kit.shirtColors.length >= 2) {
      // Vertical stripes (Argentina — alternating 3px cols)
      const stripeWidth = Math.max(2, Math.round(3 * s));
      for (let i = 0; i < torsoW; i++) {
        const stripeIdx = Math.floor(i / stripeWidth) % kit.shirtColors.length;
        ctx.fillStyle = kit.shirtColors[stripeIdx];
        ctx.fillRect(torsoX + i, torsoY, 1, torsoH);
      }
      // Collar — white V-neck
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
      // Collar accent
      ctx.fillStyle = kit.shorts === '#1E3A5F' ? '#1E3A5F' : '#444';
      ctx.fillRect(Math.round(cx - 4 * s), torsoY, Math.round(8 * s), Math.round(1.5 * s));
    }

    // Sleeves (shirt color on arms)
    const sleeveColor = kit.shirtColors[0];
    const armW = Math.round(3 * s);
    const armH = Math.round(5 * s);
    ctx.fillStyle = sleeveColor;
    ctx.fillRect(Math.round(cx - 10 * s), Math.round(cy - 6 * s), armW, Math.round(3 * s));
    ctx.fillRect(Math.round(cx + 7 * s), Math.round(cy - 6 * s), armW, Math.round(3 * s));
    // Skin below sleeves
    ctx.fillStyle = kit.skin;
    ctx.fillRect(Math.round(cx - 10 * s), Math.round(cy - 3 * s), armW, armH);
    ctx.fillRect(Math.round(cx + 7 * s), Math.round(cy - 3 * s), armW, armH);

    // ── Head (SWOS signature: oversized) ────────────────
    const headCx = cx;
    const headCy = Math.round(cy - 14 * s);
    const headR  = Math.round(7.5 * s);

    // Hair (drawn behind/around head for volume)
    ctx.fillStyle = kit.hair;
    if (kit.hairStyle === 'curly') {
      // MARADONA — iconic voluminous curly mane
      // Big hair mass behind the head
      ctx.beginPath();
      ctx.arc(headCx, headCy - 2 * s, headR + 4 * s, Math.PI * 0.85, Math.PI * 0.15);
      ctx.fill();
      // Side volume (big puffy curls)
      ctx.beginPath();
      ctx.arc(headCx - headR - 1 * s, headCy - 1 * s, 4.5 * s, 0, Math.PI * 2);
      ctx.arc(headCx + headR + 1 * s, headCy - 1 * s, 4.5 * s, 0, Math.PI * 2);
      ctx.fill();
      // Top curls
      ctx.beginPath();
      ctx.arc(headCx - 5 * s, headCy - headR - 1 * s, 3.5 * s, 0, Math.PI * 2);
      ctx.arc(headCx + 5 * s, headCy - headR - 1 * s, 3.5 * s, 0, Math.PI * 2);
      ctx.arc(headCx, headCy - headR - 2 * s, 4 * s, 0, Math.PI * 2);
      ctx.fill();
      // Back of neck hair
      ctx.beginPath();
      ctx.arc(headCx, headCy + headR * 0.5, 5 * s, 0, Math.PI);
      ctx.fill();
      // Individual curl highlights (lighter)
      ctx.fillStyle = '#2C2C2C';
      for (let a = 0; a < 6; a++) {
        const angle = (a / 6) * Math.PI * 2;
        const cr = headR + 2.5 * s;
        ctx.beginPath();
        ctx.arc(headCx + Math.cos(angle) * cr, headCy - 2 * s + Math.sin(angle) * cr * 0.6, 1.5 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Short/standard hair
      ctx.beginPath();
      ctx.arc(headCx, headCy - 1 * s, headR + 1.5 * s, Math.PI * 0.9, Math.PI * 0.1, true);
      ctx.fill();
    }

    // Face (skin)
    ctx.fillStyle = kit.skin;
    ctx.beginPath();
    ctx.arc(headCx, headCy, headR, 0, Math.PI * 2);
    ctx.fill();

    // Eyes — slightly larger for SWOS expressiveness
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(Math.round(headCx - 4 * s), Math.round(headCy - 1.5 * s), Math.round(3 * s), Math.round(2.5 * s));
    ctx.fillRect(Math.round(headCx + 1 * s), Math.round(headCy - 1.5 * s), Math.round(3 * s), Math.round(2.5 * s));
    ctx.fillStyle = '#111';
    ctx.fillRect(Math.round(headCx - 3 * s), Math.round(headCy - 1 * s), Math.round(2 * s), Math.round(2 * s));
    ctx.fillRect(Math.round(headCx + 2 * s), Math.round(headCy - 1 * s), Math.round(2 * s), Math.round(2 * s));

    // Mouth (subtle)
    if (kit.hairStyle === 'curly') {
      // Maradona's little moustache hint
      ctx.fillStyle = kit.hair;
      ctx.fillRect(Math.round(headCx - 2 * s), Math.round(headCy + 2.5 * s), Math.round(4 * s), Math.round(1 * s));
    }

    // Shirt number on back
    if (kit.number) {
      ctx.fillStyle = kit.stripes ? '#1A1A1A' : '#333';
      ctx.font = `bold ${Math.round(9 * s)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(kit.number), cx, cy - 2 * s);
    }

    ctx.restore();
  }

  /* ── Draw ball — classic SWOS white ball with panels ──── */
  function drawBall(bx, by, r) {
    const br = r * 1.6; // match sprite scale
    ctx.save();
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(bx + 1, by + br + 2, br * 0.85, br * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    // Ball body
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
    // Black outline
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.stroke();
    // Pentagon panels
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(bx - br * 0.15, by - br * 0.15, br * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx + br * 0.35, by + br * 0.2, br * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ================================================================
     PITCH DRAWING — Sensible Soccer style with grass stripes
     ================================================================ */

  function drawPitch() {
    const W = level.pitch.width;
    const H = level.pitch.height;

    // Grass stripes
    for (let y = 0; y < H; y += STRIPE_W) {
      ctx.fillStyle = (Math.floor(y / STRIPE_W) % 2 === 0) ? PITCH_GREEN : PITCH_GREEN2;
      ctx.fillRect(0, y, W, STRIPE_W);
    }

    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 2;

    const pad = 24;
    const fieldL = pad, fieldR = W - pad, fieldT = pad, fieldB = H - pad;
    const fieldW = fieldR - fieldL;
    const fieldH = fieldB - fieldT;
    const midY = fieldT + fieldH / 2;
    const midX = fieldL + fieldW / 2;

    // Outer boundary
    ctx.strokeRect(fieldL, fieldT, fieldW, fieldH);

    // Center line
    ctx.beginPath();
    ctx.moveTo(fieldL, midY);
    ctx.lineTo(fieldR, midY);
    ctx.stroke();

    // Center circle
    ctx.beginPath();
    ctx.arc(midX, midY, 55, 0, Math.PI * 2);
    ctx.stroke();

    // Center spot
    ctx.fillStyle = LINE_COLOR;
    ctx.beginPath();
    ctx.arc(midX, midY, 3, 0, Math.PI * 2);
    ctx.fill();

    // ── Top penalty area ──────────────────────────────────
    const penW = 280, penH = 155;
    const penL = midX - penW / 2, penT = fieldT;
    ctx.strokeRect(penL, penT, penW, penH);

    // Top 6-yard box
    const sixW = 140, sixH = 50;
    ctx.strokeRect(midX - sixW / 2, fieldT, sixW, sixH);

    // Penalty spot
    ctx.fillStyle = LINE_COLOR;
    ctx.beginPath();
    ctx.arc(midX, fieldT + 110, 3, 0, Math.PI * 2);
    ctx.fill();

    // Penalty arc
    ctx.beginPath();
    ctx.arc(midX, fieldT + 110, 45, 0.3 * Math.PI, 0.7 * Math.PI);
    ctx.stroke();

    // ── Bottom penalty area (mirror) ─────────────────────
    const bPenT = fieldB - penH;
    ctx.strokeRect(penL, bPenT, penW, penH);

    const bSixT = fieldB - sixH;
    ctx.strokeRect(midX - sixW / 2, bSixT, sixW, sixH);

    ctx.fillStyle = LINE_COLOR;
    ctx.beginPath();
    ctx.arc(midX, fieldB - 110, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(midX, fieldB - 110, 45, 1.3 * Math.PI, 1.7 * Math.PI);
    ctx.stroke();

    // ── Goal nets (top) ──────────────────────────────────
    const goalW = 120, goalDepth = 18;
    const goalL = midX - goalW / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(goalL, fieldT - goalDepth, goalW, goalDepth);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(goalL, fieldT - goalDepth, goalW, goalDepth);
    // Net pattern
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 0.5;
    for (let nx = goalL; nx <= goalL + goalW; nx += 6) {
      ctx.beginPath();
      ctx.moveTo(nx, fieldT - goalDepth);
      ctx.lineTo(nx, fieldT);
      ctx.stroke();
    }
    for (let ny = fieldT - goalDepth; ny <= fieldT; ny += 6) {
      ctx.beginPath();
      ctx.moveTo(goalL, ny);
      ctx.lineTo(goalL + goalW, ny);
      ctx.stroke();
    }

    // Goal posts
    ctx.fillStyle = '#fff';
    ctx.fillRect(goalL - 2, fieldT - goalDepth, 4, goalDepth + 4);
    ctx.fillRect(goalL + goalW - 2, fieldT - goalDepth, 4, goalDepth + 4);

    // Reset stroke
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 2;

    // ── Corner arcs ──────────────────────────────────────
    const cornerR = 12;
    ctx.beginPath(); ctx.arc(fieldL, fieldT, cornerR, 0, Math.PI * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(fieldR, fieldT, cornerR, Math.PI * 0.5, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(fieldL, fieldB, cornerR, -Math.PI * 0.5, 0); ctx.stroke();
    ctx.beginPath(); ctx.arc(fieldR, fieldB, cornerR, Math.PI, Math.PI * 1.5); ctx.stroke();
  }

  /* ── Path guidance (ghost line + chevrons) ─────────────── */
  function drawGuidance(time) {
    const path = level.idealPath;
    if (!path || path.length < 2) return;

    // Ghost path line
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,100,0.15)';
    ctx.lineWidth = level.pathToleranceRadius * 0.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
    ctx.stroke();

    // Thin center line
    ctx.strokeStyle = 'rgba(255,255,100,0.3)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Animated chevrons along path
    chevronPhase = (time * 2) % 1; // 0..1 cycling
    const totalLen = getPathLength(path);
    const spacing = 40;
    const numChevrons = Math.floor(totalLen / spacing);

    for (let i = 0; i < numChevrons; i++) {
      const t = ((i / numChevrons) + chevronPhase * (1 / numChevrons)) % 1;
      const dist = t * totalLen;
      const pt = getPointAtDistance(path, dist);
      const pt2 = getPointAtDistance(path, dist + 5);
      if (!pt || !pt2) continue;

      const angle = Math.atan2(pt2.y - pt.y, pt2.x - pt.x);
      const alpha = 0.25 + 0.2 * Math.sin(time * 4 + i * 0.5);

      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(angle - Math.PI / 2);
      ctx.fillStyle = `rgba(255,255,100,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(5, 3);
      ctx.lineTo(-5, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  /* ── Shot zone highlight ───────────────────────────────── */
  function drawShotZone(time) {
    const sz = level.shotZone;
    const px = player.x, py = player.y;

    // Distance to shot zone center
    const scx = sz.x + sz.width / 2;
    const scy = sz.y + sz.height / 2;
    const dist = Math.hypot(px - scx, py - scy);
    const maxDist = 250;

    if (dist > maxDist) return;

    const insideZone = px >= sz.x && px <= sz.x + sz.width &&
                       py >= sz.y && py <= sz.y + sz.height;

    const alpha = insideZone
      ? 0.15 + 0.08 * Math.sin(time * 5)
      : 0.05 + 0.03 * Math.sin(time * 3);

    ctx.save();
    ctx.fillStyle = `rgba(255,255,100,${alpha})`;
    ctx.strokeStyle = `rgba(255,255,100,${alpha * 2.5})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);

    // Rounded rect
    roundRect(ctx, sz.x, sz.y, sz.width, sz.height, 6);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    if (insideZone) {
      ctx.fillStyle = 'rgba(255,255,100,0.7)';
      ctx.font = 'bold 11px "Space Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SHOOT!', scx, sz.y - 8);
    }

    ctx.restore();
  }

  /* ── Helper: rounded rectangle ─────────────────────────── */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* ── Path utilities ────────────────────────────────────── */
  function getPathLength(path) {
    let len = 0;
    for (let i = 1; i < path.length; i++) {
      len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    }
    return len;
  }

  function getPointAtDistance(path, dist) {
    let accum = 0;
    for (let i = 1; i < path.length; i++) {
      const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      if (accum + seg >= dist) {
        const t = (dist - accum) / seg;
        return {
          x: path[i - 1].x + (path[i].x - path[i - 1].x) * t,
          y: path[i - 1].y + (path[i].y - path[i - 1].y) * t
        };
      }
      accum += seg;
    }
    return path[path.length - 1];
  }

  function distToPath(px, py, path) {
    let minDist = Infinity;
    for (let i = 1; i < path.length; i++) {
      const d = distToSegment(px, py, path[i - 1].x, path[i - 1].y, path[i].x, path[i].y);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
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

    player = {
      x: lvl.playerStart.x,
      y: lvl.playerStart.y,
      radius: 14,
      dir: -Math.PI / 2,
      moving: false
    };

    ball = {
      x: player.x,
      y: player.y + 12,
      radius: 5,
      attached: true
    };

    defenders = lvl.defenders.map(d => ({
      x: d.start.x,
      y: d.start.y,
      radius: d.radius,
      speed: d.speed,
      waypoints: d.waypoints,
      wpIndex: 0,
      dir: 0,
      moving: true
    }));

    keeper = {
      x: lvl.goalkeeper.start.x,
      y: lvl.goalkeeper.start.y,
      radius: lvl.goalkeeper.radius,
      speed: lvl.goalkeeper.speed,
      waypoints: lvl.goalkeeper.waypoints,
      wpIndex: 0,
      dir: 0,
      moving: true
    };

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
    if (state !== 'playing' && state !== 'shooting' && state !== 'tackled') return;

    // Timer
    if (state === 'playing' || state === 'tackled') {
      timeRemaining -= dt;
      if (timeRemaining <= 0) {
        timeRemaining = 0;
        endReason = 'time';
        state = 'ended';
        showEndScreen();
        return;
      }
    }

    // Invulnerability countdown
    if (invulnTimer > 0) invulnTimer -= dt;
    if (tackleMsg > 0) tackleMsg -= dt;
    if (hintTimer > 0) hintTimer -= dt;

    // ── Shot animation ──────────────────────────────────
    if (state === 'shooting' && shotAnim) {
      shotAnim.t += dt;
      const progress = Math.min(shotAnim.t / shotAnim.duration, 1);
      const ease = 1 - Math.pow(1 - progress, 2); // ease-out
      ball.x = shotAnim.sx + (shotAnim.tx - shotAnim.sx) * ease;
      ball.y = shotAnim.sy + (shotAnim.ty - shotAnim.sy) * ease;

      // Check if keeper saves
      const dKeeper = Math.hypot(ball.x - keeper.x, ball.y - keeper.y);
      if (dKeeper < keeper.radius + ball.radius + 4) {
        endReason = 'saved';
        state = 'ended';
        showEndScreen();
        return;
      }

      // Check if ball reaches goal
      const ga = level.goalArea;
      if (ball.x >= ga.x && ball.x <= ga.x + ga.width &&
          ball.y >= ga.y && ball.y <= ga.y + ga.height) {
        endReason = 'goal';
        state = 'goalCelebration';
        goalFlash = 1.5;
        return;
      }

      if (progress >= 1) {
        // Shot went wide / over
        endReason = 'saved';
        state = 'ended';
        showEndScreen();
        return;
      }

      // Still move keeper during shot
      moveEntity(keeper, dt);
      return;
    }

    // ── Goal celebration ────────────────────────────────
    if (state === 'goalCelebration') {
      goalFlash -= dt;
      if (goalFlash <= 0) {
        state = 'ended';
        showEndScreen();
      }
      return;
    }

    // ── Tackle freeze ───────────────────────────────────
    if (state === 'tackled') {
      tackleMsg -= dt;
      if (tackleMsg <= 0) {
        state = 'playing';
        invulnTimer = INV_TIME;
      }
      return;
    }

    // ── Player movement ─────────────────────────────────
    let dx = 0, dy = 0;
    if (keys['ArrowUp'] || keys['KeyW']) dy -= 1;
    if (keys['ArrowDown'] || keys['KeyS']) dy += 1;
    if (keys['ArrowLeft'] || keys['KeyA']) dx -= 1;
    if (keys['ArrowRight'] || keys['KeyD']) dx += 1;

    if (joy.active) {
      dx += joy.dx;
      dy += joy.dy;
    }

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

    // Clamp to pitch
    player.x = Math.max(30, Math.min(level.pitch.width - 30, player.x));
    player.y = Math.max(30, Math.min(level.pitch.height - 30, player.y));

    // Attach ball to player (at feet, slightly ahead when moving)
    if (ball.attached) {
      const bOff = player.moving ? 16 : 10;
      ball.x = player.x + Math.cos(player.dir) * bOff;
      ball.y = player.y + Math.sin(player.dir) * bOff;
    }

    // ── Move defenders ──────────────────────────────────
    defenders.forEach(d => moveEntity(d, dt));
    moveEntity(keeper, dt);

    // ── Collision detection ─────────────────────────────
    if (invulnTimer <= 0) {
      for (const d of defenders) {
        const dist = Math.hypot(player.x - d.x, player.y - d.y);
        if (dist < player.radius + d.radius) {
          // Tackled!
          state = 'tackled';
          tackleMsg = TACKLE_MSG;
          player.x = level.playerStart.x;
          player.y = level.playerStart.y;
          ball.x = player.x;
          ball.y = player.y + 8;
          return;
        }
      }
      // Keeper collision
      const kDist = Math.hypot(player.x - keeper.x, player.y - keeper.y);
      if (kDist < player.radius + keeper.radius) {
        state = 'tackled';
        tackleMsg = TACKLE_MSG;
        player.x = level.playerStart.x;
        player.y = level.playerStart.y;
        ball.x = player.x;
        ball.y = player.y + 8;
        return;
      }
    }

    // ── Track defenders passed ──────────────────────────
    defenders.forEach((d, i) => {
      if (player.y < d.y - 20) defendersPassed.add(i);
    });

    // ── Path sampling ───────────────────────────────────
    sampleAccum += dt;
    if (sampleAccum >= SAMPLE_INTERVAL) {
      sampleAccum -= SAMPLE_INTERVAL;
      const d = distToPath(player.x, player.y, level.idealPath);
      pathSamples.push(d);
    }

    // ── Shoot request ───────────────────────────────────
    if (shootReq) {
      shootReq = false;
      handleShoot();
    }
  }

  function moveEntity(e, dt) {
    if (!e.waypoints || e.waypoints.length === 0) return;
    const target = e.waypoints[e.wpIndex];
    const dx = target.x - e.x, dy = target.y - e.y;
    const dist = Math.hypot(dx, dy);
    const moveAmount = e.speed * 60 * dt;

    if (dist < moveAmount) {
      e.x = target.x;
      e.y = target.y;
      e.wpIndex = (e.wpIndex + 1) % e.waypoints.length;
    } else {
      e.x += (dx / dist) * moveAmount;
      e.y += (dy / dist) * moveAmount;
    }
    e.dir = Math.atan2(dy, dx);
  }

  function handleShoot() {
    const sz = level.shotZone;
    const inside = player.x >= sz.x && player.x <= sz.x + sz.width &&
                   player.y >= sz.y && player.y <= sz.y + sz.height;

    if (!inside) {
      hintText = 'Too far! Get closer to the goal';
      hintTimer = 1.5;
      return;
    }

    // Aim at goal center with slight offset based on player x
    const ga = level.goalArea;
    const targetX = ga.x + ga.width / 2 + (player.x - 300) * 0.2;
    const targetY = ga.y + ga.height * 0.3;
    const dist = Math.hypot(targetX - player.x, targetY - player.y);

    ball.attached = false;
    shotAnim = {
      sx: ball.x, sy: ball.y,
      tx: targetX, ty: targetY,
      t: 0,
      duration: dist / SHOT_SPEED
    };
    state = 'shooting';
  }

  /* ── Scoring ───────────────────────────────────────────── */
  function calculateScore() {
    const goalMade = endReason === 'goal';

    // Path accuracy
    let pathAcc = 0;
    if (pathSamples.length > 0) {
      const avgDist = pathSamples.reduce((a, b) => a + b, 0) / pathSamples.length;
      pathAcc = Math.max(0, Math.min(100, Math.round(100 * (1 - avgDist / (level.pathToleranceRadius * 2.5)))));
    }

    const timeBonus = Math.max(0, Math.round(timeRemaining * 10) / 10);
    const beaten = defendersPassed.size;

    // Star rating (1-5)
    let stars = 1;
    if (goalMade) stars += 1;
    if (pathAcc >= 60) stars += 1;
    if (beaten >= 4) stars += 1;
    if (timeBonus >= 5) stars += 1;

    return { goalMade, pathAcc, timeBonus, beaten, stars };
  }

  /* ================================================================
     DRAWING — Main render
     ================================================================ */

  function draw(time) {
    const W = level.pitch.width;
    const H = level.pitch.height;

    ctx.clearRect(0, 0, W, H);

    drawPitch();
    drawGuidance(time);
    drawShotZone(time);

    // ── Defenders ───────────────────────────────────────
    defenders.forEach(d => {
      drawPlayer(d.x, d.y, level.defenderKit, d.dir, d.moving, time, false);
    });

    // ── Goalkeeper ──────────────────────────────────────
    drawPlayer(keeper.x, keeper.y, level.goalkeeperKit, keeper.dir, keeper.moving, time, false);

    // ── Ball (if detached / in flight) ──────────────────
    if (!ball.attached) {
      drawBall(ball.x, ball.y, ball.radius);
    }

    // ── Player (Maradona) ───────────────────────────────
    const blinking = invulnTimer > 0;
    drawPlayer(player.x, player.y, level.playerKit, player.dir, player.moving, time, blinking);

    // ── Ball (attached to player) ───────────────────────
    if (ball.attached) {
      drawBall(ball.x, ball.y, ball.radius);
    }

    // ── HUD: Timer ──────────────────────────────────────
    ctx.save();
    const timerText = Math.ceil(timeRemaining).toString();
    ctx.font = 'bold 28px "Space Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';

    // Timer background
    const tw = ctx.measureText(timerText).width + 20;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx, W - tw - 16, 8, tw + 8, 36, 6);
    ctx.fill();

    ctx.fillStyle = timeRemaining <= 5
      ? (Math.sin(time * 8) > 0 ? '#FF4444' : '#FFD60A')
      : '#FFFFFF';
    ctx.fillText(timerText, W - 16, 14);

    // Timer label
    ctx.font = '10px "Space Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('TIME', W - 16, 44);
    ctx.restore();

    // ── Tackle overlay ──────────────────────────────────
    if (state === 'tackled' || tackleMsg > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255,0,0,${Math.min(0.25, tackleMsg * 0.4)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#FF4444';
      ctx.font = 'bold 36px "Space Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('TACKLED!', W / 2, H / 2);
      ctx.restore();
    }

    // ── Goal celebration ────────────────────────────────
    if (state === 'goalCelebration') {
      const alpha = Math.min(0.6, goalFlash * 0.5);
      ctx.save();
      ctx.fillStyle = `rgba(255,215,0,${alpha})`;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#FFD60A';
      ctx.font = 'bold 54px "Space Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 8;
      ctx.fillText('GOOOAL!', W / 2, H / 2 - 20);
      ctx.font = 'bold 18px "Space Mono", monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText('THE GOAL OF THE CENTURY', W / 2, H / 2 + 30);
      ctx.restore();
    }

    // ── Hint text ───────────────────────────────────────
    if (hintTimer > 0 && hintText) {
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${Math.min(0.7, hintTimer)})`;
      const hm = ctx.measureText(hintText);
      roundRect(ctx, W / 2 - hm.width / 2 - 14, H - 80, hm.width + 28, 34, 8);
      ctx.fill();
      ctx.fillStyle = '#FFD60A';
      ctx.font = 'bold 13px "Space Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hintText, W / 2, H - 63);
      ctx.restore();
    }

    // ── Tutorial hint ───────────────────────────────────
    if (showTutorial && state === 'playing') {
      ctx.save();
      const tutText = isMobile
        ? 'Use joystick to dribble, then tap SHOOT in the zone!'
        : 'Arrow keys to dribble, SPACE to shoot in the zone!';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.font = '12px "Space Mono", monospace';
      const tm = ctx.measureText(tutText);
      roundRect(ctx, W / 2 - tm.width / 2 - 12, H - 50, tm.width + 24, 28, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tutText, W / 2, H - 36);
      ctx.restore();
    }
  }

  /* ================================================================
     GAME LOOP
     ================================================================ */

  let rafId = null;

  function gameLoop(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.05); // cap at 50ms
    lastTs = ts;

    update(dt);
    draw(ts / 1000);

    if (state !== 'ended') {
      rafId = requestAnimationFrame(gameLoop);
    }
  }

  function startGame() {
    const lvl = LEVELS[0];
    initGame(lvl);

    introScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    endScreen.classList.add('hidden');

    canvas.width = lvl.pitch.width;
    canvas.height = lvl.pitch.height;

    if (isMobile) {
      $('mobile-controls').classList.remove('hidden');
    }

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

    // Header
    const headerEl = $('end-header');
    if (endReason === 'goal') {
      headerEl.textContent = 'GOAL!';
      headerEl.className = 'end-title goal';
    } else if (endReason === 'saved') {
      headerEl.textContent = 'SAVED!';
      headerEl.className = 'end-title missed';
    } else {
      headerEl.textContent = 'TIME UP!';
      headerEl.className = 'end-title missed';
    }

    // Score breakdown
    $('score-goal').textContent = score.goalMade ? 'Yes' : 'No';
    $('score-goal').className = score.goalMade ? 'val yes' : 'val no';
    $('score-path').textContent = score.pathAcc + '%';
    $('score-time').textContent = score.timeBonus + 's';
    $('score-defenders').textContent = score.beaten + ' / ' + level.defenders.length;

    // Stars
    const starsEl = $('score-stars');
    starsEl.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const star = document.createElement('span');
      star.className = i < score.stars ? 'star filled' : 'star empty';
      star.textContent = i < score.stars ? '\u2605' : '\u2606';
      starsEl.appendChild(star);
    }
  }

  /* ================================================================
     INPUT HANDLERS
     ================================================================ */

  function setupInput() {
    // Keyboard
    document.addEventListener('keydown', e => {
      keys[e.code] = true;
      if (e.code === 'Space') {
        e.preventDefault();
        shootReq = true;
      }
    });
    document.addEventListener('keyup', e => {
      keys[e.code] = false;
    });

    // Shoot button (mobile + desktop click)
    const shootBtn = $('shoot-btn');
    if (shootBtn) {
      shootBtn.addEventListener('touchstart', e => {
        e.preventDefault();
        shootReq = true;
      });
      shootBtn.addEventListener('click', () => {
        shootReq = true;
      });
    }

    // Virtual joystick
    const joyZone = $('joystick-zone');
    const joyBase = $('joystick-base');
    const joyStick = $('joystick-stick');
    if (!joyZone) return;

    const JOY_MAX = 45;    // max distance from center
    const DEADZONE = 8;

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
      joyStick.style.left = '35px';
      joyStick.style.top = '35px';
    });

    joyZone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const touch of e.changedTouches) {
        if (touch.identifier !== joy.touchId) continue;
        const rect = joyZone.getBoundingClientRect();
        const tx = touch.clientX - rect.left;
        const ty = touch.clientY - rect.top;
        let dx = tx - joy.cx;
        let dy = ty - joy.cy;
        const dist = Math.hypot(dx, dy);

        if (dist < DEADZONE) {
          joy.dx = 0;
          joy.dy = 0;
          joyStick.style.left = '35px';
          joyStick.style.top = '35px';
          return;
        }

        const clamped = Math.min(dist, JOY_MAX);
        const nx = dx / dist, ny = dy / dist;
        joy.dx = nx * (clamped / JOY_MAX);
        joy.dy = ny * (clamped / JOY_MAX);

        joyStick.style.left = (35 + nx * clamped) + 'px';
        joyStick.style.top = (35 + ny * clamped) + 'px';
      }
    });

    const endJoy = () => {
      joy.active = false;
      joy.dx = 0;
      joy.dy = 0;
      joy.touchId = null;
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

    const lvl = LEVELS[0];
    $('level-title').textContent = lvl.title;
    $('level-subtitle').textContent = lvl.subtitle;
    $('level-desc').textContent = lvl.description;
    $('ref-video').href = lvl.referenceVideoUrl;

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

    // Play button
    $('play-btn').addEventListener('click', startGame);

    // Retry button
    $('retry-btn').addEventListener('click', startGame);
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
