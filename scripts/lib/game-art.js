/**
 * game-art.js — the five (now six) game illustrations, in one place.
 *
 * Both the club pages and the Games hub draw these. They were written for a
 * club page, so every one takes a { primary, secondary } colour pair; the
 * Games hub is not about any club, so it passes the brand palette instead and
 * gets the same drawings in cyan.
 *
 * Extracted so there is one copy. Five bespoke SVGs duplicated across two
 * templates is the shape of the bug that put "Málaga" in four places and left
 * one of them behind.
 */

/**
 * Black or white, whichever can be read on the club's own colour.
 *
 * The illustrations put a glyph INSIDE a shape filled with the primary, and a
 * hardcoded white "?" disappears on Norwich yellow, Watford amber or City's
 * light blue.
 *
 * Contrast ratios rather than a luminance threshold, and white wins ties by
 * default. The bare 0.179 crossover put Arsenal red (L = 0.184) on the dark
 * side by a thousandth, which is true — black scores 4.68 against white's
 * 4.49 — and wrong: those are the same contrast to a reader, and a white
 * number on a red shirt is what the shirt actually looks like. Black has to
 * be clearly better, not barely, before it is used.
 */
function ink(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#FFFFFF';
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(m[1].slice(i, i + 2), 16) / 255));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const onWhite = 1.05 / (L + 0.05);
  const onBlack = (L + 0.05) / 0.05;
  return onBlack > onWhite * 1.4 ? '#0A0E11' : '#FFFFFF';
}

/**
 * A pitch is green. The club plays ON it.
 *
 * Tinting the ground with the club colour gave Arsenal a burgundy pitch and
 * Norwich an olive one, which reads as a coloured panel rather than a football
 * pitch — the club colour had stopped identifying the club and started
 * painting every surface.
 *
 * So the ground is a fixed dark green and the PLAYERS carry the colour. The
 * one case that needs thought is a green club: green dots on green is the only
 * combination that disappears. `pitchGround` measures the hue and swaps to a
 * deep slate-teal for those clubs, which still reads as a tactics board.
 */
const PITCH_GREEN = '#0C2A1B';
const PITCH_SLATE = '#132532';

/** Hue and saturation of a hex colour, 0-360 and 0-1. */
function hueSat(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return { h: 0, s: 0 };
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (!d) return { h: 0, s: 0 };
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / max };
}

/** Green clubs get a slate pitch, so their players stay visible on it. */
function pitchGround(hex) {
  const { h, s } = hueSat(hex);
  return s > 0.25 && h >= 75 && h <= 175 ? PITCH_SLATE : PITCH_GREEN;
}

