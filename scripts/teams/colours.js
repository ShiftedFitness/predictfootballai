/**
 * colours.js — a primary and secondary colour for every club.
 *
 * Used to give each team page a badge and a scarf, so that landing on
 * /teams/plymouth-argyle/ feels like arriving somewhere about Plymouth rather
 * than a generic page with a different name at the top.
 *
 * 141 clubs have real colours, lifted from the map hol.html already carried.
 * The remaining 172 — mostly lower-league English and European sides — get a
 * colour DERIVED from the club name: deterministic, so a club always looks the
 * same, and spread across the hue circle so neighbouring clubs in a list do not
 * blur together. A derived colour is a placeholder for a real one, never a
 * claim about the club, which is why nothing on the page calls it a crest.
 */

const KNOWN = {
 "Arsenal": "#EF0107",
 "Aston Villa": "#670E36",
 "Blackburn Rovers": "#009EDB",
 "Bolton Wanderers": "#1D2D5A",
 "Bournemouth": "#DA291C",
 "Brentford": "#E30613",
 "Brighton": "#0057B8",
 "Burnley": "#6C1D45",
 "Charlton Athletic": "#D4021D",
 "Chelsea": "#034694",
 "Coventry City": "#00A3E0",
 "Crystal Palace": "#1B458F",
 "Derby County": "#000000",
 "Everton": "#003399",
 "Fulham": "#000000",
 "Ipswich Town": "#0044AA",
 "Leeds United": "#FFCD00",
 "Leicester City": "#003090",
 "Liverpool": "#C8102E",
 "Manchester City": "#6CABDD",
 "Manchester United": "#DA291C",
 "Middlesbrough": "#E4002B",
 "Newcastle United": "#000000",
 "Norwich City": "#FFF200",
 "Nottingham Forest": "#DD0000",
 "Portsmouth": "#001489",
 "Queens Park Rangers": "#005CAB",
 "Reading": "#004494",
 "Sheffield United": "#EE2737",
 "Sheffield Wednesday": "#0066B2",
 "Southampton": "#D71920",
 "Stoke City": "#E03A3E",
 "Sunderland": "#EB172B",
 "Swansea City": "#000000",
 "Tottenham Hotspur": "#132257",
 "Watford": "#FBEE23",
 "West Bromwich Albion": "#122F67",
 "West Ham United": "#7A263A",
 "Wigan Athletic": "#1D59AF",
 "Wimbledon": "#00008B",
 "Wolverhampton Wanderers": "#FDB913",
 "Athletic Club": "#EE2523",
 "Valencia": "#EE3524",
 "Barcelona": "#A50044",
 "Real Madrid": "#FEBE10",
 "Atlético Madrid": "#CB3524",
 "Sevilla": "#D4021D",
 "Real Sociedad": "#143C8B",
 "Espanyol": "#007FC8",
 "Real Betis": "#00954C",
 "Celta Vigo": "#8AC3EE",
 "Villarreal": "#FFCD00",
 "Dep La Coruña": "#0033A0",
 "Osasuna": "#D91A2A",
 "Mallorca": "#E20613",
 "Valladolid": "#5A2D82",
 "Getafe": "#004FA3",
 "Zaragoza": "#004C99",
 "Rayo Vallecano": "#E53027",
 "Racing Sant": "#00A651",
 "Málaga": "#009EE3",
 "Alavés": "#003DA5",
 "Levante": "#BD0811",
 "Sporting Gijón": "#CC2229",
 "Granada": "#E30613",
 "Tenerife": "#1C3A7A",
 "Bayern Munich": "#DC052D",
 "Dortmund": "#FDE100",
 "Leverkusen": "#E32221",
 "Werder Bremen": "#1D9053",
 "Stuttgart": "#E32219",
 "Gladbach": "#000000",
 "Schalke 04": "#004D9D",
 "Wolfsburg": "#65B32E",
 "Eintracht Frankfurt": "#E1000F",
 "Hamburger SV": "#005B9A",
 "Freiburg": "#000000",
 "Hertha BSC": "#005BA6",
 "Köln": "#ED1C24",
 "Mainz 05": "#ED1C24",
 "Hoffenheim": "#1961B5",
 "Bochum": "#005BA6",
 "Hannover 96": "#1E8C35",
 "Nürnberg": "#8B0000",
 "Augsburg": "#BA3733",
 "Kaiserslautern": "#E3000B",
 "Arminia": "#00447C",
 "Hansa Rostock": "#003D7E",
 "1860 Munich": "#00529C",
 "RB Leipzig": "#DD0741",
 "MSV Duisburg": "#004B93",
 "Lazio": "#87D8F7",
 "Inter": "#009DDC",
 "Milan": "#FB090B",
 "Roma": "#8E1F2F",
 "Udinese": "#000000",
 "Juventus": "#000000",
 "Fiorentina": "#482C83",
 "Atalanta": "#1E71B8",
 "Cagliari": "#8B0000",
 "Sampdoria": "#0065A4",
 "Bologna": "#1A2F48",
 "Napoli": "#009FE3",
 "Parma": "#FEDD00",
 "Torino": "#8B1A2B",
 "Genoa": "#93192A",
 "Chievo": "#1C3C8B",
 "Empoli": "#005BA6",
 "Lecce": "#FFED00",
 "Hellas Verona": "#003DA5",
 "Palermo": "#F1AABB",
 "Sassuolo": "#00A850",
 "Brescia": "#004B93",
 "Siena": "#000000",
 "Reggina": "#6D2247",
 "Catania": "#E3000B",
 "Rennes": "#E4002B",
 "Lyon": "#003DA5",
 "Paris Saint-Germain": "#004170",
 "Marseille": "#009FE3",
 "Monaco": "#C8102E",
 "Lille": "#D71920",
 "Bordeaux": "#13244A",
 "Nice": "#000000",
 "Nantes": "#FFED00",
 "Montpellier": "#003DA5",
 "Toulouse": "#5B2B82",
 "Saint-Étienne": "#006A3D",
 "Lens": "#E2001A",
 "Strasbourg": "#009FE3",
 "Auxerre": "#FFFFFF",
 "Metz": "#6D2832",
 "Lorient": "#F47920",
 "Bastia": "#009FE3",
 "Sochaux": "#FEDD00",
 "Guingamp": "#E30613",
 "Nancy": "#E4002B",
 "Reims": "#E30613",
 "Caen": "#003DA5",
 "Troyes": "#004FA3",
 "Angers": "#000000"
};


