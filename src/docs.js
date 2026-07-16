import { renderMarkdownInto } from './markdown.js';

// The field manual: an index of the project's real documents, rendered
// client-side. Markdown is bundled as lazy raw-text chunks so the reader
// works on the static GitHub Pages deploy with no server help.
const DOCS = {
  readme: {
    tag: 'FIELD GUIDE',
    title: 'How to run, play, and survive',
    load: () => import('../README.md?raw'),
  },
  spec: {
    tag: 'DESIGN RECORD',
    title: "Infection's Wake — Spec v2 (3D)",
    load: () => import('../Infections_Wake_Spec_v2_3D.md?raw'),
  },
  input: {
    tag: 'PROJECT INPUT',
    title: 'Original concept & development notes',
    load: () => import('../Infections_Wake_All_Project_Input_Cleaned.md?raw'),
  },
};

const $ = (id) => document.getElementById(id);
const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

function currentKey() {
  const key = location.hash.replace(/^#/, '').split('/')[0];
  return DOCS[key] ? key : 'readme';
}

function buildIndex() {
  const nav = $('d-index');
  clear(nav);
  for (const [key, d] of Object.entries(DOCS)) {
    const a = document.createElement('a');
    a.href = '#' + key;
    a.dataset.key = key;
    const tag = document.createElement('span');
    tag.className = 'd-doc-tag';
    tag.textContent = d.tag;
    a.appendChild(tag);
    a.appendChild(document.createTextNode(d.title));
    nav.appendChild(a);
  }
}

// Links between the markdown files become in-app doc switches.
function rewriteDocLinks(container) {
  const byFile = {
    'README.md': 'readme',
    'Infections_Wake_Spec_v2_3D.md': 'spec',
    'Infections_Wake_All_Project_Input_Cleaned.md': 'input',
  };
  for (const a of container.querySelectorAll('a')) {
    const href = a.getAttribute('href') || '';
    const file = href.split('#')[0].split('/').pop();
    if (byFile[file]) {
      a.href = '#' + byFile[file];
      a.removeAttribute('target');
    }
  }
}

let loadSeq = 0;

async function show(key) {
  const seq = ++loadSeq; // stale loads must not clobber a newer selection
  for (const a of $('d-index').children) a.classList.toggle('active', a.dataset.key === key);
  const doc = $('d-doc');
  clear(doc);
  const loading = document.createElement('div');
  loading.className = 'd-loading';
  loading.textContent = 'Recovering document…';
  doc.appendChild(loading);
  let text;
  try {
    text = (await DOCS[key].load()).default;
  } catch {
    if (seq !== loadSeq) return;
    clear(doc);
    const err = document.createElement('div');
    err.className = 'd-loading';
    err.textContent = 'Document recovery failed — check your connection and ';
    const retry = document.createElement('a');
    retry.textContent = 'try again';
    retry.href = '#' + key;
    retry.addEventListener('click', () => show(key));
    err.appendChild(retry);
    err.appendChild(document.createTextNode('.'));
    doc.appendChild(err);
    return;
  }
  if (seq !== loadSeq) return;
  clear(doc);
  renderMarkdownInto(doc, text);
  rewriteDocLinks(doc);
  $('d-main').scrollTop = 0;
}

buildIndex();
show(currentKey());
window.addEventListener('hashchange', () => show(currentKey()));
