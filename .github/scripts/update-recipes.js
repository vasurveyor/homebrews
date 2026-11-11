// CSB Recipe Box updater
// Checks the City Steading Brews YouTube feed for new videos and adds a recipe
// card to index.html for each new video whose description contains a recipe.
// Runs in GitHub Actions (Node 20+, no npm packages needed).
//
// How a video is handled:
//   1. The description is read from the feed AND from the video's watch page
//      (the watch page is the full, current description; the feed copy can be
//      stale or short). The longer of the two is used.
//   2. Claude (if ANTHROPIC_API_KEY is set) and then the rule-based parser look
//      for an ingredient list. If either finds one, a card is added.
//   3. If the description could not be read (network error), the video is NOT
//      marked as seen. It is flagged in .github/csb-flagged.json and retried on
//      the next run (up to MAX_ATTEMPTS).
//   4. If the description was read but no recipe was found, the video is marked
//      seen and listed in .github/csb-flagged.json so it can be checked by hand.

'use strict';

const CHANNEL_ID = 'UCqgnJOZ4ity3nQL_xe_hGYg';
const FEED_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + CHANNEL_ID;
const PAGE = 'index.html';
const SEEN_FILE = '.github/csb-seen.json';
const FLAG_FILE = '.github/csb-flagged.json';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const MAX_ATTEMPTS = 3;

const CATS = {
  mead: 'Mead', wine: 'Wine', cider: 'Cider', beer: 'Beer', other: 'Other & Hybrids',
};

// ---------------------------------------------------------------- parsing --

const URL_RE = /https?:\/\/\S+/g;
// Lines that mark the end of the recipe block.
const STOP_RE = /^(our pasteurization method|how we pasteurize|tools we use|equipment we use|city steading merch|merch|our favorite|we use the amazon|amazon affiliate|affiliate|support us|patreon|follow us|music|chapters?\b|time chapters?|timestamps|a few important notes?|important notes?|notes?:|have questions|thanks for watching|become a city steading|want more city steading|other recipes?|related videos?|links?:?$|#)/i;
const SUB_RE = /^(ingredients\s*[—–-]\s*(us|metric)[a-z ]*|ingredients\s*\((us|metric)[^)]*\)|(us|metric)( measurements?| units?)?|additions?|secondary|in secondary|backsweeten(ing)?|back sweeten(ing)?|to backsweeten|optional|nutrients?|(honey|sugar|fruit) additions?|for (the )?(secondary|primary|aging|priming|bottling|backsweetening)|primary|aging|at bottling|priming|flavou?ring|spices?|after fermentation|stabiliz(e|ing|ation))\s*:?$/i;

function cleanLine(s) {
  return s
    .replace(URL_RE, '')
    .replace(/\s*[:\-–—|]\s*$/, '')      // trailing ":" left after removing a link
    .replace(/\s*\((thanks|thank you)[^)]*\)/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  if (/after back ?sweeten|back ?sweeten(ed)? to|bottled at|sweetened gravity/.test(l)) { delete out.og; delete out.fg; }
  return out;
}

const QTY_RE = /\d|½|¼|¾|⅓|⅔|⅛|\b(packet|pinch|handful|dash|splash)\b/i;

function looksLikeIngredient(line) {
  if (!line || line.length > 160) return false;
  // Starts with a quantity or a quantity word: an ingredient, even if it is long.
  if (/^(\d|½|¼|¾|⅓|⅔|⅛|(a|an|one|two|three|four|half an?|approximately|approx\.?|about|roughly|additional|optional|a little over|a bit over|just under|enough)\b)/i.test(line)) return true;
  if (/[.!?]$/.test(line) && line.split(' ').length > 12) return false;  // prose sentence
  return true;
}

