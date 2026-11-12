'use strict';
const { timestamp, youtubeUrl, mergedKnowledgeVideos } = require('./lib');

const query = process.argv.slice(2).join(' ').trim();
if (!query) { console.error('Usage: npm run knowledge:ask -- "your question"'); process.exit(2); }
const videos = mergedKnowledgeVideos();
const stop = new Set('a an and are about creator discuss does do how i in is it of on or recommend should the this to use what where which with'.split(' '));
let terms = [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) || [])].filter(x => x.length > 2 && !stop.has(x));
const q = query.toLowerCase();
if (/back.?sweet/.test(q)) terms.push('sweeten', 'stabil', 'pasteur');
if (/fermentation problem|troubleshoot/.test(q)) terms.push('sluggish', 'airlock', 'foam', 'stall');
terms = [...new Set(terms)];
const rows = [];
for (const video of videos) for (const finding of video.findings || []) {
  const hay = `${video.title} ${video.content_type} ${finding.text} ${(finding.evidence||[]).map(x=>x.passage).join(' ')}`.toLowerCase();
  const score = terms.reduce((n,t)=>n+(hay.includes(t)?1:0),0);
  if (score) rows.push({ score, video, finding });
}
rows.sort((a,b)=>b.score-a.score || a.video.publication_date.localeCompare(b.video.publication_date));
if (!terms.length || !rows.length || rows[0].score < Math.max(1, Math.ceil(terms.length * 0.25))) {
  console.log('Insufficient evidence: the reviewed collection does not contain a supported answer to that question.'); process.exit(0);
}
console.log(`# Evidence for: ${query}\n`);
for (const {video,finding} of rows.slice(0,6)) {
  console.log(`- **${finding.kind.replaceAll('_',' ')}:** ${finding.text}`);
  for (const ev of finding.evidence) {
    const label = Number.isFinite(ev.start_seconds) ? timestamp(ev.start_seconds) : 'description';
    console.log(`  - [${video.title} (${label})](${youtubeUrl(video.video_id, ev.start_seconds)}): “${ev.passage}”`);
  }
}
console.log('\nCreator advice is attributed to the creator and is not presented as a universal brewing rule.');

