'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, KNOWLEDGE, readJson, writeJson } = require('./lib');

function decodeHtml(value) {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"', nbsp: ' ' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const radix = entity[1].toLowerCase() === 'x' ? 16 : 10;
      const digits = radix === 16 ? entity.slice(2) : entity.slice(1);
      return String.fromCodePoint(Number.parseInt(digits, radix));
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}

function plainText(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function extractRecipeCards(html) {
  const cards = [];
  const seen = new Set();
  const duplicates = [];
  const cardPattern = /<article class="card"\s+id="v-([A-Za-z0-9_-]{11})"([^>]*)>([\s\S]*?)<\/article>/g;
  for (const match of html.matchAll(cardPattern)) {
    const [, id, attrs, body] = match;
    const urlMatch = body.match(/href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/);
    if (!urlMatch) throw new Error(`${id}: recipe card has no canonical YouTube URL`);
    if (urlMatch[1] !== id) throw new Error(`${id}: card ID and YouTube video ID disagree (${urlMatch[1]})`);
    if (seen.has(id)) { duplicates.push(id); continue; }
    seen.add(id);

    const title = plainText(body.match(/<h3>([\s\S]*?)<\/h3>/)?.[1] || '');
    const publicationDate = attrs.match(/data-date="([^"]+)"/)?.[1] || body.match(/<time datetime="([^"]+)"/)?.[1] || null;
    const category = body.match(/<span class="tag [^"]+">([\s\S]*?)<\/span>/)?.[1];
    const ingredientsBlock = body.match(/<ul class="ing">([\s\S]*?)<\/ul>/)?.[1] || '';
    const ingredients = [...ingredientsBlock.matchAll(/<li(?: class="([^"]+)")?>([\s\S]*?)<\/li>/g)].map(item => ({
      original: plainText(item[2]),
      stage_heading: item[1] === 'sub',
    }));
    const stats = {};
    for (const stat of body.matchAll(/<span><b>(OG|FG|ABV)<\/b>\s*([^<]+)<\/span>/g)) {
      stats[stat[1].toLowerCase()] = plainText(stat[2]);
    }
    cards.push({
      video_id: id,
      title,
      creator: 'City Steading Brews',
      url: `https://www.youtube.com/watch?v=${id}`,
      publication_date: publicationDate,
      content_type: 'recipe',
      category: category ? plainText(category).toLowerCase() : null,
      recipe: {
        batch_size: null,
        ingredients,
        gravity: {
          original: stats.og || null,
          fermentation_final: stats.fg || null,
          after_backsweetening: null,
        },
        reported_abv: stats.abv || null,
        calculated: [],
      },
      source_record: {
        source: 'recipe_box_card',
        transcript_backed: false,
        timestamps_available: false,
        passage: plainText(body.match(/<h3>[\s\S]*?<\/h3>([\s\S]*?)<footer>/)?.[1] || ''),
      },
    });
  }
  return { cards, duplicates };
}

function main() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const { cards, duplicates } = extractRecipeCards(html);
  const pilot = readJson(path.join(KNOWLEDGE, 'videos', 'pilot.json'), { videos: [] });
  const reviewed = new Map((pilot.videos || []).map(video => [video.video_id, video]));
  const manifest = readJson(path.join(KNOWLEDGE, 'import-manifest.json'), { videos: {} });
  const retrievalDate = new Date().toISOString().slice(0, 10);
  const videos = cards.map(card => {
    const existing = reviewed.get(card.video_id);
    const transcript = manifest.videos?.[card.video_id]?.transcript || {};
    return {
      ...card,
      retrieval_date: retrievalDate,
      transcript_status: transcript.status || (existing ? 'available' : 'not_attempted'),
      transcript_source: existing?.transcript_source || transcript.source || null,
      transcript_failure: transcript.failure || null,
      timestamps_available: existing?.timestamps_available || transcript.timestamps || false,
      review_status: existing ? 'superseded_by_reviewed_pilot' : 'catalog_only_needs_transcript_review',
      findings: [],
      related_video_ids: [],
      visual_review_needed: ['Compare on-screen measurements and brewing stages with the transcript before review.'],
    };
  });
  writeJson(path.join(KNOWLEDGE, 'recipe-box-videos.json'), cards.map(({ video_id, title, url, publication_date, category }) => ({ video_id, title, url, publication_date, category })));
  writeJson(path.join(KNOWLEDGE, 'videos', 'recipe-box.json'), { schema_version: 1, extraction_version: '0.2.0', videos });
  console.log(`Synced ${cards.length} unique recipe-box videos (${reviewed.size} pilot records checked; ${duplicates.length} duplicates skipped).`);
}

if (require.main === module) main();
module.exports = { decodeHtml, extractRecipeCards };