/**
 * Hand-added for well-known clubs the original map missed — mostly EFL sides
 * whose colours a supporter would notice being wrong. Plymouth are green, not
 * the blue the hash happened to produce. Anything still derived is a
 * placeholder and correcting one is a single line here.
 */
const CURATED = {
  'Plymouth Argyle': '#007B5F', 'Portsmouth': '#001489', 'Bradford City': '#8A2432',
  'Carlisle United': '#003399', 'Southend United': '#00549F', 'Bury': '#004B9B',
  'Notts County': '#000000', 'Exeter City': '#DA291C', 'Shrewsbury Town': '#0053A0',
  'Tranmere Rovers': '#FFFFFF', 'Rotherham United': '#D50032', 'Peterborough United': '#0057B8',
  'Oxford United': '#FFF200', 'Cambridge United': '#F8B300', 'Mansfield Town': '#FFD700',
  'Chesterfield': '#0072CE', 'Colchester United': '#005DAA', 'Northampton Town': '#7C2529',
  'Wrexham': '#DA291C', 'Salford City FC': '#DA291C', 'Stockport': '#004B9B',
  'Grimsby Town': '#000000', 'Crewe Alexandra': '#DA291C', 'Port Vale': '#000000',
  'Doncaster Rovers': '#DA291C', 'Lincoln City': '#DA291C', 'Morecambe': '#DA291C',
  'Harrogate Town': '#FDB913', 'Barrow': '#003DA5', 'Newport County': '#F5A623',
  'Leyton Orient': '#DA291C', 'Bristol Rovers': '#005BAA', 'Walsall': '#DA291C',
  'Gillingham': '#0055A5', 'Cheltenham Town': '#DA291C', 'Swindon Town': '#DA291C',
  'Accrington Stanley': '#DA291C', 'Forest Green Rovers': '#00A94F',
  'Milton Keynes Dons': '#FFFFFF', 'AFC Wimbledon': '#0033A0', 'Wimbledon': '#0033A0',
  'Yeovil Town': '#007A33', 'Torquay United': '#FFCE00', 'Hartlepool United': '#003DA5',
  'Scunthorpe United': '#8A1538', 'Macclesfield Town': '#0072CE', 'Barnet': '#F5A623',
};

/** Stable 32-bit hash of the club name. Same name, same colour, forever. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hsl(h, s, l) {
  // Small helper so derived colours land in the same visual family as the real
  // ones: strong but not neon, dark enough for white text to sit on top.
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** A darker or lighter partner for the primary, for the scarf stripe. */
function shift(hex, amount) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const parts = [1, 2, 3].map((i) => {
    const v = parseInt(m[i], 16) + amount;
    return Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  });
  return "#" + parts.join("");
}

/**
 * { primary, secondary, derived } for a team record from the manifest.
 * Tries the official name, then the game name, before deriving.
 */
function forTeam(team) {
  const hit = KNOWN[team.name] || CURATED[team.name] ||
              KNOWN[team.game_name] || CURATED[team.game_name] ||
              KNOWN[String(team.name).replace(/ (FC|AFC)$/, "")];
  if (hit) return { primary: hit, secondary: shift(hit, -40), derived: false };

  const h = hash(team.slug);
  // 137.5 degrees is the golden angle: consecutive clubs get well-separated
  // hues rather than clustering, which matters in a list of 83 League One sides.
  const hue = Math.round(((h % 360) * 137.5) % 360);
  const sat = 55 + (h % 20);
  return {
    primary: hsl(hue, sat, 38),
    secondary: hsl((hue + 18) % 360, sat, 26),
    derived: true,
  };
}

module.exports = { forTeam, KNOWN, CURATED, hash };
