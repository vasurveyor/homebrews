'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('pilot knowledge passes traceability validation', () => {
  const run = spawnSync(process.execPath, ['knowledge/scripts/validate.js'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /Validated 10 videos/);
});

test('unsupported queries return insufficient evidence', () => {
  const run = spawnSync(process.execPath, ['knowledge/scripts/ask.js', 'What water chemistry profile should I use for a Czech pilsner?'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /Insufficient evidence/);
});

