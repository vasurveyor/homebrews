'use strict';

const fs = require('fs');
const path = require('path');
const { KNOWLEDGE, readJson, writeJson } = require('./lib');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

function decodeHtml(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function extractPlayerResponse(html) {
  const marker = 'var ytInitialPlayerResponse = ';
  let at = html.indexOf(marker);
  if (at < 0) {
    const alt = 'ytInitialPlayerResponse = ';
    at = html.indexOf(alt);
    if (at < 0) throw new Error('watch page had no player response');
    at += alt.length;
  } else at += marker.length;
  const start = html.indexOf('{', at);
  let depth = 0, string = false, escape = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (string) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') string = false;
    } else if (c === '"') string = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error('player response JSON was incomplete');
}

function transcriptFromJson3(data) {
  const out = [];
  for (const event of data.events || []) {
    const text = (event.segs || []).map(x => x.utf8 || '').join('').replace(/\n/g, ' ').trim();
    if (!text) continue;
    out.push({ start_seconds: (event.tStartMs || 0) / 1000, duration_seconds: (event.dDurationMs || 0) / 1000, text });
  }
  return out;
}

async function fetchOne(id) {
  const watchUrl = `https://www.youtube.com/watch?v=${id}&hl=en`;
  const res = await fetch(watchUrl, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', cookie: 'CONSENT=YES+1' } });
  if (!res.ok) throw new Error(`watch page HTTP ${res.status}`);
  const player = extractPlayerResponse(await res.text());
  const details = player.videoDetails || {};
  const micro = player.microformat?.playerMicroformatRenderer || {};
  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const preferred = tracks.find(x => x.languageCode === 'en' && x.kind !== 'asr') || tracks.find(x => x.languageCode === 'en') || tracks[0];
  const record = {
    video_id: id,
    title: details.title || null,
    creator: details.author || null,
    url: `https://www.youtube.com/watch?v=${id}`,
    publication_date: micro.publishDate || micro.uploadDate || null,
    retrieval_date: new Date().toISOString(),
    description: details.shortDescription || null,
    transcript: { status: 'unavailable', source: null, language: null, is_auto_generated: null, timestamps: false, failure: null }
  };
  if (!preferred) {
    record.transcript.failure = 'No caption track advertised by the watch page.';
    return { record, segments: null };
  }
  const cap = await fetch(preferred.baseUrl + '&fmt=json3', { headers: { 'user-agent': UA, referer: watchUrl } });
  if (!cap.ok) {
    record.transcript.failure = `Caption track request returned HTTP ${cap.status}.`;
    return { record, segments: null };
  }
  const captionBody = await cap.text();
  if (!captionBody.trim()) {
    record.transcript.failure = 'Caption track returned an empty response.';
    return { record, segments: null };
  }
  let captionJson;
  try { captionJson = JSON.parse(captionBody); }
  catch { throw new Error(`Caption response was not JSON (${captionBody.slice(0, 80).replace(/\s+/g, ' ')})`); }
  const segments = transcriptFromJson3(captionJson);
  if (!segments.length) {
    record.transcript.failure = 'Caption track returned no timed text.';
    return { record, segments: null };
  }
  record.transcript = {
    status: 'available', source: preferred.kind === 'asr' ? 'youtube_auto_captions' : 'youtube_creator_captions',
    language: preferred.languageCode || null, is_auto_generated: preferred.kind === 'asr', timestamps: true, failure: null
  };
  return { record, segments };
}

function manualImport(id, file) {
  const text = fs.readFileSync(file, 'utf8');
  return {
    record: { video_id: id, title: null, creator: null, url: `https://www.youtube.com/watch?v=${id}`, publication_date: null,
      retrieval_date: new Date().toISOString(), description: null,
      transcript: { status: 'available', source: 'manual_import', language: null, is_auto_generated: null, timestamps: false, failure: null } },
    segments: [{ start_seconds: null, duration_seconds: null, text }]
  };
}

async function main() {
  const args = process.argv.slice(2);
  const manualAt = args.indexOf('--manual');
  const manualFile = manualAt >= 0 ? args[manualAt + 1] : null;
  const requested = args.filter((x, i) => !x.startsWith('--') && (manualAt < 0 || i !== manualAt + 1));
  const pilot = readJson(path.join(KNOWLEDGE, 'pilot-videos.json'), []);
  const ids = requested.length ? requested : pilot.map(x => x.video_id);
  const manifestFile = path.join(KNOWLEDGE, 'import-manifest.json');
  const manifest = readJson(manifestFile, { schema_version: 1, extraction_version: '0.1.0', videos: {} });
  let failed = 0;
  for (const id of ids) {
    try {
      const result = manualFile ? manualImport(id, manualFile) : await fetchOne(id);
      const transcriptFile = path.join(KNOWLEDGE, 'private', 'transcripts', `${id}.json`);
      if (result.segments) writeJson(transcriptFile, { video_id: id, source: result.record.transcript.source, segments: result.segments });
      const old = manifest.videos[id] || {};
      manifest.videos[id] = { ...old, ...result.record, attempts: (old.attempts || 0) + 1,
        review_status: old.review_status || 'not_reviewed', extraction_version: manifest.extraction_version };
      console.log(`${id}: ${result.record.transcript.status} (${result.record.transcript.source || result.record.transcript.failure})`);
      if (result.record.transcript.status !== 'available') failed++;
    } catch (error) {
      const old = manifest.videos[id] || {};
      manifest.videos[id] = { ...old, video_id: id, url: `https://www.youtube.com/watch?v=${id}`, retrieval_date: new Date().toISOString(),
        attempts: (old.attempts || 0) + 1, review_status: old.review_status || 'not_reviewed', extraction_version: manifest.extraction_version,
        transcript: { status: 'failed', source: null, timestamps: false, failure: error.message } };
      failed++;
      console.error(`${id}: failed (${error.message})`);
    }
  }
  writeJson(manifestFile, manifest);
  if (failed) process.exitCode = 2;
}

if (require.main === module) main();
module.exports = { extractPlayerResponse, transcriptFromJson3 };

