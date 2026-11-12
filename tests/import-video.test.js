'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractPlayerResponse, transcriptFromJson3 } = require('../knowledge/scripts/import-video');

test('extracts balanced player JSON without evaluating page scripts', () => {
  const html = '<script>var ytInitialPlayerResponse = {"videoDetails":{"title":"A } title"},"x":{"y":1}};</script>';
  assert.equal(extractPlayerResponse(html).videoDetails.title, 'A } title');
});

test('converts json3 captions to timed plain text', () => {
  const got = transcriptFromJson3({ events: [{ tStartMs: 1250, dDurationMs: 2000, segs: [{ utf8: 'hello' }, { utf8: ' world' }] }] });
  assert.deepEqual(got, [{ start_seconds: 1.25, duration_seconds: 2, text: 'hello world' }]);
});

