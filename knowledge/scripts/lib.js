'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const KNOWLEDGE = path.join(ROOT, 'knowledge');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function timestamp(seconds) {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function youtubeUrl(id, seconds) {
  const base = `https://www.youtube.com/watch?v=${id}`;
  return Number.isFinite(seconds) ? `${base}&t=${Math.floor(seconds)}s` : base;
}

function allVideoRecords() {
  const dir = path.join(KNOWLEDGE, 'videos');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(x => x.endsWith('.json')).map(x => readJson(path.join(dir, x))).filter(Boolean);
}

module.exports = { ROOT, KNOWLEDGE, readJson, writeJson, timestamp, youtubeUrl, allVideoRecords };

