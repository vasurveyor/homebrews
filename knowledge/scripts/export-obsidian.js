'use strict';
const fs = require('fs');
const path = require('path');
const { KNOWLEDGE, timestamp, youtubeUrl } = require('./lib');
const data = JSON.parse(fs.readFileSync(path.join(KNOWLEDGE, 'videos', 'pilot.json'), 'utf8'));
const out = path.join(KNOWLEDGE, 'exports', 'obsidian');
fs.mkdirSync(out, { recursive: true });
for (const video of data.videos) {
  const lines = [`---`,`video_id: ${video.video_id}`,`creator: "${video.creator.replaceAll('"','\\"')}"`,`published: ${video.publication_date}`,`source: ${video.url}`,`review_status: ${video.review_status}`,`---`,``,`# ${video.title}`,``];
  if (video.recipe) {
    lines.push('## Recipe', '', `- Batch size: ${video.recipe.batch_size?.original || 'not stated'}`);
    for (const item of video.recipe.ingredients || []) lines.push(`- ${item.original}${item.stage ? ` (${item.stage})` : ''}`);
    lines.push('');
  }
  lines.push('## Findings', '');
  for (const finding of video.findings || []) {
    lines.push(`- **${finding.kind.replaceAll('_',' ')}:** ${finding.text}`);
    for (const ev of finding.evidence || []) lines.push(`  - [${timestamp(ev.start_seconds)}](${youtubeUrl(video.video_id, ev.start_seconds)}): ${ev.passage}`);
  }
  fs.writeFileSync(path.join(out, `${video.video_id}.md`), lines.join('\n') + '\n');
}
console.log(`Exported ${data.videos.length} Markdown notes to ${path.relative(process.cwd(), out)}.`);

