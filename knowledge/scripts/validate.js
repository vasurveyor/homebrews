'use strict';
const fs = require('fs');
const path = require('path');
const { KNOWLEDGE } = require('./lib');

const file = path.join(KNOWLEDGE, 'videos', 'pilot.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const catalogFile = path.join(KNOWLEDGE, 'videos', 'recipe-box.json');
const catalog = fs.existsSync(catalogFile) ? JSON.parse(fs.readFileSync(catalogFile, 'utf8')) : { videos: [] };
const allowedKinds = new Set(['creator_advice', 'batch_result', 'ai_interpretation', 'calculation']);
const errors = [];
const ids = new Set();
for (const video of data.videos || []) {
  const where = video.video_id || '<missing id>';
  if (ids.has(where)) errors.push(`${where}: duplicate video_id`); else ids.add(where);
  for (const key of ['video_id','title','creator','url','publication_date','retrieval_date','transcript_source','review_status']) if (!video[key]) errors.push(`${where}: missing ${key}`);
  for (const finding of video.findings || []) {
    if (!allowedKinds.has(finding.kind)) errors.push(`${where}: invalid finding kind ${finding.kind}`);
    if (!finding.evidence?.length) errors.push(`${where}: finding lacks evidence`);
    for (const ev of finding.evidence || []) {
      if (!ev.passage) errors.push(`${where}: evidence lacks passage`);
      if (video.timestamps_available && ev.source === 'transcript' && !Number.isFinite(ev.start_seconds)) errors.push(`${where}: timestamped transcript evidence lacks start_seconds`);
    }
  }
  const g = video.recipe?.gravity;
  if (g && !Object.hasOwn(g, 'fermentation_final')) errors.push(`${where}: gravity must distinguish fermentation_final`);
  if (g && !Object.hasOwn(g, 'after_backsweetening')) errors.push(`${where}: gravity must distinguish after_backsweetening`);
}
const catalogIds = new Set();
for (const video of catalog.videos || []) {
  const where = video.video_id || '<missing catalog id>';
  if (catalogIds.has(where)) errors.push(`${where}: duplicate recipe-box video_id`); else catalogIds.add(where);
  for (const key of ['video_id','title','creator','url','publication_date','retrieval_date','review_status']) if (!video[key]) errors.push(`${where}: missing catalog ${key}`);
  if (video.findings?.length) errors.push(`${where}: catalog-only records must not contain unreviewed findings`);
  if (video.source_record?.transcript_backed !== false) errors.push(`${where}: recipe-box card source must remain non-transcript-backed`);
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Validated ${ids.size} reviewed videos, ${catalogIds.size} unique recipe-box videos, and ${data.videos.reduce((n,v)=>n+(v.findings?.length||0),0)} findings.`);

