/**
 * parse.js — turn one FBref stats page into normalised rows.
 *
 * The whole point of this file is that it never reads a cell with plain
 * .text(). FBref renders a country flag as a text span inside the very cells
 * that identify a player and a club:
 *
 *   nationality  <a href="/en/country/ENG/..."><span class="f-i">eng</span> ENG</a>
 *   team (intl)  <span><span class="f-i">it</span></span> <a href="/en/squads/dc56fe14/...">Milan</a>
 *
 * .text() scoops the flag up with the value, which is how the database ended
 * up with "eg egy" beside "egy" and a club literally called "eng Liverpool".
 * The flag only appears in multi-country competitions, so the same club came
 * out spelled two ways depending on which page it was scraped from.
 *
 * Two rules follow, and everything else here is detail:
 *   1. Strip .f-i spans before reading any cell.
 *   2. Prefer the href. FBref's links carry permanent ids — an 8-hex player
 *      id, an 8-hex squad id, a clean 3-letter country code — which do not
 *      depend on spelling, flags or markup changes.
 */

const cheerio = require('cheerio');

// ─── Cell readers ───────────────────────────────────────────────────────────

/** Cell text with the flag icon removed. Never use .text() directly. */
function cellText($, cell) {
  const $c = $(cell).clone();
  $c.find('.f-i').remove();
  return $c.text().replace(/\s+/g, ' ').trim();
}

