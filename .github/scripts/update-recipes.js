// CSB Recipe Box updater
// Checks the City Steading Brews YouTube feed for new videos and adds a recipe
// card to index.html for each new video whose description contains a recipe.
// Runs in GitHub Actions (Node 20+, no npm packages needed).
//
// Optional: add a repository secret named ANTHROPIC_API_KEY and Claude will
// write the card from the description. Without it (or if the API call fails)
// a built-in rule-based parser is used.

'use strict';

const CHANNEL_ID = 'UCqgnJOZ4ity3nQL_xe_hGYg';
const FEED_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + CHANNEL_ID;
const PAGE = 'index.html';
const SEEN_FILE = '.github/csb-seen.json';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

const CATS = {
  mead: 'Mead', wine: 'Wine', cider: 'Cider', beer: 'Beer', other: 'Other & Hybrids',
};

// ---------------------------------------------------------------- parsing --

const URL_RE = /https?:\/\/\S+/g;
const STOP_RE = /^(tools we use|city steading merch|merch|our favorite|we use the amazon|amazon affiliate|affiliate|support us|patreon|follow us|music|chapters|timestamps|#)/i;
const SUB_RE = /^(additions?|secondary|in secondary|backsweeten(ing)?|back sweeten(ing)?|to backsweeten|optional|nutrients?|for (the )?(secondary|primary|aging|priming|bottling|backsweetening)|primary|aging|at bottling|priming|flavou?ring|spices?|after fermentation|stabiliz(e|ing|ation))\s*:?$/i;

function cleanLine(s) {
  return s
    .replace(URL_RE, '')
    .replace(/\s*[:\-–—|]\s*$/, '')      // trailing ":" left after removing a link
    .replace(/\s*\((thanks|thank you)[^)]*\)/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function num(s) { return s ? s.replace(/\s/g, '') : null; }

// Pull OG / FG / ABV out of a line. Returns null if the line isn't a stats line.
function statsFromLine(line) {
  const l = line.toLowerCase();
  const out = {};
  let m;
  if ((m = l.match(/(?:\bo\.?g\.?(?![a-z])|original gravity|starting gravity|start(?:ing)? sg|\bs\.?g\.?(?![a-z]))[^0-9]{0,15}([01]\.\d{3})/)) ||
      (m = l.match(/([01]\.\d{3})\s*(?:o\.?g\b|original gravity|starting gravity)/))) out.og = m[1];
  if ((m = l.match(/(?:\bf\.?g\.?(?![a-z])|final gravity|ending gravity|finished at)[^0-9]{0,15}([01]\.\d{3})/)) ||
      (m = l.match(/([01]\.\d{3})\s*(?:fg\b|final gravity)/))) out.fg = m[1];
  if (/abv|alcohol by volume|approximate alcohol|\balcohol\b/.test(l) && (m = l.match(/(\d{1,2}(?:\.\d{1,2})?)\s*%/))) out.abv = m[1];
  if (!Object.keys(out).length) return null;
  // Lines like "Gravity after backsweetening: 1.024" are not OG/FG.
  if (/after back ?sweeten|back ?sweeten(ed)? to|bottled at/.test(l)) { delete out.og; delete out.fg; }
  return out;
}

function looksLikeIngredient(line) {
  if (!line || line.length > 140) return false;
  if (/[.!?]$/.test(line) && line.split(' ').length > 12) return false;  // prose sentence
  return true;
}

function isRecipeHeader(raw) {
  const s = raw.replace(URL_RE, '').trim();
  if (!s || s.length > 160) return false;
  if (/:\s*$/.test(raw.trim()) === false && URL_RE.test(raw)) { URL_RE.lastIndex = 0; return false; } // "Other Recipe: <link>"
  URL_RE.lastIndex = 0;
  return /\b(recipe|ingredients?)\b/i.test(s) && !/\b(link|links|full recipe (is )?(at|on|here))\b/i.test(s);
}

function guessCategory(title, items) {
  const t = title.toLowerCase();
  const all = (title + ' ' + items.join(' ')).toLowerCase();
  if (/braggot|seltzer|ginger beer|kombucha|\bgrog\b|hybrid|jun\b|kvass|sake|mead ?\/ ?beer/.test(t)) return 'other';
  if (/\bmead|melomel|cyser|metheglin|pyment|acerglyn|honey ?wine|bochet|hydromel|sack mead/.test(t)) return 'mead';
  if (/\bcider|perry\b/.test(t)) return 'cider';
  if (/\bbeer|\bale\b|gruit|shandy|lager|stout|porter|\bipa\b|brew kit|wheat beer/.test(t)) return 'beer';
  if (/\bwine|kilju|skeeter pee|port\b/.test(t)) return 'wine';
  if (/honey/.test(all)) return 'mead';
  if (/apple juice|apple cider|pear juice/.test(all)) return 'cider';
  if (/malt|hops?\b|2-row|pilsner/.test(all)) return 'beer';
  return 'wine';
}

// Rule-based parser. Returns null when the description has no recipe.
function parseRecipe(title, desc) {
  // Follow-up / troubleshooting / test videos aren't recipe cards.
  if (/now what\?|mistake\?|\btested\b|q ?& ?a\b/i.test(title)) return null;
  const lines = desc.replace(/\r/g, '').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isRecipeHeader(lines[i])) {
      // Must be followed (within 3 lines) by something with a quantity.
      const next = lines.slice(i + 1, i + 4).join(' ');
      if (/\d|½|¼|¾|⅓|packet|pinch|handful/i.test(next)) { start = i; break; }
    }
  }
  if (start < 0) return null;

  const items = [];
  const stats = {};
  const header = lines[start].replace(URL_RE, '').trim();
  const yieldM = header.match(/\(([^)]*(gallon|liter|litre|\bL\b|batch)[^)]*)\)/i);
  if (yieldM) items.push({ text: yieldM[1].replace(/^this (made|makes)\s*/i, 'Makes ').replace(/\s*of finished \w+\.?$/i, '').replace(/\.$/, '') });
  // Header line may itself be "Ingredients: 1 gallon apple juice, ..." — ignore that edge case.

  let blank = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    const line = cleanLine(raw);
    if (!line) { blank++; if (blank >= 2 && items.length) break; continue; }
    if (STOP_RE.test(line)) break;
    const st = statsFromLine(line);
    if (st && (/^(o\.?g|f\.?g|abv|s\.?g|original|starting|final|approx|estimated|ending|gravity|[01]\.\d{3})/i.test(line) || line.length < 60)) {
      Object.assign(stats, Object.fromEntries(Object.entries(st).filter(([k]) => !stats[k])));
      blank = 0;
      continue;
    }
    if (/^gravity after|^bottled at|sweetened gravity|^batch (information|info|details|stats)\b/i.test(line)) continue;
    if (/^(\d+(\.\d+)?|one|half an?)\s*(us\s*)?gallons?(\s*batch)?$/i.test(line)) { items.push({ text: 'Makes ' + line.replace(/^one/i, '1') }); continue; }
    // After a blank line, a prose paragraph means the recipe is over.
    if (blank && !looksLikeIngredient(line)) break;
    if (blank && items.length >= 2 && !/\d|½|¼|¾|⅓/.test(line) && !SUB_RE.test(line) && line.length > 50) break;
    blank = 0;
    if (!looksLikeIngredient(line)) break;
    if (SUB_RE.test(line) || (!/https?:\/\//.test(raw) && /:$/.test(raw.trim()) && !/\d/.test(line) && line.length < 40)) {
      items.push({ text: line.replace(/:$/, ''), sub: true });
      continue;
    }
    items.push({ text: line });
  }
  // Drop a trailing sub-heading with nothing under it.
  while (items.length && items[items.length - 1].sub) items.pop();
  const real = items.filter(x => !x.sub);
  if (real.length < 2) return null;

  // Stats that appear elsewhere in the description (e.g. after the tools list).
  for (const l of lines) {
    const st = statsFromLine(cleanLine(l));
    if (st && cleanLine(l).length < 80) for (const k of Object.keys(st)) if (!stats[k]) stats[k] = st[k];
  }
  if (!stats.abv && stats.og && stats.fg) {
    const a = (parseFloat(stats.og) - parseFloat(stats.fg)) * 131.25;
    if (a > 0 && a < 25) stats.abv = String(Math.round(a * 10) / 10);
  }
  if (!stats.abv) { const m = title.match(/(\d{1,2}(?:\.\d)?)\s*%/); if (m) stats.abv = m[1]; }

  return {
    category: guessCategory(title, real.map(x => x.text)),
    og: stats.og || null, fg: stats.fg || null, abv: stats.abv || null,
    items,
  };
}

