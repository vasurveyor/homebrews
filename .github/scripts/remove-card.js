// CSB Recipe Box: remove a recipe card
// Usage: node .github/scripts/remove-card.js "<YouTube link, video ID, or words from the title>"
// Removes the matching card from index.html, updates the counts, and records the
// video in csb-seen.json so the weekly updater never adds it back.

'use strict';

const fs = require('fs');
const { refreshCounts } = require('./update-recipes.js');

const PAGE = 'index.html';
const SEEN_FILE = '.github/csb-seen.json';

const unesc = s => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();

function main() {
  const query = (process.argv[2] || '').trim();
  if (!query) throw new Error('Tell me which card to remove: a YouTube link, video ID, or words from the title.');
  let html = fs.readFileSync(PAGE, 'utf8');

  const cards = [...html.matchAll(/<article class="card" id="v-([\w-]+)"[\s\S]*?<\/article>\n?/g)].map(m => ({
    id: m[1], block: m[0], title: unesc((m[0].match(/<h3>([\s\S]*?)<\/h3>/) || [, ''])[1]),
  }));

  const idM = query.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/);
  const id = idM ? idM[1] : (/^[\w-]{11}$/.test(query) ? query : null);
  let hits = id ? cards.filter(c => c.id === id) : [];
  if (!hits.length) hits = cards.filter(c => norm(c.title).includes(norm(query)));

  if (!hits.length) throw new Error(`No card matches "${query}".`);
  if (hits.length > 1) throw new Error(`"${query}" matches ${hits.length} cards, be more specific:\n` + hits.map(c => `  ${c.id}  ${c.title}`).join('\n'));

  const card = hits[0];
  html = refreshCounts(html.replace(card.block, ''));
  fs.writeFileSync(PAGE, html);

  let seen = [];
  try { seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')); } catch {}
  if (!seen.includes(card.id)) seen.push(card.id);
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen.slice(-200), null, 1) + '\n');

  console.log(`Removed: ${card.title}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Removed: ${card.title}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `title=${card.title.replace(/\n/g, ' ')}\n`);
}

try { main(); } catch (e) { console.error(e.message); process.exit(1); }