const num = (s) => {
  const n = parseInt(String(s).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

/** /en/players/f586779e/Tammy-Abraham → f586779e */
const idFrom = (href, kind) => {
  const m = new RegExp(`/${kind}/([0-9a-f]{8})(?:/|$)`).exec(href || '');
  return m ? m[1] : null;
};

/** /en/country/ENG/England-Football → ENG */
const countryFrom = (href) => {
  const m = /\/country\/([A-Za-z]{3})(?:\/|$)/.exec(href || '');
  return m ? m[1].toUpperCase() : null;
};

/**
 * /en/squads/b2b47a98/2024-2025/Newcastle-United-Stats → "Newcastle United"
 *
 * The team CELL carries FBref's short display name ("Newcastle", "West Ham",
 * "Nottingham"), but the LINK carries the full one — which is the form the
 * database already uses. Taking the name from the slug means the rebuild's
 * club names line up with the existing rows instead of forking a second
 * spelling of four clubs.
 */
const clubNameFrom = (href) => {
  const m = /\/squads\/[0-9a-f]{8}\/(?:\d{4}-\d{4}\/)?([A-Za-z0-9-]+)-Stats/.exec(href || '');
  return m ? m[1].replace(/-/g, ' ') : null;
};

// ─── Table location ─────────────────────────────────────────────────────────

/**
 * Find a stats table, including the ones FBref serves commented out.
 * Champions League pages do this; Premier League pages sometimes do too.
 * Returns its own cheerio root, because a table parsed out of a comment
 * belongs to a different document than the page it came from.
 */
function findTable(html, tableId) {
  const $ = cheerio.load(html);
  if ($(`#${tableId}`).length) return { $, table: $(`#${tableId}`), commented: false };

  let found = null;
  $('*').contents().each(function () {
    if (found || this.type !== 'comment') return;
    if (!this.data.includes(`id="${tableId}"`)) return;
    const $c = cheerio.load(this.data);
    if ($c(`#${tableId}`).length) found = { $: $c, table: $c(`#${tableId}`), commented: true };
  });
  return found;
}

// ─── Standard player stats ──────────────────────────────────────────────────

const POSITION_BUCKET = {
  GK: 'GK',
  DF: 'DEF', 'DF,MF': 'DEF', 'DF,FW': 'DEF',
  MF: 'MID', 'MF,DF': 'MID', 'MF,FW': 'MID',
  FW: 'FWD', 'FW,MF': 'FWD', 'FW,DF': 'FWD',
};

function parseStandard(html) {
  const hit = findTable(html, 'stats_standard');
  if (!hit) return { rows: [], warnings: ['stats_standard table not found'] };

  const { $, table } = hit;
  const rows = [];
  const warnings = [];

  table.find('tbody tr').each((_, tr) => {
    const $tr = $(tr);
    if ($tr.hasClass('thead')) return;

    const $player = $tr.find('td[data-stat="player"]');
    if (!$player.length) return;

    const name = cellText($, $player);
    if (!name) return;

    const fbrefPlayerId = idFrom($player.find('a').attr('href'), 'players');
    const $team = $tr.find('td[data-stat="team"]');
    const teamHref = $team.find('a').attr('href');
    const fbrefSquadId = idFrom(teamHref, 'squads');

    const $nat = $tr.find('td[data-stat="nationality"]');
    // The country link is authoritative; the stripped cell text is the
    // fallback for the handful of rows that carry no link.
    const nationality = countryFrom($nat.find('a').attr('href')) ||
                        (cellText($, $nat).toUpperCase() || null);

    const cell = (stat) => cellText($, $tr.find(`td[data-stat="${stat}"]`));
    const positionRaw = cell('position') || null;

    const row = {
      fbref_player_id: fbrefPlayerId,
      player_name: name,
      nationality,
      birth_year: num(cell('birth_year')),
      age: num(cell('age')),

      fbref_squad_id: fbrefSquadId,
      // Full name from the link, short display name from the cell as fallback.
      club_name: clubNameFrom(teamHref) || cellText($, $team),
      club_name_short: cellText($, $team),

      position_raw: positionRaw,
      position_bucket: POSITION_BUCKET[positionRaw] || 'UNK',

      appearances: num(cell('games')) ?? 0,
      starts: num(cell('games_starts')),
      minutes: num(cell('minutes')),
      goals: num(cell('goals')) ?? 0,
      assists: num(cell('assists')),
      pens_scored: num(cell('pens_made')),
      pens_attempted: num(cell('pens_att')),
      cards_yellow: num(cell('cards_yellow')),
      cards_red: num(cell('cards_red')),
    };

    if (!row.fbref_player_id) warnings.push(`no player id: ${name}`);
    if (!row.fbref_squad_id) warnings.push(`no squad id: ${name} / ${row.club_name}`);

    row.sub_appearances =
      row.starts != null ? Math.max(0, row.appearances - row.starts) : null;

    rows.push(row);
  });

  return { rows, warnings, commented: hit.commented };
}

// ─── Keeper and defensive stats, merged in by player id ─────────────────────

function parseKeyed(html, tableId, fields) {
  const hit = findTable(html, tableId);
  if (!hit) return {};
  const { $, table } = hit;
  const out = {};

  table.find('tbody tr').each((_, tr) => {
    const $tr = $(tr);
    if ($tr.hasClass('thead')) return;
    const $player = $tr.find('td[data-stat="player"]');
    // Keyed on the FBref id, not on name+team. Name+team is what the old
    // ingest used, and it silently dropped anyone whose club name differed
    // by a flag between the two tables.
    const id = idFrom($player.find('a').attr('href'), 'players');
    if (!id) return;
    const rec = {};
    for (const [key, stat] of Object.entries(fields)) {
      rec[key] = num(cellText($, $tr.find(`td[data-stat="${stat}"]`)));
    }
    out[id] = rec;
  });
  return out;
}

const parseKeepers = (html) => parseKeyed(html, 'stats_keeper', {
  goals_against: 'gk_goals_against',
  clean_sheets: 'gk_clean_sheets',
  shots_on_target_against: 'gk_shots_on_target_against',
  saves: 'gk_saves',
  wins: 'gk_wins',
  draws: 'gk_ties',
  losses: 'gk_losses',
});

const parseDefense = (html) => parseKeyed(html, 'stats_defense', {
  tackles_won: 'tackles_won',
  interceptions: 'interceptions',
  tackles_interceptions: 'tackles_interceptions',
});

module.exports = {
  parseStandard, parseKeepers, parseDefense,
  cellText, findTable, idFrom, countryFrom, clubNameFrom, POSITION_BUCKET,
};
