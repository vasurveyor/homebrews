'use strict';
const fs = require('fs');
const path = require('path');
const { KNOWLEDGE, timestamp, youtubeUrl, mergedKnowledgeVideos } = require('./lib');
const includeCatalog = process.argv.includes('--include-catalog');
const videos = mergedKnowledgeVideos().filter(video => includeCatalog || video.review_status !== 'catalog_only_needs_transcript_review');
const out = path.join(KNOWLEDGE, 'exports', 'obsidian');
fs.mkdirSync(out, { recursive: true });
for (const video of videos) {
  const lines = [`---`,`video_id: ${video.video_id}`,`creator: "${video.creator.replaceAll('"','\\"')}"`,`published: ${video.publication_date}`,`source: ${video.url}`,`review_status: ${video.review_status}`,`---`,``,`# ${video.title}`,``];
  if (video.recipe) {
    lines.push('## Recipe', '', `- Batch size: ${video.recipe.batch_size?.original || 'not stated'}`);
    for (const item of video.recipe.ingredients || []) lines.push(`${item.stage_heading ? '###' : '-'} ${item.original}${item.stage ? ` (${item.stage})` : ''}`);
    lines.push('');
  }
  if (video.review_status === 'catalog_only_needs_transcript_review') lines.push('> Catalog-only record. Recipe-box data is not yet a transcript-reviewed finding.', '');
  lines.push('## Findings', '');
  for (const finding of video.findings || []) {
    lines.push(`- **${finding.kind.replaceAll('_',' ')}:** ${finding.text}`);
    for (const ev of finding.evidence || []) lines.push(`  - [${timestamp(ev.start_seconds)}](${youtubeUrl(video.video_id, ev.start_seconds)}): ${ev.passage}`);
  }
  fs.writeFileSync(path.join(out, `${video.video_id}.md`), lines.join('\n') + '\n');
}
console.log(`Exported ${videos.length} deduplicated ${includeCatalog ? 'reviewed and catalog-only' : 'reviewed'} Markdown notes to ${path.relative(process.cwd(), out)}.`);