// ------------------------------------------------------------- Claude API --

async function parseWithClaude(title, desc) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return undefined;
  const prompt = `You turn City Steading Brews YouTube video descriptions into recipe cards.
Video title: ${title}

Description:
"""
${desc.replace(URL_RE, '').slice(0, 12000)}
"""

Reply with ONLY a JSON object, no other text:
{"is_recipe": true|false,
 "category": "mead"|"wine"|"cider"|"beer"|"other",
 "og": "1.xxx" or null, "fg": "x.xxx" or null, "abv": "number without %" or null,
 "items": [{"text": "ingredient line", "sub": false}, ...]}

Rules:
- is_recipe is false if the description has no ingredient list for a brew made in the video (e.g. yeast comparisons, Q&A, troubleshooting, tasting-only or follow-up videos).
- Copy ingredient lines as written in the description (quantities and units as given), minus links, affiliate notes and "thanks" asides. If a batch size is stated, make the first item "Makes <size>".
- Use {"text": "Additions", "sub": true} style entries only for sub-headings the description itself uses (Additions, Backsweetening, Secondary, ...).
- category: "other" for braggots, hard seltzers, ginger beer, kombucha, grog and hybrids; "mead" when honey is the main fermentable (including cysers, melomels, pyments); "cider" for apple/pear ciders; "beer" for malt/grain beers, gruits, shandy; "wine" for everything else (fruit/juice/sugar wines, kilju, skeeter pee).
- og/fg/abv only if stated in the description or the title; never invent them.`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) { console.log(`Claude API error ${r.status}: ${(await r.text()).slice(0, 300)} — using rule parser`); return undefined; }
    const j = await r.json();
    const text = (j.content || []).map(c => c.text || '').join('');
    const obj = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (!obj.is_recipe) return null;
    if (!CATS[obj.category] || !Array.isArray(obj.items) || obj.items.filter(x => !x.sub).length < 1) return undefined;
    return {
      category: obj.category,
      og: obj.og || null, fg: obj.fg || null, abv: obj.abv ? String(obj.abv).replace(/[~%\s]/g, '') : null,
      items: obj.items.map(x => ({ text: cleanLine(String(x.text)), sub: !!x.sub })).filter(x => x.text),
    };
  } catch (e) {
    console.log('Claude API call failed: ' + e.message + ' — using rule parser');
    return undefined;
  }
}

