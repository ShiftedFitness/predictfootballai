// netlify/functions/match_start.js
// Supabase-backed match start API for Football 501
// Returns eligible players for a category (country, club, goals, or other filters)

const { createClient } = require('@supabase/supabase-js');

// Environment variables (Netlify)
const SUPABASE_URL = process.env.Supabase_Project_URL;
const SUPABASE_SERVICE_KEY = process.env.Supabase_Service_Role;

// ============================================================
// CATEGORY DEFINITIONS
// ============================================================

// Country categories - filter by nationality code (apps mode)
const COUNTRY_CATEGORIES = {
  country_FRA: { code: 'FRA', name: 'France', flag: '🇫🇷' },
  country_ESP: { code: 'ESP', name: 'Spain', flag: '🇪🇸' },
  country_ARG: { code: 'ARG', name: 'Argentina', flag: '🇦🇷' },
  country_NED: { code: 'NED', name: 'Netherlands', flag: '🇳🇱' },
  country_POR: { code: 'POR', name: 'Portugal', flag: '🇵🇹' },
  country_IRL: { code: 'IRL', name: 'Ireland', flag: '🇮🇪' },
  country_SCO: { code: 'SCO', name: 'Scotland', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  country_WAL: { code: 'WAL', name: 'Wales', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
  country_NIR: { code: 'NIR', name: 'Northern Ireland', flag: '🇬🇧' },
  country_NOR: { code: 'NOR', name: 'Norway', flag: '🇳🇴' },
  country_DEN: { code: 'DEN', name: 'Denmark', flag: '🇩🇰' },
  country_BEL: { code: 'BEL', name: 'Belgium', flag: '🇧🇪' },
  country_GER: { code: 'GER', name: 'Germany', flag: '🇩🇪' },
};

// Club categories for apps mode - use exact DB values
// Map: categoryId -> { club: DB value, label: display name }
// Note: Man Utd - DB may use "Manchester United" or "Manchester Utd" - we try both
const CLUB_CATEGORIES = {
  club_Arsenal: { club: 'Arsenal', label: 'Arsenal' },
  club_ManUtd: { club: 'Manchester United', altClub: 'Manchester Utd', label: 'Man Utd' },
  club_Liverpool: { club: 'Liverpool', label: 'Liverpool' },
  club_Chelsea: { club: 'Chelsea', label: 'Chelsea' },
  club_ManCity: { club: 'Manchester City', label: 'Man City' },
  club_Tottenham: { club: 'Tottenham Hotspur', altClub: 'Spurs', label: 'Spurs' },
  club_Everton: { club: 'Everton', label: 'Everton' },
  club_Newcastle: { club: 'Newcastle United', altClub: 'Newcastle Utd', label: 'Newcastle' },
  club_AstonVilla: { club: 'Aston Villa', label: 'Aston Villa' },
  club_WestHam: { club: 'West Ham United', altClub: 'West Ham Utd', label: 'West Ham' },
  club_Southampton: { club: 'Southampton', label: 'Southampton' },
  club_Leicester: { club: 'Leicester City', label: 'Leicester' },
  club_Fulham: { club: 'Fulham', label: 'Fulham' },
  club_Blackburn: { club: 'Blackburn Rovers', label: 'Blackburn' },
  club_CrystalPalace: { club: 'Crystal Palace', label: 'Crystal Palace' },
  club_Sunderland: { club: 'Sunderland', label: 'Sunderland' },
  club_Middlesbrough: { club: 'Middlesbrough', label: 'Middlesbrough' },
  club_Leeds: { club: 'Leeds United', altClub: 'Leeds Utd', label: 'Leeds' },
};

// Goals categories - subtract goals_total instead of apps_total
const GOALS_CLUB_CATEGORIES = {
  goals_Arsenal: { club: 'Arsenal', label: 'Arsenal' },
  goals_Chelsea: { club: 'Chelsea', label: 'Chelsea' },
  goals_ManUtd: { club: 'Manchester United', altClub: 'Manchester Utd', label: 'Man Utd' },
  goals_Liverpool: { club: 'Liverpool', label: 'Liverpool' },
  goals_Tottenham: { club: 'Tottenham Hotspur', altClub: 'Spurs', label: 'Spurs' },
  goals_ManCity: { club: 'Manchester City', label: 'Man City' },
};

// Continental groupings - nationality code sets
const CONTINENT_CATEGORIES = {
  continent_CONCACAF: {
    name: 'CONCACAF',
    flag: '🌎',
    codes: ['USA', 'CAN', 'MEX', 'CRC', 'JAM', 'TRI', 'HON', 'PAN', 'GUA', 'SLV', 'HAI', 'CUB', 'DOM', 'BER', 'ANT', 'CUR', 'MTQ', 'GLP'],
  },
  continent_ASIA_OCEANIA: {
    name: 'Asia & Oceania',
    flag: '🌏',
    codes: ['AUS', 'NZL', 'JPN', 'KOR', 'CHN', 'IRN', 'IRQ', 'SAU', 'UAE', 'QAT', 'IND', 'THA', 'MAS', 'SIN', 'PHI', 'VIE', 'IDN', 'HKG', 'TPE', 'ISR', 'JOR', 'KUW', 'LBN', 'OMA', 'BHR', 'SYR', 'UZB', 'KAZ', 'TJK', 'KGZ', 'TKM', 'AFG', 'PAK', 'BGD', 'SRI', 'MYA', 'CAM', 'LAO', 'PRK', 'FIJ', 'PNG', 'SAM', 'TON', 'VAN', 'SOL', 'NCL', 'GUM', 'TAH'],
  },
  continent_SOUTH_AMERICA: {
    name: 'South America (excl. BRA/ARG)',
    flag: '🌎',
    // Explicitly excludes BRA and ARG
    codes: ['URU', 'CHI', 'COL', 'PER', 'ECU', 'PAR', 'VEN', 'BOL', 'GUY', 'SUR'],
  },
  continent_AFRICA: {
    name: 'Africa',
    flag: '🌍',
    codes: ['NGA', 'GHA', 'CIV', 'SEN', 'CMR', 'MAR', 'ALG', 'TUN', 'EGY', 'RSA', 'COD', 'MLI', 'BFA', 'GUI', 'ZIM', 'ZAM', 'KEN', 'UGA', 'TAN', 'ETH', 'GAB', 'CGO', 'TOG', 'BEN', 'NIG', 'SLE', 'LBR', 'GAM', 'ANG', 'MOZ', 'NAM', 'BOT', 'MAW', 'LES', 'SWZ', 'MTN', 'SUD', 'SSD', 'ERI', 'SOM', 'DJI', 'COM', 'MRI', 'MDG', 'SEY', 'CPV', 'STP', 'GNB', 'GNQ', 'CAF', 'RWA', 'BDI', 'LBA', 'CHA'],
  },
};

// ============================================================
// HINTS (non-spoiler, category-relevant)
// ============================================================
const HINTS = {
  country_FRA: 'French players have been a staple of the Premier League since 1992.',
  country_ESP: 'Spanish flair has graced the EPL since the early 2000s.',
  country_ARG: 'Argentine players have a rich history in England, particularly in attack.',
  country_NED: 'Dutch players were among the earliest foreign imports to the Premier League.',
  country_POR: 'Portuguese players have made significant impacts, especially since 2003.',
  country_IRL: 'Irish players have been in the English top flight since the beginning.',
  country_SCO: 'Scottish players have a long history in English football.',
  country_WAL: 'Welsh players have contributed to the Premier League since its inception.',
  country_NIR: 'Northern Irish players continue a proud tradition in English football.',
  country_NOR: 'Norwegian players made their mark especially in the late 90s and 2000s.',
  country_DEN: 'Danish players have been consistent performers in the Premier League.',
  country_BEL: 'Belgian players became prominent in the EPL from the 2010s onwards.',
  country_GER: 'German players have increasingly featured in the Premier League.',
  club_Arsenal: 'The Gunners have featured over 200 players in Premier League history.',
  club_ManUtd: 'Manchester United have the most Premier League titles.',
  club_Liverpool: 'Liverpool FC has seen many legendary players across all eras.',
  club_Chelsea: 'Chelsea have been a dominant force since the 2000s.',
  club_ManCity: 'Manchester City transformed into a powerhouse in the 2010s.',
  club_Tottenham: 'Spurs have had many talented players over the decades.',
  club_Everton: 'Everton are one of the founding members of the Premier League.',
  club_Newcastle: 'The Magpies have passionate fans and a rich history.',
  club_AstonVilla: 'Aston Villa are one of England\'s most historic clubs.',
  club_WestHam: 'The Hammers have produced many academy talents.',
  club_Southampton: 'Saints are known for developing young players.',
  club_Leicester: 'From survival specialists to champions in 2016.',
  club_Fulham: 'Fulham have yo-yoed between divisions over the years.',
  club_Blackburn: 'Blackburn won the Premier League in 1995.',
  club_CrystalPalace: 'Palace have been a consistent top-flight presence.',
  club_Sunderland: 'The Black Cats have had many dramatic seasons.',
  club_Middlesbrough: 'Boro have had memorable European campaigns.',
  club_Leeds: 'Leeds were dominant in the early 2000s before their fall.',
  goals_overall: 'Score goals from any Premier League player.',
  goals_Arsenal: 'Arsenal have had many prolific goal scorers.',
  goals_Chelsea: 'Chelsea have featured numerous deadly strikers.',
  goals_ManUtd: 'United have had legendary forwards throughout history.',
  goals_Liverpool: 'Liverpool forwards have been among the best in Europe.',
  goals_Tottenham: 'Spurs have had iconic goal scorers over the years.',
  goals_ManCity: 'City have assembled world-class attacking talent.',
  other_2clubs: 'Players who have represented 2 or more Premier League clubs.',
  other_3clubs: 'Players who have journeyed through 3 or more Premier League clubs.',
  continent_CONCACAF: 'Players from North America, Central America, and the Caribbean.',
  continent_ASIA_OCEANIA: 'Players from Asia and Oceania, including Australia and Japan.',
  continent_SOUTH_AMERICA: 'South American players excluding Argentina and Brazil.',
  continent_AFRICA: 'African players from across the continent.',
};

// ============================================================
// TRIVIA (category-themed, no player names, no gameplay advantage)
// ============================================================
const TRIVIA = {
  country_FRA: [
    { q: 'Which decade saw the most French players debut in the Premier League?', options: ['1990s', '2000s', '2010s', '2020s'], answer: 1 },
    { q: 'True or false: France has had more EPL players than any other non-UK country.', options: ['True', 'False'], answer: 0 },
  ],
  country_ESP: [
    { q: 'Which EPL club historically signed the most Spanish players?', options: ['Arsenal', 'Chelsea', 'Man City', 'Liverpool'], answer: 2 },
    { q: 'In which decade did Spanish players first become common in the EPL?', options: ['1990s', '2000s', '2010s', '2020s'], answer: 1 },
  ],
  country_ARG: [
    { q: 'Approximately how many Argentine players have appeared in the Premier League?', options: ['Under 30', '30-50', '50-80', 'Over 80'], answer: 1 },
    { q: 'Which position have Argentine EPL players most commonly played?', options: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'], answer: 3 },
  ],
  country_NED: [
    { q: 'What year did the Premier League begin?', options: ['1990', '1992', '1994', '1996'], answer: 1 },
    { q: 'True or false: Dutch players were among the first foreign imports to the EPL.', options: ['True', 'False'], answer: 0 },
  ],
  country_POR: [
    { q: 'Which decade saw the biggest influx of Portuguese players to the EPL?', options: ['1990s', '2000s', '2010s', '2020s'], answer: 1 },
    { q: 'How many EPL clubs have fielded Portuguese players?', options: ['Under 10', '10-15', '15-20', 'Over 20'], answer: 2 },
  ],
  country_IRL: [
    { q: 'True or false: Irish players have been in English football since before the Premier League era.', options: ['True', 'False'], answer: 0 },
  ],
  country_SCO: [
    { q: 'True or false: Scotland has produced Premier League title-winning captains.', options: ['True', 'False'], answer: 0 },
  ],
  country_BEL: [
    { q: 'In which decade did Belgian players become most prominent in the EPL?', options: ['1990s', '2000s', '2010s', '2020s'], answer: 2 },
  ],
  club_Arsenal: [
    { q: 'In what year did Arsenal go unbeaten in the league?', options: ['2002', '2003', '2004', '2005'], answer: 2 },
    { q: 'Approximately how many players have made EPL appearances for Arsenal?', options: ['Under 150', '150-200', '200-250', 'Over 250'], answer: 2 },
  ],
  club_ManUtd: [
    { q: 'How many EPL titles has Manchester United won?', options: ['10', '13', '15', '20'], answer: 1 },
    { q: 'In which decade did Man Utd win the most Premier League titles?', options: ['1990s', '2000s', '2010s', '2020s'], answer: 1 },
  ],
  club_Liverpool: [
    { q: 'What year did Liverpool win their first Premier League title?', options: ['2019', '2020', '2021', '2022'], answer: 1 },
    { q: 'Approximately how many players have made EPL appearances for Liverpool?', options: ['Under 150', '150-200', '200-250', 'Over 250'], answer: 2 },
  ],
  club_Chelsea: [
    { q: 'In what year did Chelsea win their first Premier League title?', options: ['2003', '2004', '2005', '2006'], answer: 2 },
  ],
  club_ManCity: [
    { q: 'In what year did Manchester City win their first Premier League title?', options: ['2010', '2011', '2012', '2013'], answer: 2 },
  ],
  club_Leicester: [
    { q: 'How many points did Leicester get in their 2015-16 title-winning season?', options: ['77', '81', '85', '87'], answer: 1 },
    { q: 'Before 2016, when was Leicester\'s previous top-flight title?', options: ['1950s', '1960s', '1970s', 'Never'], answer: 3 },
  ],
  club_Sunderland: [
    { q: 'How many EPL seasons has Sunderland competed in?', options: ['14', '16', '18', '20'], answer: 1 },
    { q: 'In which decade did Sunderland last play in the Premier League?', options: ['1990s', '2000s', '2010s', '2020s'], answer: 2 },
  ],
  club_Blackburn: [
    { q: 'In what year did Blackburn win the Premier League?', options: ['1993', '1994', '1995', '1996'], answer: 2 },
  ],
  goals_overall: [
    { q: 'True or false: The Premier League has seen over 30,000 goals scored.', options: ['True', 'False'], answer: 0 },
  ],
  other_2clubs: [
    { q: 'True or false: Most Premier League players have played for only one club.', options: ['True', 'False'], answer: 0 },
  ],
  other_3clubs: [
    { q: 'Approximately what percentage of EPL players have played for 3+ clubs?', options: ['Under 10%', '10-20%', '20-30%', 'Over 30%'], answer: 1 },
  ],
  continent_CONCACAF: [
    { q: 'Which CONCACAF country has produced the most EPL players?', options: ['USA', 'Canada', 'Mexico', 'Jamaica'], answer: 3 },
  ],
  continent_ASIA_OCEANIA: [
    { q: 'Which Asian or Oceanian country has the most EPL representatives?', options: ['Japan', 'South Korea', 'Australia', 'China'], answer: 2 },
  ],
  continent_SOUTH_AMERICA: [
    { q: 'Which South American country (excl. Brazil/Argentina) has produced the most EPL players?', options: ['Colombia', 'Uruguay', 'Chile', 'Peru'], answer: 0 },
  ],
  continent_AFRICA: [
    { q: 'Which African country has produced the most Premier League players?', options: ['Nigeria', 'Ghana', 'Ivory Coast', 'Senegal'], answer: 0 },
  ],
};

// ============================================================
// UTILITIES
// ============================================================

function normalize(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.-]/g, '').trim();
}

function respond(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

// ============================================================
// HANDLER
// ============================================================

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'POST only' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { categoryId, datasetVersion = 'epl_v1' } = body;

    console.log('[match_start] Request:', { categoryId, datasetVersion });

    // Initialize Supabase client
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.error('[match_start] Missing Supabase credentials');
      return respond(500, { error: 'Server configuration error' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let eligiblePlayers = [];
    let categoryName = '';
    let categoryFlag = '';
    let metric = 'apps_total';
    let metricLabel = 'Apps';

    // ============================================================
    // COUNTRY CATEGORIES (apps mode)
    // ============================================================
    if (categoryId && COUNTRY_CATEGORIES[categoryId]) {
      const cat = COUNTRY_CATEGORIES[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;

      console.log('[match_start] Fetching country data for:', cat.code);

      // Get player competition totals + player info
      const { data: pctData, error: pctError } = await supabase
        .from('player_competition_totals')
        .select(`
          player_id,
          apps_total,
          goals_total,
          mins_total,
          starts_total,
          players!inner (
            player_id,
            name,
            normalized_name,
            nationality
          )
        `)
        .eq('competition', 'EPL')
        .eq('players.nationality', cat.code)
        .gt('apps_total', 0);

      if (pctError) {
        console.error('[match_start] Supabase error:', pctError);
        return respond(500, { error: pctError.message });
      }

      // Get clubs for each player
      const playerIds = (pctData || []).map(r => r.player_id);
      let clubsMap = {};
      let seasonsMap = {};

      if (playerIds.length > 0) {
        // Get clubs from player_club_totals
        const { data: clubData } = await supabase
          .from('player_club_totals')
          .select('player_id, club')
          .eq('competition', 'EPL')
          .in('player_id', playerIds);

        // Group clubs by player
        (clubData || []).forEach(r => {
          if (!clubsMap[r.player_id]) clubsMap[r.player_id] = [];
          if (!clubsMap[r.player_id].includes(r.club)) {
            clubsMap[r.player_id].push(r.club);
          }
        });

        // Get seasons count from player_season_stats
        const { data: seasonData } = await supabase
          .from('player_season_stats')
          .select('player_id, season')
          .eq('competition', 'EPL')
          .in('player_id', playerIds);

        // Count unique seasons per player
        const seasonSets = {};
        (seasonData || []).forEach(r => {
          if (!seasonSets[r.player_id]) seasonSets[r.player_id] = new Set();
          seasonSets[r.player_id].add(r.season);
        });
        for (const pid in seasonSets) {
          seasonsMap[pid] = seasonSets[pid].size;
        }
      }

      eligiblePlayers = (pctData || []).map(row => {
        const clubs = clubsMap[row.player_id] || [];
        return {
          playerId: row.player_id,
          name: row.players.name,
          normalized: row.players.normalized_name || normalize(row.players.name),
          nationality: row.players.nationality,
          subtractValue: row.apps_total,
          overlay: {
            apps: row.apps_total,
            goals: row.goals_total,
            mins: row.mins_total,
            starts: row.starts_total,
          },
          clubs: clubs.slice(0, 5),
          clubCount: clubs.length,
          seasonsCount: seasonsMap[row.player_id] || null,
        };
      });

      console.log('[match_start] Found', eligiblePlayers.length, 'players for country', cat.code);
    }

    // ============================================================
    // CLUB CATEGORIES (apps mode)
    // ============================================================
    else if (categoryId && CLUB_CATEGORIES[categoryId]) {
      const cat = CLUB_CATEGORIES[categoryId];
      categoryName = cat.label;
      categoryFlag = '⚽';

      // Try primary club name first, then altClub if 0 results
      let clubToUse = cat.club;
      console.log('[match_start] Fetching club data for:', clubToUse);

      let { data, error } = await supabase
        .from('player_club_totals')
        .select(`
          player_id,
          club,
          apps_total,
          goals_total,
          mins_total,
          starts_total,
          players!inner (
            player_id,
            name,
            normalized_name,
            nationality
          )
        `)
        .eq('competition', 'EPL')
        .eq('club', clubToUse)
        .gt('apps_total', 0);

      if (error) {
        console.error('[match_start] Supabase error:', error);
        return respond(500, { error: error.message });
      }

      // If 0 results and altClub exists, try altClub
      if ((!data || data.length === 0) && cat.altClub) {
        console.log('[match_start] Primary club returned 0, trying altClub:', cat.altClub);
        clubToUse = cat.altClub;
        const altResult = await supabase
          .from('player_club_totals')
          .select(`
            player_id,
            club,
            apps_total,
            goals_total,
            mins_total,
            starts_total,
            players!inner (
              player_id,
              name,
              normalized_name,
              nationality
            )
          `)
          .eq('competition', 'EPL')
          .eq('club', cat.altClub)
          .gt('apps_total', 0);

        if (!altResult.error) {
          data = altResult.data;
        }
      }

      // DEBUG: If still 0 results for ManUtd, query what club names contain 'Man'
      if ((!data || data.length === 0) && categoryId === 'club_ManUtd') {
        console.log('[match_start] DEBUG: ManUtd still 0 results. Checking DB for club names containing "Man"...');
        const { data: debugData } = await supabase
          .from('player_club_totals')
          .select('club')
          .eq('competition', 'EPL')
          .ilike('club', '%Man%')
          .limit(20);
        const uniqueClubs = [...new Set((debugData || []).map(r => r.club))];
        console.log('[match_start] DEBUG: Clubs containing "Man":', uniqueClubs);

        // Try exact match with first result if found
        const manUtdVariant = uniqueClubs.find(c => c.toLowerCase().includes('united') || c.toLowerCase().includes('utd'));
        if (manUtdVariant) {
          console.log('[match_start] DEBUG: Trying DB variant:', manUtdVariant);
          const variantResult = await supabase
            .from('player_club_totals')
            .select(`
              player_id,
              club,
              apps_total,
              goals_total,
              mins_total,
              starts_total,
              players!inner (
                player_id,
                name,
                normalized_name,
                nationality
              )
            `)
            .eq('competition', 'EPL')
            .eq('club', manUtdVariant)
            .gt('apps_total', 0);

          if (!variantResult.error && variantResult.data && variantResult.data.length > 0) {
            data = variantResult.data;
            clubToUse = manUtdVariant;
            console.log('[match_start] DEBUG: Found', data.length, 'players using variant:', manUtdVariant);
          }
        }
      }

      // Get all clubs for these players
      const playerIds = (data || []).map(r => r.player_id);
      let clubsMap = {};
      let seasonsMap = {};

      if (playerIds.length > 0) {
        const { data: allClubData } = await supabase
          .from('player_club_totals')
          .select('player_id, club')
          .eq('competition', 'EPL')
          .in('player_id', playerIds);

        (allClubData || []).forEach(r => {
          if (!clubsMap[r.player_id]) clubsMap[r.player_id] = [];
          if (!clubsMap[r.player_id].includes(r.club)) {
            clubsMap[r.player_id].push(r.club);
          }
        });

        const { data: seasonData } = await supabase
          .from('player_season_stats')
          .select('player_id, season')
          .eq('competition', 'EPL')
          .in('player_id', playerIds);

        const seasonSets = {};
        (seasonData || []).forEach(r => {
          if (!seasonSets[r.player_id]) seasonSets[r.player_id] = new Set();
          seasonSets[r.player_id].add(r.season);
        });
        for (const pid in seasonSets) {
          seasonsMap[pid] = seasonSets[pid].size;
        }
      }

      eligiblePlayers = (data || []).map(row => {
        const clubs = clubsMap[row.player_id] || [row.club];
        return {
          playerId: row.player_id,
          name: row.players.name,
          normalized: row.players.normalized_name || normalize(row.players.name),
          nationality: row.players.nationality,
          subtractValue: row.apps_total,
          overlay: {
            apps: row.apps_total,
            goals: row.goals_total,
            mins: row.mins_total,
            starts: row.starts_total,
            club: row.club,
          },
          clubs: clubs.slice(0, 5),
          clubCount: clubs.length,
          seasonsCount: seasonsMap[row.player_id] || null,
        };
      });

      console.log('[match_start] Found', eligiblePlayers.length, 'players for club', clubToUse);
    }

    // ============================================================
    // GOALS OVERALL (subtract goals from all EPL players)
    // ============================================================
    else if (categoryId === 'goals_overall') {
      categoryName = 'All EPL Goals';
      categoryFlag = '⚽';
      metric = 'goals_total';
      metricLabel = 'Goals';

      console.log('[match_start] Fetching all EPL goals data');

      const { data, error } = await supabase
        .from('player_competition_totals')
        .select(`
          player_id,
          apps_total,
          goals_total,
          mins_total,
          starts_total,
          players!inner (
            player_id,
            name,
            normalized_name,
            nationality
          )
        `)
        .eq('competition', 'EPL')
        .gt('goals_total', 0);

      if (error) {
        console.error('[match_start] Supabase error:', error);
        return respond(500, { error: error.message });
      }

      const playerIds = (data || []).map(r => r.player_id);
      let clubsMap = {};

      if (playerIds.length > 0) {
        const { data: clubData } = await supabase
          .from('player_club_totals')
          .select('player_id, club')
          .eq('competition', 'EPL')
          .in('player_id', playerIds);

        (clubData || []).forEach(r => {
          if (!clubsMap[r.player_id]) clubsMap[r.player_id] = [];
          if (!clubsMap[r.player_id].includes(r.club)) {
            clubsMap[r.player_id].push(r.club);
          }
        });
      }

      eligiblePlayers = (data || []).map(row => {
        const clubs = clubsMap[row.player_id] || [];
        return {
          playerId: row.player_id,
          name: row.players.name,
          normalized: row.players.normalized_name || normalize(row.players.name),
          nationality: row.players.nationality,
          subtractValue: row.goals_total,
          overlay: {
            apps: row.apps_total,
            goals: row.goals_total,
            mins: row.mins_total,
            starts: row.starts_total,
          },
          clubs: clubs.slice(0, 5),
          clubCount: clubs.length,
        };
      });

      console.log('[match_start] Found', eligiblePlayers.length, 'players with goals');
    }

    // ============================================================
    // GOALS BY CLUB (subtract goals from specific club)
    // ============================================================
    else if (categoryId && GOALS_CLUB_CATEGORIES[categoryId]) {
      const cat = GOALS_CLUB_CATEGORIES[categoryId];
      categoryName = `${cat.label} Goals`;
      categoryFlag = '⚽';
      metric = 'goals_total';
      metricLabel = 'Goals';

      // Try primary club name first, then altClub if 0 results
      let clubToUse = cat.club;
      console.log('[match_start] Fetching goals data for club:', clubToUse);

      let { data, error } = await supabase
        .from('player_club_totals')
        .select(`
          player_id,
          club,
          apps_total,
          goals_total,
          mins_total,
          starts_total,
          players!inner (
            player_id,
            name,
            normalized_name,
            nationality
          )
        `)
        .eq('competition', 'EPL')
        .eq('club', clubToUse)
        .gt('goals_total', 0);

      if (error) {
        console.error('[match_start] Supabase error:', error);
        return respond(500, { error: error.message });
      }

      // If 0 results and altClub exists, try altClub
      if ((!data || data.length === 0) && cat.altClub) {
        console.log('[match_start] Primary club (goals) returned 0, trying altClub:', cat.altClub);
        clubToUse = cat.altClub;
        const altResult = await supabase
          .from('player_club_totals')
          .select(`
            player_id,
            club,
            apps_total,
            goals_total,
            mins_total,
            starts_total,
            players!inner (
              player_id,
              name,
              normalized_name,
              nationality
            )
          `)
          .eq('competition', 'EPL')
          .eq('club', cat.altClub)
          .gt('goals_total', 0);

        if (!altResult.error) {
          data = altResult.data;
        }
      }

      const playerIds = (data || []).map(r => r.player_id);
      let clubsMap = {};

      if (playerIds.length > 0) {
        const { data: allClubData } = await supabase
          .from('player_club_totals')
          .select('player_id, club')
          .eq('competition', 'EPL')
          .in('player_id', playerIds);

        (allClubData || []).forEach(r => {
          if (!clubsMap[r.player_id]) clubsMap[r.player_id] = [];
          if (!clubsMap[r.player_id].includes(r.club)) {
            clubsMap[r.player_id].push(r.club);
          }
        });
      }

      eligiblePlayers = (data || []).map(row => {
        const clubs = clubsMap[row.player_id] || [row.club];
        return {
          playerId: row.player_id,
          name: row.players.name,
          normalized: row.players.normalized_name || normalize(row.players.name),
          nationality: row.players.nationality,
          subtractValue: row.goals_total,
          overlay: {
            apps: row.apps_total,
            goals: row.goals_total,
            mins: row.mins_total,
            starts: row.starts_total,
            club: row.club,
          },
          clubs: clubs.slice(0, 5),
          clubCount: clubs.length,
        };
      });

      console.log('[match_start] Found', eligiblePlayers.length, 'players with goals for', clubToUse);
    }

    // ============================================================
    // OTHER: Players with 2+ or 3+ EPL clubs
    // ============================================================
    else if (categoryId === 'other_2clubs' || categoryId === 'other_3clubs') {
      const minClubs = categoryId === 'other_3clubs' ? 3 : 2;
      categoryName = `${minClubs}+ PL Clubs`;
      categoryFlag = '🔄';

      console.log('[match_start] Fetching players with', minClubs, '+ clubs');

      // Get all club records
      const { data: clubData, error: clubError } = await supabase
        .from('player_club_totals')
        .select(`
          player_id,
          club,
          apps_total,
          goals_total
        `)
        .eq('competition', 'EPL')
        .gt('apps_total', 0);

      if (clubError) {
        console.error('[match_start] Supabase error:', clubError);
        return respond(500, { error: clubError.message });
      }

      // Group by player_id and count clubs
      const playerClubs = {};
      const playerApps = {};
      const playerGoals = {};

      (clubData || []).forEach(r => {
        if (!playerClubs[r.player_id]) {
          playerClubs[r.player_id] = new Set();
          playerApps[r.player_id] = 0;
          playerGoals[r.player_id] = 0;
        }
        playerClubs[r.player_id].add(r.club);
        playerApps[r.player_id] += r.apps_total;
        playerGoals[r.player_id] += r.goals_total || 0;
      });

      // Filter players with minClubs+ clubs
      const qualifyingPlayerIds = Object.keys(playerClubs)
        .filter(pid => playerClubs[pid].size >= minClubs)
        .map(pid => parseInt(pid, 10));

      console.log('[match_start] Found', qualifyingPlayerIds.length, 'players with', minClubs, '+ clubs');

      if (qualifyingPlayerIds.length > 0) {
        // Get player details
        const { data: playerData, error: playerError } = await supabase
          .from('players')
          .select('player_id, name, normalized_name, nationality')
          .in('player_id', qualifyingPlayerIds);

        if (playerError) {
          console.error('[match_start] Supabase error:', playerError);
          return respond(500, { error: playerError.message });
        }

        eligiblePlayers = (playerData || []).map(p => {
          const clubs = Array.from(playerClubs[p.player_id] || []);
          return {
            playerId: p.player_id,
            name: p.name,
            normalized: p.normalized_name || normalize(p.name),
            nationality: p.nationality,
            subtractValue: playerApps[p.player_id] || 0,
            overlay: {
              apps: playerApps[p.player_id] || 0,
              goals: playerGoals[p.player_id] || 0,
            },
            clubs: clubs.slice(0, 5),
            clubCount: clubs.length,
          };
        });
      }

      console.log('[match_start] Returning', eligiblePlayers.length, 'eligible players');
    }

    // ============================================================
    // CONTINENTAL GROUPINGS (apps mode, multi-nationality filter)
    // ============================================================
    else if (categoryId && CONTINENT_CATEGORIES[categoryId]) {
      const cat = CONTINENT_CATEGORIES[categoryId];
      categoryName = cat.name;
      categoryFlag = cat.flag;

      console.log('[match_start] Fetching continental data for:', cat.name, 'with', cat.codes.length, 'nationality codes');

      // Get player competition totals for players matching any of the nationality codes
      const { data: pctData, error: pctError } = await supabase
        .from('player_competition_totals')
        .select(`
          player_id,
          apps_total,
          goals_total,
          mins_total,
          starts_total,
          players!inner (
            player_id,
            name,
            normalized_name,
            nationality
          )
        `)
        .eq('competition', 'EPL')
        .in('players.nationality', cat.codes)
        .gt('apps_total', 0);

      if (pctError) {
        console.error('[match_start] Supabase error:', pctError);
        return respond(500, { error: pctError.message });
      }

      // Get clubs for each player
      const playerIds = (pctData || []).map(r => r.player_id);
      let clubsMap = {};
      let seasonsMap = {};

      if (playerIds.length > 0) {
        const { data: clubData } = await supabase
          .from('player_club_totals')
          .select('player_id, club')
          .eq('competition', 'EPL')
          .in('player_id', playerIds);

        (clubData || []).forEach(r => {
          if (!clubsMap[r.player_id]) clubsMap[r.player_id] = [];
          if (!clubsMap[r.player_id].includes(r.club)) {
            clubsMap[r.player_id].push(r.club);
          }
        });

        const { data: seasonData } = await supabase
          .from('player_season_stats')
          .select('player_id, season')
          .eq('competition', 'EPL')
          .in('player_id', playerIds);

        const seasonSets = {};
        (seasonData || []).forEach(r => {
          if (!seasonSets[r.player_id]) seasonSets[r.player_id] = new Set();
          seasonSets[r.player_id].add(r.season);
        });
        for (const pid in seasonSets) {
          seasonsMap[pid] = seasonSets[pid].size;
        }
      }

      eligiblePlayers = (pctData || []).map(row => {
        const clubs = clubsMap[row.player_id] || [];
        return {
          playerId: row.player_id,
          name: row.players.name,
          normalized: row.players.normalized_name || normalize(row.players.name),
          nationality: row.players.nationality,
          subtractValue: row.apps_total,
          overlay: {
            apps: row.apps_total,
            goals: row.goals_total,
            mins: row.mins_total,
            starts: row.starts_total,
          },
          clubs: clubs.slice(0, 5),
          clubCount: clubs.length,
          seasonsCount: seasonsMap[row.player_id] || null,
        };
      });

      console.log('[match_start] Found', eligiblePlayers.length, 'players for continent', cat.name);
    }

    // ============================================================
    // UNKNOWN CATEGORY
    // ============================================================
    else {
      const allCategories = [
        ...Object.keys(COUNTRY_CATEGORIES),
        ...Object.keys(CONTINENT_CATEGORIES),
        ...Object.keys(CLUB_CATEGORIES),
        ...Object.keys(GOALS_CLUB_CATEGORIES),
        'goals_overall',
        'other_2clubs',
        'other_3clubs',
      ];
      return respond(400, {
        error: `Unknown categoryId: ${categoryId}`,
        available: allCategories,
      });
    }

    // ============================================================
    // FILTER & SORT
    // ============================================================
    eligiblePlayers = eligiblePlayers.filter(p => p.subtractValue > 0);
    eligiblePlayers.sort((a, b) => b.subtractValue - a.subtractValue);

    console.log('[match_start] Returning', eligiblePlayers.length, 'eligible players');

    // Warn if 0 players returned (possible DB mismatch)
    if (eligiblePlayers.length === 0) {
      console.warn('[match_start] WARNING: 0 players returned for categoryId:', categoryId, '- check DB values match');
    }

    return respond(200, {
      meta: {
        categoryId,
        categoryName,
        categoryFlag,
        competition: 'EPL',
        metric,
        metricLabel,
        eligibleCount: eligiblePlayers.length,
        datasetVersion,
        hintBlurb: HINTS[categoryId] || null,
        trivia: TRIVIA[categoryId] || [],
      },
      eligiblePlayers,
    });

  } catch (err) {
    console.error('[match_start] Error:', err);
    return respond(500, { error: err.message });
  }
};
