/*  ============================================================
    Goal Recreator — Level Definitions
    ============================================================

    HOW TO ADD MORE LEVELS:
    ─────────────────────
    1. Duplicate a level object below
    2. Give it a unique `id` and set `type` ("dribble" or "volley")
    3. Pitch coords: (0,0) = top-left, goal at TOP, 600 × 900
    4. For volley levels: define passer, sweetSpot, timingWindow
    ============================================================ */

const LEVELS = [

  /* ──────────────────────────────────────────────────────────
     LEVEL 1 — Maradona vs England 1986
     "The Goal of the Century"
     Type: DRIBBLE — weave past defenders and shoot
     ────────────────────────────────────────────────────────── */
  {
    id: "maradona-1986",
    type: "dribble",
    title: "MARADONA 1986",
    subtitle: "THE GOAL OF THE CENTURY",
    description: "Receive the ball, turn, and dribble past 5 England defenders to score.",
    referenceVideoUrl: "https://www.youtube.com/watch?v=1wVho3I0NtU",

    /* Maradona received the ball just inside his own half,
       right of centre, with his back to goal — then turned */
    playerStart: { x: 385, y: 510 },
    playerStartDir: Math.PI / 2,  // facing DOWN (back to goal)

    playerKit: {
      shirtColors: ["#6CB4EE", "#FFFFFF"],
      stripes: true,
      shorts: "#1C1C1C",
      socks: "#FFFFFF",
      skin: "#D4A574",        // Argentine olive skin
      hair: "#1A1A1A",
      hairStyle: "curly",
      number: 10
    },

    /* The historic run path — curving right-to-left through the defence */
    idealPath: [
      { x: 385, y: 510 },
      { x: 368, y: 460 },
      { x: 348, y: 415 },
      { x: 330, y: 370 },
      { x: 315, y: 330 },
      { x: 300, y: 290 },
      { x: 285, y: 250 },
      { x: 275, y: 210 },
      { x: 272, y: 170 },
      { x: 280, y: 135 },
      { x: 295, y: 100 }
    ],
    pathToleranceRadius: 50,

    /* Base England kit — individual hair overridden per defender */
    defenderKit: {
      shirtColors: ["#FFFFFF"],
      stripes: false,
      shorts: "#1E3A5F",
      socks: "#FFFFFF",
      skin: "#F5CBA7"
    },

    defenders: [
      {
        name: "Beardsley",
        start: { x: 365, y: 458 },
        waypoints: [{ x: 330, y: 470 }, { x: 405, y: 445 }],
        speed: 1.4,
        radius: 12,
        hair: "#4A3728",          // dark brown
        hairStyle: "receding"     // thin on top, receding hairline
      },
      {
        name: "Reid",
        start: { x: 318, y: 375 },
        waypoints: [{ x: 280, y: 388 }, { x: 358, y: 365 }],
        speed: 1.6,
        radius: 12,
        hair: "#A0764A",          // ginger-brown
        hairStyle: "balding"      // noticeably thin/balding
      },
      {
        name: "Butcher",
        start: { x: 338, y: 305 },
        waypoints: [{ x: 298, y: 318 }, { x: 378, y: 292 }],
        speed: 1.8,
        radius: 12,
        hair: "#3D2B1F",          // dark brown
        hairStyle: "short"
      },
      {
        name: "Hodge",
        start: { x: 262, y: 268 },
        waypoints: [{ x: 228, y: 278 }, { x: 302, y: 255 }],
        speed: 1.5,
        radius: 12,
        hair: "#5C4033",          // medium brown
        hairStyle: "medium"       // 80s feathered
      },
      {
        name: "Fenwick",
        start: { x: 302, y: 195 },
        waypoints: [{ x: 262, y: 205 }, { x: 348, y: 185 }],
        speed: 1.7,
        radius: 12,
        hair: "#3D2B1F",          // dark brown
        hairStyle: "short"
      }
    ],

    goalkeeper: {
      name: "Shilton",
      start: { x: 300, y: 82 },
      waypoints: [{ x: 248, y: 80 }, { x: 352, y: 80 }],
      speed: 1.3,
      radius: 14
    },
    goalkeeperKit: {
      shirtColors: ["#C8C800"],
      stripes: false,
      shorts: "#1C1C1C",
      socks: "#C8C800",
      skin: "#F5CBA7",
      hair: "#3D2B1F",
      hairStyle: "curlyshort"
    },

    goalArea:  { x: 228, y: 12, width: 144, height: 42 },
    shotZone:  { x: 140, y: 75, width: 320, height: 210 },
    timeLimit: 15,
    pitch: { width: 600, height: 900 }
  },

  /* ──────────────────────────────────────────────────────────
     LEVEL 2 — Van Basten vs Soviet Union 1988
     "The Impossible Volley"
     Type: VOLLEY — time your run to meet an automated cross
     ────────────────────────────────────────────────────────── */
  {
    id: "van-basten-1988",
    type: "volley",
    title: "VAN BASTEN 1988",
    subtitle: "THE IMPOSSIBLE VOLLEY",
    description: "Time your run to meet Mühren's cross and volley it into the far corner.",
    referenceVideoUrl: "https://www.youtube.com/watch?v=ILJabEOngIY",

    /* Van Basten starts wide right, near the edge of the box */
    playerStart: { x: 440, y: 340 },
    playerStartDir: -Math.PI / 2,

    playerKit: {
      shirtColors: ["#FF6B00"],     // Netherlands orange
      stripes: false,
      shorts: "#FFFFFF",
      socks: "#FF6B00",
      skin: "#F5CBA7",
      hair: "#4A3728",              // dark brown
      hairStyle: "swept",           // slicked/swept back — classic '88
      number: 12
    },

    /* Mühren delivers the cross from the left wing */
    passer: {
      name: "Mühren",
      position: { x: 78, y: 250 },
      dir: 0,
      kit: {
        shirtColors: ["#FF6B00"],
        stripes: false,
        shorts: "#FFFFFF",
        socks: "#FF6B00",
        skin: "#F5CBA7",
        hair: "#8B6914",
        hairStyle: "short"
      },
      crossDelay: 2.5,              // seconds before first cross
      crossDuration: 1.8,           // how long ball is in the air
      crossTarget: { x: 415, y: 118 },  // far-post area
      crossPeak: 70                 // max "height" in px for visual arc
    },

    sweetSpot:    { x: 415, y: 125, radius: 35 },
    timingWindow: 0.45,             // seconds of leeway around ideal moment

    /* Base Soviet kit */
    defenderKit: {
      shirtColors: ["#CC0000"],     // Soviet red
      stripes: false,
      shorts: "#FFFFFF",
      socks: "#CC0000",
      skin: "#F5CBA7"
    },

    defenders: [
      {
        name: "Soviet Def",
        start: { x: 355, y: 205 },
        waypoints: [{ x: 330, y: 215 }, { x: 380, y: 195 }],
        speed: 1.0,
        radius: 12,
        hair: "#5C4033",
        hairStyle: "short"
      }
    ],

    goalkeeper: {
      name: "Dassaev",
      start: { x: 300, y: 78 },
      waypoints: [{ x: 260, y: 76 }, { x: 340, y: 76 }],
      speed: 1.2,
      radius: 14
    },
    goalkeeperKit: {
      shirtColors: ["#2A2A2A"],
      stripes: false,
      shorts: "#2A2A2A",
      socks: "#2A2A2A",
      skin: "#F5CBA7",
      hair: "#1A1A1A",
      hairStyle: "short"
    },

    goalArea:  { x: 228, y: 12, width: 144, height: 42 },
    timeLimit: 12,
    pitch: { width: 600, height: 900 }
  }
];