// ------------------------------------------------------------------- HTML --

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildCard(v, r) {
  const [y, mo, d] = v.date.split('-');
  const nice = `${MONTHS[+mo - 1]} ${+d}, ${y}`;
  const search = [v.title, ...r.items.filter(x => !x.sub).map(x => x.text)].join(' ').toLowerCase();
  const stats = [];
  if (r.og) stats.push(`<span><b>OG</b> ${esc(r.og)}</span>`);
  if (r.fg) stats.push(`<span><b>FG</b> ${esc(r.fg)}</span>`);
  if (r.abv) stats.push(`<span><b>ABV</b> ~${esc(r.abv)}%</span>`);
  const lis = r.items.map(x => x.sub ? `<li class="sub">${esc(x.text)}</li>` : `<li>${esc(x.text)}</li>`).join('');
  const len = v.minutes ? `<span>${v.minutes} min</span>` : '';
  return `<article class="card" id="v-${v.id}" data-date="${v.date}" data-s="${esc(search)}">
<header><span class="tag t-${r.category}">${esc(CATS[r.category])}</span><time datetime="${v.date}">${nice}</time></header>
<h3>${esc(v.title)}</h3>${stats.length ? `<div class="stats">${stats.join('')}</div>` : ''}<h4>Ingredients</h4><ul class="ing">${lis}</ul>
<footer><a class="watch" href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">Watch on YouTube${len}</a><span class="credit">Recipe: City Steading Brews</span></footer>
</article>`;
}

function insertCard(html, category, card) {
  const secAt = html.indexOf(`<section class="drink" id="${category}"`);
  if (secAt < 0) throw new Error('Section not found: ' + category);
  const gridTag = '<div class="grid">';
  const g = html.indexOf(gridTag, secAt);
  return html.slice(0, g + gridTag.length) + card + html.slice(g + gridTag.length);
}

