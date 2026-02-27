/*  ============================================================
    Goal Recreator — Level Definitions
    ============================================================

    Each level describes a famous goal to recreate.

    HOW TO ADD MORE LEVELS:
    ─────────────────────
    1. Duplicate the level object below
    2. Give it a unique `id`
    3. Set the player start position, ideal path, defenders, etc.
    4. The pitch coordinate system is top-down:
       - (0, 0) is the top-left corner
       - Goal is at the TOP of the pitch
       - Player attacks upward (from bottom to top)
    5. All positions are in pitch coordinates (600 × 900)
    6. Kit config uses simple color arrays for the pixel-art sprites
    ============================================================ */

const LEVELS = [
  {
    id: "maradona-1986",
    title: "MARADONA 1986",
    subtitle: "THE GOAL OF THE CENTURY",
    description: "Dribble past 5 England defenders and score from inside the box.",
    referenceVideoUrl: "https://www.youtube.com/watch?v=1wVho3I0NtU",

    /* ── Attacker (Maradona) ────────────────────────────────── */
    playerStart: { x: 420, y: 740 },
    playerKit: {
      // Argentina home — light blue & white vertical stripes
      shirtColors: ["#6CB4EE", "#FFFFFF"],
      stripes: true,
      shorts: "#1C1C1C",
      socks: "#FFFFFF",
      skin: "#D4A574",
      hair: "#1A1A1A",
      hairStyle: "curly",     // Maradona's iconic curly hair
      number: 10
    },

    /* ── Ideal run path (polyline) ──────────────────────────── */
    idealPath: [
      { x: 420, y: 740 },
      { x: 395, y: 680 },
      { x: 365, y: 620 },
      { x: 340, y: 560 },
      { x: 318, y: 500 },
      { x: 300, y: 440 },
      { x: 285, y: 380 },
      { x: 275, y: 320 },
      { x: 268, y: 260 },
      { x: 272, y: 200 },
      { x: 285, y: 150 },
      { x: 300, y: 100 }
    ],
    pathToleranceRadius: 50,

    /* ── England defenders ──────────────────────────────────── */
    defenderKit: {
      shirtColors: ["#FFFFFF"],
      stripes: false,
      shorts: "#1E3A5F",       // navy blue
      socks: "#FFFFFF",
      skin: "#F5CBA7",
      hair: "#8B6914",
      hairStyle: "short"
    },

    defenders: [
      {
        // Peter Beardsley — near halfway, right side
        name: "Beardsley",
        start: { x: 380, y: 680 },
        waypoints: [{ x: 345, y: 695 }, { x: 425, y: 665 }],
        speed: 1.4,
        radius: 12
      },
      {
        // Peter Reid — just past halfway, center-right
        name: "Reid",
        start: { x: 320, y: 570 },
        waypoints: [{ x: 275, y: 580 }, { x: 365, y: 555 }],
        speed: 1.6,
        radius: 12
      },
      {
        // Terry Butcher — center, aggressive patrol
        name: "Butcher",
        start: { x: 340, y: 450 },
        waypoints: [{ x: 295, y: 465 }, { x: 385, y: 435 }],
        speed: 1.8,
        radius: 12
      },
      {
        // Steve Hodge — left-center, covering
        name: "Hodge",
        start: { x: 250, y: 385 },
        waypoints: [{ x: 215, y: 400 }, { x: 295, y: 370 }],
        speed: 1.5,
        radius: 12
      },
      {
        // Terry Fenwick — near the box, last outfield defender
        name: "Fenwick",
        start: { x: 300, y: 278 },
        waypoints: [{ x: 255, y: 290 }, { x: 345, y: 265 }],
        speed: 1.7,
        radius: 12
      }
    ],

    /* ── Goalkeeper ─────────────────────────────────────────── */
    goalkeeper: {
      name: "Shilton",
      start: { x: 300, y: 82 },
      waypoints: [{ x: 248, y: 80 }, { x: 352, y: 80 }],
      speed: 1.3,
      radius: 14
    },
    goalkeeperKit: {
      shirtColors: ["#C8C800"],   // Shilton's yellow/green jersey
      stripes: false,
      shorts: "#1C1C1C",
      socks: "#C8C800",
      skin: "#F5CBA7",
      hair: "#8B6914",
      hairStyle: "short"
    },

    /* ── Zones ──────────────────────────────────────────────── */
    goalArea:  { x: 228, y: 12, width: 144, height: 42 },
    shotZone:  { x: 140, y: 75, width: 320, height: 210 },

    timeLimit: 15,
    pitch: { width: 600, height: 900 }
  }
];
