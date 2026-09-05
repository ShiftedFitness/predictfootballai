/**
 * _ask_intents.js — the only queries Ask TeleStats can ever run.
 *
 * THE SECURITY BOUNDARY.
 *
 * A model never writes SQL here, never names a table, and never sees a
 * database connection. It chooses one intent from this file by name and
 * supplies parameters, and every parameter is validated against a schema
 * before a query is built. An intent that is not in this file cannot be run;
 * a parameter that fails validation stops the request.
 *
 * That is the difference between "an assistant that can answer football
 * questions from our data" and "an assistant with a database connection".
 *
 * Everything reads. Nothing writes.
 */

const teams = require('./_teams');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
const MAX_TEAMS = 4;

// ─── Validation ─────────────────────────────────────────────────────────────

class InvalidPlan extends Error {}

/** Club ids must exist in the manifest — not merely look like numbers. */
function validClubIds(ids) {
  if (!Array.isArray(ids) || !ids.length) throw new InvalidPlan('No teams given');
  if (ids.length > MAX_TEAMS) throw new InvalidPlan(`At most ${MAX_TEAMS} teams`);
  const out = [];
  for (const raw of ids) {
    const id = Number(raw);
    if (!Number.isInteger(id) || !teams.byClubId(id)) {
      throw new InvalidPlan(`Unknown team id: ${raw}`);
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

const COMPETITIONS = new Set(['Premier League', 'Championship', 'League One', 'League Two',
  'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Champions League', 'FA Cup', 'EFL Cup']);

function validCompetition(name) {
  if (name == null) return null;
  if (!COMPETITIONS.has(name)) throw new InvalidPlan(`Unknown competition: ${name}`);
  return name;
}

function validNationality(code) {
  if (code == null) return null;
  if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) {
    throw new InvalidPlan(`Unknown nationality: ${code}`);
  }
  return code;
}

const validLimit = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(v)));
};

const validMeasure = (m) => {
  if (m == null) return 'appearances';
  if (m !== 'appearances' && m !== 'goals') throw new InvalidPlan(`Unknown measure: ${m}`);
  return m;
};

// ─── Shared reads ───────────────────────────────────────────────────────────