// Recompute every count on the page from the cards themselves.
function refreshCounts(html) {
  const sections = [...html.matchAll(/<section class="drink" id="(\w+)"[\s\S]*?(?=<section class="drink"|<script)/g)];
  let total = 0, withIng = 0, minY = 9999, maxY = 0;
  for (const s of sections) {
    const k = s[1], body = s[0];
    const n = (body.match(/<article class="card"/g) || []).length;
    const ys = [...body.matchAll(/data-date="(\d{4})/g)].map(m => +m[1]);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    total += n; minY = Math.min(minY, lo); maxY = Math.max(maxY, hi);
    withIng += (body.match(/<ul class="ing">/g) || []).length;
    html = html.replace(new RegExp(`(<section class="drink" id="${k}"[^]*?<b class="shown">)\\d+(</b> recipes · )\\d{4}–\\d{4}`), `$1${n}$2${lo}–${hi}`);
    html = html.replace(new RegExp(`(data-f="${k}"[^>]*>[^]*?<span class="n">)\\d+(</span>)`), `$1${n}$2`);
  }
  html = html.replace(/(data-f="all"[^>]*>All<span class="n">)\d+/, `$1${total}`);
  html = html.replace(/<div><b>\d+<\/b>recipe videos<\/div>/, `<div><b>${total}</b>recipe videos</div>`);
  html = html.replace(/<div><b>\d+<\/b>with ingredient lists<\/div>/, `<div><b>${withIng}</b>with ingredient lists</div>`);
  html = html.replace(/<div><b>\d{4}–\d{4}<\/b>uploads<\/div>/, `<div><b>${minY}–${maxY}</b>uploads</div>`);
  html = html.replace(/'Showing '\+total\+' of \d+ recipes'/, `'Showing '+total+' of ${total} recipes'`);
  return html;
}

// ------------------------------------------------------------------- feed --

function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
}

function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
    const e = m[1];
    const get = re => { const x = e.match(re); return x ? decodeXml(x[1]) : ''; };
    const published = get(/<published>([^<]+)<\/published>/);
    // Upload date in US Eastern time (CSB's time zone).
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(published));
    return {
      id: get(/<yt:videoId>([^<]+)<\/yt:videoId>/),
      title: get(/<title>([^<]*)<\/title>/),
      published, date,
      desc: get(/<media:description>([\s\S]*?)<\/media:description>/),
    };
  });
}

async function videoMinutes(id) {
  try {
    const r = await fetch('https://www.youtube.com/watch?v=' + id, { headers: { 'accept-language': 'en-US,en;q=0.9', 'user-agent': 'Mozilla/5.0' } });
    const t = await r.text();
    const m = t.match(/"lengthSeconds":"(\d+)"/) || t.match(/itemprop="duration" content="PT(\d+)M/);
    if (!m) return null;
    return t.includes('"lengthSeconds"') ? Math.round(+m[1] / 60) : +m[1];
  } catch { return null; }
}

// ------------------------------------------------------------------- main --

async function main() {
  const fs = require('fs');
  let html = fs.readFileSync(PAGE, 'utf8');
  let seen = [];
  try { seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')); } catch {}

  const newest = [...html.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"/g)].map(m => m[1]).sort().pop();
  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error('Feed fetch failed: ' + res.status);
  const feed = parseFeed(await res.text());
  console.log(`Feed has ${feed.length} videos; newest card on the site is ${newest}.`);

  const todo = feed
    .filter(v => v.id && v.date >= newest && !seen.includes(v.id) && !html.includes(`id="v-${v.id}"`))
    .sort((a, b) => a.published.localeCompare(b.published));
  if (!todo.length) { console.log('No new videos.'); return; }

  const added = [], skipped = [];
  for (const v of todo) {
    let r = await parseWithClaude(v.title, v.desc);
    const via = r === undefined ? 'rules' : 'Claude';
    if (r === undefined) r = parseRecipe(v.title, v.desc);
    seen.push(v.id);
    if (!r) { skipped.push(v); console.log(`Skipped (no recipe in description): ${v.title}`); continue; }
    v.minutes = await videoMinutes(v.id);
    html = insertCard(html, r.category, buildCard(v, r));
    added.push(v);
    console.log(`Added [${r.category}] via ${via}: ${v.title} (${r.items.length} lines)`);
  }
  if (added.length) {
    html = refreshCounts(html);
    fs.writeFileSync(PAGE, html);
  }
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen.slice(-200), null, 1) + '\n');

  const summary = [
    added.length ? `Added: ${added.map(v => v.title).join('; ')}` : '',
    skipped.length ? `Skipped (no recipe): ${skipped.map(v => v.title).join('; ')}` : '',
  ].filter(Boolean).join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.replace(/\n/g, '\n\n') + '\n');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `added=${added.length}\ntitles=${added.map(v => v.title).join('; ').replace(/\n/g, ' ')}\n`);
}

if (typeof module !== 'undefined' && require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
if (typeof module !== 'undefined') module.exports = { parseRecipe, parseFeed, buildCard, insertCard, refreshCounts, guessCategory };
