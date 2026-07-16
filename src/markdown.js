// Minimal markdown renderer for the docs page. Two layers:
//   parseMarkdown(text)  -> block AST     (pure — unit-tested headlessly)
//   renderMarkdownInto() -> DOM           (builds nodes; no innerHTML anywhere)
// Covers what this project's docs actually use: ATX headings, paragraphs,
// -/​* and 1. lists (flat), fenced code, | tables |, ---, and inline
// **bold** *italic* `code` [link](href).

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

const INLINE_RX = /(`[^`]+`)|(\*\*[^*]+?\*\*)|(\*[^*\s][^*]*?\*)|\[([^\]]+)\]\(([^)\s]+)\)/g;

// -> [{ t: 'text'|'code'|'bold'|'italic'|'link', s, href? }]
export function parseInline(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RX)) {
    if (m.index > last) out.push({ t: 'text', s: text.slice(last, m.index) });
    if (m[1]) out.push({ t: 'code', s: m[1].slice(1, -1) });
    else if (m[2]) out.push({ t: 'bold', s: m[2].slice(2, -2) });
    else if (m[3]) out.push({ t: 'italic', s: m[3].slice(1, -1) });
    else out.push({ t: 'link', s: m[4], href: m[5] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', s: text.slice(last) });
  return out;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const splitRow = (line) =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

const isSeparatorRow = (line) =>
  /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');

// -> [{ type, ... }] blocks:
//   heading{level,text} · para{text} · code{lang,text} · hr
//   list{ordered,items:[text]} · table{header:[..],rows:[[..]]}
export function parseMarkdown(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) { blocks.push({ type: 'para', text: para.join(' ') }); para = []; }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^```/.test(line)) {                                   // fenced code
      flush();
      const lang = line.slice(3).trim();
      const body = [];
      while (++i < lines.length && !/^```/.test(lines[i])) body.push(lines[i]);
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flush(); blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() }); continue; }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); blocks.push({ type: 'hr' }); continue; }

    if (/^\s*\|/.test(line)) {                                 // table
      flush();
      const header = splitRow(line);
      const rows = [];
      if (i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
        i++;
        while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) rows.push(splitRow(lines[++i]));
        blocks.push({ type: 'table', header, rows });
      } else {
        para.push(line.trim());                                // lone pipe line: prose
      }
      continue;
    }

    const li = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      flush();
      const ordered = /^\d/.test(li[1]);
      const items = [li[2]];
      while (i + 1 < lines.length) {
        const next = lines[i + 1].match(/^\s*([-*]|\d+\.)\s+(.*)$/);
        if (!next || /^\d/.test(next[1]) !== ordered) break;
        items.push(next[2]); i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (!line.trim()) { flush(); continue; }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

// ---------------------------------------------------------------------------
// DOM rendering (browser only)
// ---------------------------------------------------------------------------

function renderInlineInto(node, text, doc) {
  for (const tok of parseInline(text)) {
    if (tok.t === 'text') { node.appendChild(doc.createTextNode(tok.s)); continue; }
    if (tok.t === 'link') {
      const a = doc.createElement('a');
      const codeText = tok.s.match(/^`([^`]+)`$/); // [`file.md`](...) renders as code
      if (codeText) {
        const c = doc.createElement('code');
        c.textContent = codeText[1];
        a.appendChild(c);
      } else {
        a.textContent = tok.s;
      }
      a.href = tok.href;
      if (/^https?:/.test(tok.href)) { a.target = '_blank'; a.rel = 'noopener'; }
      node.appendChild(a);
      continue;
    }
    const tag = tok.t === 'bold' ? 'strong' : tok.t === 'italic' ? 'em' : 'code';
    const e = doc.createElement(tag);
    e.textContent = tok.s;
    node.appendChild(e);
  }
}

export function renderMarkdownInto(container, text, doc = document) {
  for (const b of parseMarkdown(text)) {
    if (b.type === 'heading') {
      const h = doc.createElement('h' + b.level);
      renderInlineInto(h, b.text, doc);
      // stable anchors so #fragment links survive re-renders
      h.id = b.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      container.appendChild(h);
    } else if (b.type === 'para') {
      const p = doc.createElement('p');
      renderInlineInto(p, b.text, doc);
      container.appendChild(p);
    } else if (b.type === 'code') {
      const pre = doc.createElement('pre');
      pre.className = 'md-code' + (b.lang ? ' lang-' + b.lang : '');
      pre.textContent = b.text;
      container.appendChild(pre);
    } else if (b.type === 'hr') {
      container.appendChild(doc.createElement('hr'));
    } else if (b.type === 'list') {
      const list = doc.createElement(b.ordered ? 'ol' : 'ul');
      for (const item of b.items) {
        const li = doc.createElement('li');
        renderInlineInto(li, item, doc);
        list.appendChild(li);
      }
      container.appendChild(list);
    } else if (b.type === 'table') {
      const t = doc.createElement('table');
      const thead = doc.createElement('thead');
      const hrow = doc.createElement('tr');
      for (const c of b.header) { const th = doc.createElement('th'); renderInlineInto(th, c, doc); hrow.appendChild(th); }
      thead.appendChild(hrow); t.appendChild(thead);
      const tbody = doc.createElement('tbody');
      for (const row of b.rows) {
        const tr = doc.createElement('tr');
        for (const c of row) { const td = doc.createElement('td'); renderInlineInto(td, c, doc); tr.appendChild(td); }
        tbody.appendChild(tr);
      }
      t.appendChild(tbody);
      container.appendChild(t);
    }
  }
}
