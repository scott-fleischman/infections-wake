// Tiny DOM builders — no innerHTML, all content set via textContent.

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// A label/value row. `value` may be a string or a Node.
export function row(label, value) {
  const r = el('div', 'row');
  r.appendChild(el('span', null, label));
  if (value instanceof Node) { const s = el('span'); s.appendChild(value); r.appendChild(s); }
  else r.appendChild(el('span', null, value));
  return r;
}

// A horizontal gauge; frac in [0,1].
export function gauge(frac, suffix) {
  const wrap = el('span');
  const g = el('span', 'gauge');
  const fill = el('div');
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  g.appendChild(fill);
  wrap.appendChild(g);
  if (suffix) wrap.appendChild(document.createTextNode(' ' + suffix));
  return wrap;
}

// Build a line of text where segments alternate plain / bold:
// line(["WASD", true], [" move · ", false], ...)
export function line(parent, segments) {
  const d = el('div');
  for (const [text, bold] of segments) d.appendChild(el(bold ? 'b' : 'span', null, text));
  parent.appendChild(d);
  return d;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