/** The featured card: a pitch with an eleven standing on it. */
function pitchArt(c) {
  const spots = [
    [100, 18],
    [36, 42], [78, 38], [122, 38], [164, 42],
    [36, 80], [78, 78], [122, 78], [164, 80],
    [76, 106], [124, 106],
  ];
  return `<svg class="art art-pitch" viewBox="0 0 200 124" aria-hidden="true"
         preserveAspectRatio="xMidYMid meet">
      <g fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="1.1">
        <rect x="7" y="7" width="186" height="110" rx="2"/>
        <path d="M7 62h186"/>
        <circle cx="100" cy="62" r="19"/>
        <path d="M64 7v15h72V7M64 117v-15h72v15"/>
      </g>
      <g class="dots">
        ${spots.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="${c.primary}"
          stroke="${c.secondary}" stroke-width="1.6"/>`).join('')}
      </g>
    </svg>`;
}

/** Two shirts, one up one down. */
function holArt(c) {
  const shirt = (x, y, fill, stroke) =>
    `<g transform="translate(${x} ${y})"><path d="M14 2 24 8 34 2l10 6-4 9-5-2.5V38H18V14.5L13 17 9 8Z"
       fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/></g>`;
  return `<svg class="art" viewBox="0 0 120 64" aria-hidden="true">
      ${shirt(4, 6, c.primary, c.secondary)}
      ${shirt(60, 18, 'transparent', 'currentColor')}
      <g fill="none" stroke="${c.primary}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M52 20v-9m0 0-3.5 3.5M52 11l3.5 3.5"/>
      </g>
      <g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M110 44v9m0 0 3.5-3.5M110 53l-3.5-3.5"/>
      </g>
    </svg>`;
}

/** A shirt with nobody in it. */
function whoArt(c) {
  return `<svg class="art" viewBox="0 0 120 64" aria-hidden="true">
      <g transform="translate(29 1) scale(1.55)">
        <path d="M14 2 24 8 34 2l10 6-4 9-5-2.5V38H18V14.5L13 17 9 8Z"
              fill="${c.primary}" stroke="${c.secondary}" stroke-width="1.6" stroke-linejoin="round"/>
        <text x="26.5" y="30" text-anchor="middle" font-size="16" font-weight="700"
              font-family="Space Mono, ui-monospace, monospace" fill="${ink(c.primary)}">?</text>
      </g>
    </svg>`;
}

/** The alphabet, mostly unfilled. */
function alphaArt(c) {
  const row = (letters, y, lit) => letters.split('').map((ch, i) => {
    const on = lit.includes(i);
    return `<g transform="translate(${6 + i * 19} ${y})">
      <rect width="15" height="17" rx="3" fill="${on ? c.primary : 'transparent'}"
            stroke="${on ? c.primary : 'currentColor'}" stroke-width="1.3"/>
      <text x="7.5" y="12.6" text-anchor="middle" font-size="9.5" font-weight="700"
            font-family="Space Mono, ui-monospace, monospace"
            fill="${on ? ink(c.primary) : 'currentColor'}">${ch}</text></g>`;
  }).join('');
  return `<svg class="art" viewBox="0 0 120 64" aria-hidden="true">
      ${row('ABCDE', 10, [0, 3])}
      ${row('FGHIJ', 34, [1])}
    </svg>`;
}

/** A board, three darts in it, and a score coming down to nothing. */
function bullseyeArt(c) {
  const rings = [
    { r: 25, fill: 'none', stroke: 'currentColor', w: 1.2 },
    { r: 18, fill: c.primary, stroke: c.secondary, w: 1.2 },
    { r: 11, fill: 'none', stroke: 'currentColor', w: 1.2 },
    { r: 5, fill: c.primary, stroke: c.secondary, w: 1.2 },
  ];
  return `<svg class="art" viewBox="0 0 120 64" aria-hidden="true">
      <g transform="translate(34 32)">
        ${rings.map((k) => `<circle r="${k.r}" fill="${k.fill}" stroke="${k.stroke}"
          stroke-width="${k.w}" opacity="${k.fill === 'none' ? '.5' : '1'}"/>`).join('')}
        <path d="M-25 0h50M0-25v50" stroke="currentColor" stroke-width="1" opacity=".3"/>
      </g>
      <g font-family="Space Mono, ui-monospace, monospace" font-weight="700"
         text-anchor="middle" fill="currentColor">
        <text x="88" y="22" font-size="13" opacity=".45">501</text>
        <text x="88" y="38" font-size="13" opacity=".7">180</text>
        <text x="88" y="54" font-size="14" fill="${c.primary}">0</text>
      </g>
    </svg>`;
}

/** Ten questions, a few answered. */
function quizArt(c) {
  const rows = [0, 1, 2, 3].map((i) => {
    const done = i < 2;
    return `<g transform="translate(10 ${7 + i * 14})">
      <rect width="11" height="11" rx="3" fill="${done ? c.primary : 'transparent'}"
            stroke="${done ? c.primary : 'currentColor'}" stroke-width="1.3"/>
      ${done ? `<path d="m3 5.6 2.2 2.2L8.4 3.4" fill="none" stroke="${ink(c.primary)}"
        stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      <rect x="19" y="3" width="${[64, 52, 70, 44][i]}" height="5" rx="2.5"
            fill="currentColor" opacity="${done ? '.5' : '.26'}"/></g>`;
  }).join('');
  return `<svg class="art" viewBox="0 0 120 64" aria-hidden="true">${rows}</svg>`;
}

/**
 * The featured game is Starting XI, and the choice is about the picture rather
 * than the game: a pitch with an eleven on it says "football" from across the
 * room in a way no icon does, and the featured slot is the one a visitor sees
 * before they read anything.
 */

module.exports = {
  ink, hueSat, pitchGround, PITCH_GREEN, PITCH_SLATE,
  pitchArt, holArt, whoArt, alphaArt, bullseyeArt, quizArt,
};
