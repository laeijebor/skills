import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../lib/deck.mjs';
const wrap = (body, head = '') => `<!doctype html><html><head><title>Fallback &amp; title</title>${head}</head><body><main class="deck">${body}</main></body></html>`;
const errors = deck => deck.slides.flatMap(slide => slide.issues).filter(issue => issue.level === 'error');

test('parses the direct slide children, metadata, title priority, notes and asks', () => {
  const deck = parseDeck(wrap(`
    <section class="slide" id="start" data-title="Chosen title">
      <h1>Ignored heading</h1><aside class="notes">Read <b>this</b> &amp; that.</aside>
      <aside class="ask" data-options='["Keep (recommended)","Change"]' data-multiple data-answer="Keep">Which path?</aside>
      <div><section class="slide" id="nested">Not a slide</section></div>
    </section>
    <section class="slide" id="next"><h2>A <em>clear</em> finding</h2></section>
    <section class="slide" id="last"></section>`, '<meta name="deck:title" content="Deck title"><meta name="deck:size" content="a4">'));
  assert.equal(deck.title, 'Deck title');
  assert.deepEqual([deck.size, deck.width, deck.height], ['a4', 794, 1123]);
  assert.deepEqual(deck.slides.map(slide => slide.title), ['Chosen title', 'A clear finding', 'Slide 3']);
  assert.equal(deck.slides[0].notes, 'Read this & that.');
  assert.equal(deck.slides[0].notesCount, 1);
  assert.deepEqual(deck.slides[0].asks[0], { key: 'start-ask-1', question: 'Which path?', options: ['Keep (recommended)', 'Change'], multiple: true, answer: 'Keep' });
  assert.deepEqual(errors(deck), []);
});

test('missing ids warn; invalid, duplicate and fallback-colliding ids error', () => {
  const deck = parseDeck(wrap('<section class="slide"></section><section class="slide" id="slide-1"></section><section class="slide" id="bad id"></section>'));
  assert.equal(deck.slides[0].id, 'slide-1');
  assert.equal(deck.slides[0].issues[0].level, 'warning');
  assert.match(errors(deck)[0].message, /Duplicate/);
  assert.match(errors(deck)[1].message, /Invalid/);
  assert.equal(errors(parseDeck(wrap(`<section class="slide" id="${'a'.repeat(65)}"></section>`))).length, 1);
});

test('multiple notes and invalid deck sizes are errors', () => {
  const deck = parseDeck(wrap('<section class="slide" id="x"><aside class="notes">One</aside><aside class="notes">Two</aside></section>', '<meta name="deck:size" content="square">'));
  assert.deepEqual(errors(deck).map(issue => issue.kind), ['size', 'notes']);
});

test('asks validate keys, question lengths, JSON and option array limits', () => {
  const invalid = ['broken', '{}', '[]', '[1]', JSON.stringify(Array(51).fill('choice')), JSON.stringify(['a'.repeat(257)])];
  for (const value of invalid) {
    const deck = parseDeck(wrap(`<section class="slide" id="x"><aside class="ask" data-options='${value}'>Choose</aside></section>`));
    assert.ok(errors(deck).some(issue => issue.kind === 'ask'), value);
  }
  for (const attrs of ['data-key="bad key"', `data-key="${'x'.repeat(65)}"`]) {
    assert.ok(errors(parseDeck(wrap(`<section class="slide" id="x"><aside class="ask" ${attrs}>Choose</aside></section>`))).length);
  }
  for (const question of ['', 'x'.repeat(257)]) {
    assert.ok(errors(parseDeck(wrap(`<section class="slide" id="x"><aside class="ask">${question}</aside></section>`))).length);
  }
  const valid = parseDeck(wrap(`<section class="slide" id="x"><aside class="ask" data-options='${JSON.stringify(Array(50).fill('x'.repeat(256)))}'>${'x'.repeat(256)}</aside><aside class="ask">Free text</aside></section>`));
  assert.deepEqual(errors(valid), []);
  assert.equal(valid.slides[0].asks[1].key, 'x-ask-2');
  assert.equal(valid.slides[0].asks[1].options, undefined);
});

test('ask keys are unique throughout the deck', () => {
  const deck = parseDeck(wrap('<section class="slide" id="x"><aside class="ask" data-key="shared">First?</aside></section><section class="slide" id="y"><aside class="ask" data-key="shared">Second?</aside></section>'));
  assert.match(errors(deck)[0].message, /Duplicate ask key/);
});

test('comments and script contents cannot become slides; entities decode once', () => {
  const deck = parseDeck(wrap('<!-- <section class="slide" id="fake"></section> --><script>const sample = \'<section class="slide" id="fake2"></section>\';</script><section class="slide" id="actual"><h2>Use &amp;lt; once &#x2192; &quot;yes&quot;</h2></section>'));
  assert.equal(deck.slides.length, 1);
  assert.equal(deck.slides[0].title, 'Use &lt; once → "yes"');
  assert.equal(deck.title, 'Fallback & title');
  assert.deepEqual([deck.width, deck.height], [1280, 720]);
  assert.throws(() => parseDeck('<main class="deck"><div class="slide"></div></main>'), /No slides/);
});
