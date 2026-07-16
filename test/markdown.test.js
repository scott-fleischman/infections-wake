import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMarkdown, parseInline } from '../src/markdown.js';

// ---------------------------------------------------------------------------
// inline
// ---------------------------------------------------------------------------

test('parseInline: plain text passes through', () => {
  assert.deepEqual(parseInline('hello world'), [{ t: 'text', s: 'hello world' }]);
});

test('parseInline: bold, italic, code, link', () => {
  const toks = parseInline('a **b** *c* `d` [e](f.md) g');
  assert.deepEqual(toks.map(t => t.t), ['text', 'bold', 'text', 'italic', 'text', 'code', 'text', 'link', 'text']);
  assert.equal(toks[1].s, 'b');
  assert.equal(toks[3].s, 'c');
  assert.equal(toks[5].s, 'd');
  assert.equal(toks[7].s, 'e');
  assert.equal(toks[7].href, 'f.md');
});

test('parseInline: backticked link text stays one link token', () => {
  const toks = parseInline('see [`Spec.md`](Spec.md) here');
  const link = toks.find(t => t.t === 'link');
  assert.equal(link.s, '`Spec.md`'); // renderer unwraps this into <a><code>
  assert.equal(link.href, 'Spec.md');
});

test('parseInline: bold is not eaten by italic', () => {
  const toks = parseInline('**strong** then *soft*');
  assert.equal(toks[0].t, 'bold');
  assert.equal(toks[0].s, 'strong');
  assert.equal(toks[2].t, 'italic');
});

// ---------------------------------------------------------------------------
// blocks
// ---------------------------------------------------------------------------

test('headings at all levels', () => {
  const b = parseMarkdown('# One\n### Three\n###### Six');
  assert.deepEqual(b.map(x => [x.type, x.level]), [['heading', 1], ['heading', 3], ['heading', 6]]);
  assert.equal(b[0].text, 'One');
});

test('paragraph lines join; blank line splits', () => {
  const b = parseMarkdown('line one\nline two\n\nnext para');
  assert.equal(b.length, 2);
  assert.equal(b[0].text, 'line one line two');
  assert.equal(b[1].text, 'next para');
});

test('unordered and ordered lists collect items and stay separate', () => {
  const b = parseMarkdown('- a\n- b\n1. x\n2. y');
  assert.equal(b.length, 2);
  assert.deepEqual(b[0], { type: 'list', ordered: false, items: ['a', 'b'] });
  assert.deepEqual(b[1], { type: 'list', ordered: true, items: ['x', 'y'] });
});

test('fenced code keeps language and body verbatim', () => {
  const b = parseMarkdown('```mermaid\ngraph TD\n  A --> B\n```');
  assert.equal(b.length, 1);
  assert.equal(b[0].type, 'code');
  assert.equal(b[0].lang, 'mermaid');
  assert.equal(b[0].text, 'graph TD\n  A --> B');
});

test('table with separator row parses header and rows', () => {
  const b = parseMarkdown('| Input | Action |\n| --- | --- |\n| WASD | Move |\n| LMB | Break |');
  assert.equal(b.length, 1);
  assert.deepEqual(b[0].header, ['Input', 'Action']);
  assert.deepEqual(b[0].rows, [['WASD', 'Move'], ['LMB', 'Break']]);
});

test('horizontal rule vs list dash', () => {
  const b = parseMarkdown('---\n- item');
  assert.equal(b[0].type, 'hr');
  assert.equal(b[1].type, 'list');
});

// ---------------------------------------------------------------------------
// the real documents parse without surprises
// ---------------------------------------------------------------------------

const KNOWN = new Set(['heading', 'para', 'code', 'hr', 'list', 'table']);

for (const file of ['README.md', 'Infections_Wake_Spec_v2_3D.md', 'Infections_Wake_All_Project_Input_Cleaned.md']) {
  test(`real doc parses: ${file}`, () => {
    const blocks = parseMarkdown(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
    assert.ok(blocks.length > 20, `expected substantial content, got ${blocks.length} blocks`);
    for (const b of blocks) assert.ok(KNOWN.has(b.type), `unknown block type ${b.type}`);
    assert.ok(blocks.some(b => b.type === 'heading' && b.level === 1), 'has an h1');
  });
}

test('README controls table survives round-trip', () => {
  const blocks = parseMarkdown(readFileSync(new URL('../README.md', import.meta.url), 'utf8'));
  const tables = blocks.filter(b => b.type === 'table');
  assert.ok(tables.length >= 2, 'README has controls + architecture tables');
  const controls = tables[0];
  assert.ok(controls.rows.some(r => r[0].includes('WASD')), 'controls table lists WASD');
});
