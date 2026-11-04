import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { inspectSlide } from '../lib/check.mjs';

// Supply deterministic DOM geometry without launching a browser. Browser integration
// below remains responsible for checking that real layout exposes the same metrics.
function scene() {
  const element = (tag, rect, styles = {}, text = '') => {
    const [left, top, width, height] = rect;
    const node = {
      tagName: tag.toUpperCase(), children: [], childNodes: text ? [{ nodeType: 3, textContent: text }] : [],
      style: { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible', backgroundImage: 'none', backgroundColor: 'rgba(0, 0, 0, 0)', color: 'rgb(255, 255, 255)', fontSize: '18px', ...styles },
      clientWidth: width, clientHeight: height, scrollWidth: width, scrollHeight: height,
      getBoundingClientRect: () => ({ left, top, right: left + width, bottom: top + height, width, height }),
      closest: () => null,
      querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]); },
      append(child) { this.children.push(child); this.childNodes.push(child); child.parentElement = this; return child; }
    };
    return node;
  };
  const body = element('body', [0, 0, 1280, 720]);
  const slide = body.append(element('section', [0, 0, 1280, 720], { backgroundColor: 'rgb(0, 0, 0)', overflowX: 'hidden', overflowY: 'hidden' }));
  const inspect = () => runInNewContext(`(${inspectSlide.toString()})(0, 14)`, { document: { body, querySelectorAll: () => [slide] }, getComputedStyle: node => node.style, Node: { TEXT_NODE: 3 } });
  return { element, slide, inspect };
}

test('labels outside a coloured bar use a containing background for contrast', () => {
  const { element, slide, inspect } = scene();
  const bar = slide.append(element('div', [100, 100, 100, 26], { backgroundColor: 'rgb(255, 100, 100)' }));
  const label = bar.append(element('em', [212, 104, 30, 18], { color: 'rgb(255, 100, 100)' }, '8'));
  assert.equal(inspect().filter(issue => issue.kind === 'contrast').length, 0);
  label.getBoundingClientRect = () => ({ left: 110, top: 104, right: 140, bottom: 122, width: 30, height: 18 });
  assert.equal(inspect().filter(issue => issue.kind === 'contrast').length, 1);
});

test('text clipped by an ancestor is reported even without its own scroll overflow', () => {
  for (const overflow of ['hidden', 'clip']) {
    const { element, slide, inspect } = scene();
    const device = slide.append(element('div', [20, 20, 200, 100], { overflowY: overflow }));
    device.append(element('span', [30, 105, 160, 30], {}, 'Replace with a capture'));
    const issues = inspect();
    assert.ok(issues.some(issue => issue.kind === 'clipping' && issue.message.startsWith('Text extends beyond a clipping ancestor')));
    assert.equal(issues.filter(issue => issue.kind === 'bounds').length, 0);
  }
});

test('visible overflow is allowed and gradients are skipped for contrast', () => {
  const { element, slide, inspect } = scene();
  const parent = slide.append(element('div', [20, 20, 100, 50], { backgroundImage: 'linear-gradient(red, blue)' }));
  parent.append(element('span', [30, 55, 160, 30], { color: 'rgb(20, 20, 20)' }, 'Visible caption'));
  assert.equal(inspect().length, 0);
});
