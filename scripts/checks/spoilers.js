// Spoiler containment audit across every generated team page.
//   - no <details class="rec"> may be open by default
//   - no player name from a records table may appear in VISIBLE markup
//     outside those disclosures (the mystery-player pool inside <script>
//     is the one deliberate, pre-existing exception)
const fs = require('fs'), path = require('path');
const root = 'public/teams';
let pages = 0, open = 0, leaked = [], noDetails = [];

for (const slug of fs.readdirSync(root)) {
  const f = path.join(root, slug, 'index.html');
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  pages++;
  open += (s.match(/<details class="rec" open/g) || []).length;
  const dets = (s.match(/<details class="rec"/g) || []).length;
  if (!dets) { noDetails.push(slug); continue; }

  // everything that is NOT inside a <details> and NOT inside a <script>
  const visible = s.replace(/<details[\s\S]*?<\/details>/g, '')
                   .replace(/<script[\s\S]*?<\/script>/g, '');
  // Player names ONLY. In the third table ("Competitions and seasons") the
  // same td.who holds a COMPETITION, linked to /competitions/<slug>/ — and a
  // competition name is supposed to appear in visible markup, in the coverage
  // line and on the filter. Players are the unlinked cells.
  const names = [...s.matchAll(/<td class="who">(?!<a )([^<]+)</g)].map((m) => m[1].trim());
  for (const n of new Set(names)) if (n.length > 4 && visible.includes(n)) leaked.push(slug + ': ' + n);
}
console.log('pages audited          ' + pages);
console.log('open by default        ' + open);
console.log('without records        ' + noDetails.length + (noDetails.length ? ' (' + noDetails.slice(0,3) + ')' : ''));
console.log('names leaking          ' + leaked.length + (leaked.length ? '\n  ' + leaked.slice(0, 8).join('\n  ') : ''));
process.exit(open === 0 && leaked.length === 0 ? 0 : 1);