function isRecipeHeader(raw) {
  const s = raw.replace(URL_RE, '').trim();
  if (!s || s.length > 160) return false;
  if (/:\s*$/.test(raw.trim()) === false && URL_RE.test(raw)) { URL_RE.lastIndex = 0; return false; } // "Other Recipe: <link>"
  URL_RE.lastIndex = 0;
  if (/[.!?]$/.test(s) && s.split(' ').length > 8) return false;   // a sentence that mentions the recipe, not a heading
  return /\b(recipe|ingredients?)\b/i.test(s) && !/\b(link|links|full recipe (is )?(at|on|here)|recipe video|recipe here|recipes? (playlist|we)|our .* recipe video)\b/i.test(s);
}

// A line that states the batch size ("Batch size: A little over 1 US gallon ...",
// "Makes approximately 1 US gallon of mead before ...", "1 gallon batch").
function yieldText(line) {
  let m;
  if ((m = line.match(/^(?:batch size|yield|batch|makes about|this (?:made|makes))\s*:?\s*(.+)$/i)) && /\d|one|half/i.test(m[1])) {
    return 'Makes ' + m[1].split(/(?<=[.!?])\s+/)[0].replace(/[.!?]$/, '').replace(/^(approximately|about|roughly)\s+/i, 'approximately ').replace(/^A /, 'a ');
  }
  if (/^makes\b/i.test(line) && /\d/.test(line)) return line.split(/(?<=[.!?])\s+/)[0].replace(/[.!?]$/, '');
  if ((m = line.match(/^(\d+(\.\d+)?|one|half an?)\s*(us\s*)?(gallons?|liters?|litres?|l)(\s*batch)?$/i))) return 'Makes ' + line.replace(/^one/i, '1');
  return null;
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
  // Follow-up / troubleshooting / test videos aren't recipe cards unless the
  // description still carries an ingredient list (checked below), so the title
  // alone no longer rules a video out.
  const lines = (desc || '').replace(/\r/g, '').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isRecipeHeader(lines[i])) {
      // Must be followed (within 6 lines) by something with a quantity.
      const next = lines.slice(i + 1, i + 7).join(' ');
      if (QTY_RE.test(next)) { start = i; break; }
    }
  }
  if (start < 0) return null;

  const items = [];
  const stats = {};
  const header = lines[start].replace(URL_RE, '').trim();
  const yieldM = header.match(/\(([^)]*(gallon|liter|litre|\bL\b|batch)[^)]*)\)/i);
  if (yieldM) items.push({ text: yieldM[1].replace(/^this (made|makes)\s*/i, 'Makes ').replace(/\s*of finished \w+\.?$/i, '').replace(/\.$/, '') });

  let blank = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    const line = cleanLine(raw);
    if (!line) { blank++; if (blank >= 2 && items.filter(x => !x.sub).length >= 2) break; continue; }
    if (STOP_RE.test(line)) break;
    if (/^\(?\d{1,2}:\d{2}\b/.test(line)) break;                       // chapter list
    const st = statsFromLine(line);
    if (st && (/^(o\.?g|f\.?g|abv|s\.?g|original|starting|final|approx|estimated|ending|gravity|[01]\.\d{3})/i.test(line) || line.length < 60)) {
      Object.assign(stats, Object.fromEntries(Object.entries(st).filter(([k]) => !stats[k])));
      blank = 0;
      continue;
    }
    if (/^gravity after|^bottled at|sweetened gravity|^batch (information|info|details|stats)\b/i.test(line)) continue;
    const y = yieldText(line);
    if (y) {
      if (!items.some(x => /^makes\b/i.test(x.text))) items.unshift({ text: y });
      blank = 0;
      continue;
    }
    const real = items.filter(x => !x.sub);
    // A second heading ("DANDELION WINE RECIPE") before any ingredient is the
    // real start of the list; the earlier match was an intro line.
    if (!real.length && isRecipeHeader(raw)) { blank = 0; continue; }
    // A prose paragraph after the list means the recipe is over; a prose
    // sentence before it (an intro line under the header) is just skipped.
    if (blank && real.length && !looksLikeIngredient(line)) break;
    if (blank && real.length >= 2 && !QTY_RE.test(line) && !SUB_RE.test(line) && line.length > 50) break;
    blank = 0;
    if (!looksLikeIngredient(line)) { if (real.length) break; else continue; }
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

// A video's chapter list ("2:47 Why We Still Sanitize Everything") is not a recipe.
function looksLikeChapters(items) {
  const real = items.filter(x => !x.sub);
  return real.filter(x => /^\(?\d{1,2}:\d{2}/.test(x.text)).length >= real.length / 2;
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
- is_recipe is true whenever the description contains an ingredient list (with quantities) for a brew made in the video, even if the video is framed as a test, comparison or "was it worth it" video. It is false only when there is no ingredient list (e.g. Q&A, troubleshooting, tasting-only or follow-up videos).
- Copy ingredient lines as written in the description (quantities and units as given), minus links, affiliate notes and "thanks" asides. If a batch size is stated, make the first item "Makes <size>".
- Use {"text": "Additions", "sub": true} style entries only for sub-headings the description itself uses (Ingredients - US Measurements, Ingredients - Metric Measurements, Additions, Backsweetening, Secondary, ...).
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

// Claude first (if configured), then the rule parser. The rule parser also runs
// when Claude says "not a recipe", so a recipe that is plainly in the
// description is never dropped on one opinion.
async function findRecipe(title, desc) {
  let r = await parseWithClaude(title, desc);
  let via = 'Claude';
  if (r && looksLikeChapters(r.items)) r = null;
  if (!r) { r = parseRecipe(title, desc); via = 'rules'; }
  if (r && looksLikeChapters(r.items)) r = null;
  return { recipe: r, via };
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

// Insert the card in date order (newest first) within its section.
function insertCard(html, category, card) {
  const secAt = html.indexOf(`<section class="drink" id="${category}"`);
  if (secAt < 0) throw new Error('Section not found: ' + category);
  const gridTag = '<div class="grid">';
  const g = html.indexOf(gridTag, secAt);
  const gridStart = g + gridTag.length;
  const date = (card.match(/data-date="(\d{4}-\d{2}-\d{2})"/) || [])[1] || '9999';
  const secEnd = (() => { const n = html.indexOf('<section class="drink"', gridStart); const s = html.indexOf('<script', gridStart); return Math.min(...[n, s].filter(x => x >= 0)); })();
  // Walk the existing cards in this section and stop at the first one older than ours.
  const re = /<article class="card"[^>]*data-date="(\d{4}-\d{2}-\d{2})"/g;
  re.lastIndex = gridStart;
  let at = gridStart, m;
  while ((m = re.exec(html)) && m.index < secEnd) {
    if (m[1] <= date) { at = m.index; break; }
    at = html.indexOf('</article>', m.index) + '</article>'.length;
    re.lastIndex = at;
  }
  return html.slice(0, at) + card + html.slice(at);
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

// Read the video's watch page: the full description (from the player JSON) and
// the length in minutes. Returns null if the page could not be read.
async function fetchWatchPage(id, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch('https://www.youtube.com/watch?v=' + id + '&hl=en', {
        headers: { 'accept-language': 'en-US,en;q=0.9', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', cookie: 'CONSENT=YES+1' },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const t = await r.text();
      let desc = null;
      const dm = t.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
      if (dm) { try { desc = JSON.parse('"' + dm[1] + '"'); } catch { desc = null; } }
      const lm = t.match(/"lengthSeconds":"(\d+)"/) || t.match(/itemprop="duration" content="PT(\d+)M/);
      const minutes = lm ? (t.includes('"lengthSeconds"') ? Math.round(+lm[1] / 60) : +lm[1]) : null;
      if (desc === null && minutes === null) throw new Error('page had no player data');
      return { desc, minutes };
    } catch (e) {
      console.log(`  watch page for ${id} failed (try ${i}/${tries}): ${e.message}`);
      if (i < tries) await new Promise(res => setTimeout(res, 2000 * i));
    }
  }
  return null;
}

// ------------------------------------------------------------------- main --

function readJson(fs, file, dflt) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return dflt; } }

async function main() {
  const fs = require('fs');
  let html = fs.readFileSync(PAGE, 'utf8');
  const seen = readJson(fs, SEEN_FILE, []);
  let flagged = readJson(fs, FLAG_FILE, []);
  if (!Array.isArray(flagged)) flagged = [];

  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error('Feed fetch failed: ' + res.status);
  const feed = parseFeed(await res.text());
  console.log(`Feed has ${feed.length} videos.`);

  // Every feed video that is neither on the page nor marked seen is checked,
  // whatever its date, so a video missed once is not locked out by a newer card.
  const todo = feed
    .filter(v => v.id && !seen.includes(v.id) && !html.includes(`id="v-${v.id}"`))
    .sort((a, b) => a.published.localeCompare(b.published));
  if (!todo.length) { console.log('No new videos.'); return; }

  const added = [], noRecipe = [], unread = [];
  for (const v of todo) {
    console.log(`Checking: ${v.title} (${v.id}, ${v.date})`);
    const page = await fetchWatchPage(v.id);
    let desc = v.desc || '';
    if (page) {
      v.minutes = page.minutes;
      if (page.desc && page.desc.length > desc.length) desc = page.desc;
    }
    const { recipe, via } = await findRecipe(v.title, desc);

    if (recipe) {
      html = insertCard(html, recipe.category, buildCard(v, recipe));
      seen.push(v.id);
      flagged = flagged.filter(f => f.id !== v.id);
      added.push(v);
      console.log(`  Added [${recipe.category}] via ${via}: ${v.title} (${recipe.items.length} lines)`);
      continue;
    }

    const prev = flagged.find(f => f.id === v.id);
    const attempts = (prev ? prev.attempts : 0) + 1;
    const entry = { id: v.id, title: v.title, date: v.date, attempts, last: new Date().toISOString().slice(0, 10) };
    // GitHub's runners are often refused by YouTube's watch pages, so a failed
    // watch page only counts as "unread" when the feed copy is missing or short.
    if (!page && desc.length < 400 && attempts < MAX_ATTEMPTS) {
      // Could not read the full description: do not mark seen, retry next run.
      entry.reason = 'watch page could not be read; will retry';
      unread.push(v);
      console.log(`  Unread (watch page failed, attempt ${attempts}/${MAX_ATTEMPTS}); will retry next run: ${v.title}`);
    } else {
      entry.reason = page ? 'no ingredient list found in description; check by hand' : 'watch page not readable from GitHub; no ingredient list in the feed description; check by hand';
      seen.push(v.id);
      noRecipe.push(v);
      console.log(`  No recipe found: ${v.title}`);
    }
    flagged = [...flagged.filter(f => f.id !== v.id), entry];
  }
  if (added.length) {
    html = refreshCounts(html);
    fs.writeFileSync(PAGE, html);
  }
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen.slice(-200), null, 1) + '\n');
  fs.writeFileSync(FLAG_FILE, JSON.stringify(flagged.slice(-100), null, 1) + '\n');

  const summary = [
    added.length ? `Added: ${added.map(v => v.title).join('; ')}` : '',
    noRecipe.length ? `No recipe found (listed in ${FLAG_FILE}, check by hand): ${noRecipe.map(v => v.title).join('; ')}` : '',
    unread.length ? `Could not read description, will retry next run: ${unread.map(v => v.title).join('; ')}` : '',
  ].filter(Boolean).join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.replace(/\n/g, '\n\n') + '\n');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `added=${added.length}\ntitles=${added.map(v => v.title).join('; ').replace(/\n/g, ' ')}\n`);
}

if (typeof module !== 'undefined' && require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
if (typeof module !== 'undefined') module.exports = { parseRecipe, looksLikeChapters, parseFeed, buildCard, insertCard, refreshCounts, guessCategory, fetchWatchPage, findRecipe };