async function rowsForClub(db, clubId, competitionName) {
  // The pre-aggregated tables, not the season rows: one indexed read either
  // way, where the raw table would be tens of thousands of rows to fold up in
  // JavaScript.
  const table = competitionName ? 'agg_player_club_comp' : 'agg_player_club';
  let q = db.from(table)
    .select('player_id, player_name, nationality, appearances, goals, first_season, last_season')
    .eq('club_id', clubId);
  if (competitionName) q = q.eq('competition_name', competitionName);
  const { data, error } = await q.order('appearances', { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  return data || [];
}

const seasonLabel = (y) => (y == null ? null : `${y}/${String(y + 1).slice(2)}`);

// ─── The intents ────────────────────────────────────────────────────────────

const INTENTS = {

  /**
   * Players who turned out for ALL of the named clubs.
   * "Who has played for both Plymouth Argyle and Manchester United?"
   */
  players_for_teams: {
    describe: 'Players who appeared for every one of the named clubs',
    async run(db, params) {
      const clubIds = validClubIds(params.club_ids);
      if (clubIds.length < 2) throw new InvalidPlan('Name at least two teams');
      const competition = validCompetition(params.competition);
      const nationality = validNationality(params.nationality);
      const limit = validLimit(params.limit);
      const measure = validMeasure(params.measure);

      const perClub = [];
      for (const id of clubIds) perClub.push(await rowsForClub(db, id, competition));

      // Intersect on player_id, keeping each club's own totals so the answer
      // can say what they did at each.
      let common = new Map(perClub[0].map((r) => [r.player_id, { player: r, spells: [] }]));
      perClub.forEach((rows, i) => {
        const here = new Map(rows.map((r) => [r.player_id, r]));
        for (const [pid, entry] of [...common]) {
          const hit = here.get(pid);
          if (!hit) { common.delete(pid); continue; }
          entry.spells[i] = hit;
        }
      });

      let results = [...common.values()];
      if (nationality) results = results.filter((r) => r.player.nationality === nationality);

      const total = (r) => r.spells.reduce((a, s) => a + ((s && s[measure]) || 0), 0);
      results.sort((a, b) => total(b) - total(a));

      return {
        count: results.length,
        rows: results.slice(0, limit).map((r) => ({
          player: r.player.player_name,
          nationality: r.player.nationality,
          total: total(r),
          clubs: clubIds.map((id, i) => ({
            team: teams.byClubId(id).name,
            appearances: r.spells[i] ? r.spells[i].appearances : 0,
            goals: r.spells[i] ? r.spells[i].goals : 0,
            from: r.spells[i] ? seasonLabel(r.spells[i].first_season) : null,
            to: r.spells[i] ? seasonLabel(r.spells[i].last_season) : null,
          })),
        })),
        scope: {
          teams: clubIds.map((id) => teams.byClubId(id).name),
          competition: competition || 'all competitions',
          nationality, measure,
        },
      };
    },
  },

  /**
   * The leading players at one club.
   * "Which Spanish players have the most Premier League appearances for Liverpool?"
   */
  top_players_for_team: {
    describe: 'Leading players at one club by appearances or goals',
    async run(db, params) {
      const clubIds = validClubIds(params.club_ids);
      if (clubIds.length !== 1) throw new InvalidPlan('Name exactly one team');
      const competition = validCompetition(params.competition);
      const nationality = validNationality(params.nationality);
      const limit = validLimit(params.limit);
      const measure = validMeasure(params.measure);

      let rows = await rowsForClub(db, clubIds[0], competition);
      if (nationality) rows = rows.filter((r) => r.nationality === nationality);
      rows.sort((a, b) => (b[measure] || 0) - (a[measure] || 0));

      return {
        count: rows.length,
        rows: rows.slice(0, limit).map((r) => ({
          player: r.player_name,
          nationality: r.nationality,
          appearances: r.appearances,
          goals: r.goals,
          from: seasonLabel(r.first_season),
          to: seasonLabel(r.last_season),
        })),
        scope: {
          teams: [teams.byClubId(clubIds[0]).name],
          competition: competition || 'all competitions',
          nationality, measure,
        },
      };
    },
  },

  /**
   * One player's clubs.
   * "Which clubs did Peter Crouch play for?"
   */
  player_clubs: {
    describe: 'Every club one player appeared for',
    async run(db, params) {
      const name = String(params.player_name || '').trim();
      if (name.length < 3 || name.length > 60) throw new InvalidPlan('Player name looks wrong');

      // ILIKE with the pattern parameterised by the client library — the name
      // is escaped for the wildcards it might contain, never concatenated into
      // anything executable.
      const safe = name.replace(/[%_,()]/g, ' ').trim();
      const { data, error } = await db.from('agg_player_club')
        .select('player_id, player_name, club_name, appearances, goals, first_season, last_season')
        .ilike('player_name', `%${safe}%`)
        .order('appearances', { ascending: false })
        .limit(60);
      if (error) throw new Error(error.message);

      const byPlayer = new Map();
      for (const r of data || []) {
        if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, { name: r.player_name, clubs: [] });
        byPlayer.get(r.player_id).clubs.push({
          team: r.club_name, appearances: r.appearances, goals: r.goals,
          from: seasonLabel(r.first_season), to: seasonLabel(r.last_season),
        });
      }
      const players = [...byPlayer.values()]
        .sort((a, b) => b.clubs.reduce((x, c) => x + c.appearances, 0)
                      - a.clubs.reduce((x, c) => x + c.appearances, 0));

      return {
        count: players.length,
        rows: players.slice(0, 3),
        scope: { query: safe, competition: 'all competitions' },
      };
    },
  },
};

/**
 * Run a plan. The ONLY way into the database from Ask TeleStats.
 */
async function execute(db, plan) {
  if (!plan || typeof plan !== 'object') throw new InvalidPlan('No query plan');
  const intent = INTENTS[plan.intent];
  if (!intent) throw new InvalidPlan(`Unsupported question type: ${plan.intent}`);
  const started = Date.now();
  const result = await intent.run(db, plan.params || {});
  return { ...result, intent: plan.intent, ms: Date.now() - started };
}

module.exports = { INTENTS, execute, InvalidPlan, MAX_LIMIT, MAX_TEAMS };
