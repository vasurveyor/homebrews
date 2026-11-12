'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractRecipeCards } = require('../knowledge/scripts/sync-recipe-box');

test('extracts recipe cards and skips duplicate video IDs', () => {
  const card = id => `<article class="card" id="v-${id}" data-date="2024-01-02"><header><span class="tag t-mead">Mead</span></header><h3>A &amp; B</h3><div class="stats"><span><b>OG</b> 1.100</span></div><ul class="ing"><li>2 lbs honey</li></ul><footer><a href="https://www.youtube.com/watch?v=${id}">Watch</a></footer></article>`;
  const got = extractRecipeCards(card('abcdefghijk') + card('abcdefghijk'));
  assert.equal(got.cards.length, 1);
  assert.deepEqual(got.duplicates, ['abcdefghijk']);
  assert.equal(got.cards[0].title, 'A & B');
  assert.equal(got.cards[0].recipe.gravity.original, '1.100');
});

test('rejects a mismatched card and URL video ID', () => {
  const html = '<article class="card" id="v-abcdefghijk"><h3>Bad</h3><footer><a href="https://www.youtube.com/watch?v=lmnopqrstuv">Watch</a></footer></article>';
  assert.throws(() => extractRecipeCards(html), /disagree/);
});
