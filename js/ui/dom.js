// Tiny element helper. Everything in the page is built with this — no innerHTML
// for author-written text, so a chapter's prose can never inject markup.

export function el(spec, props = {}, children = []) {
  const parts = String(spec).split('.');
  const node = document.createElement(parts[0] || 'div');
  for (const cls of parts.slice(1)) if (cls) node.classList.add(cls);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'text') node.textContent = String(v);
    // 'html' is an escape hatch for markup this project generated itself
    // (see prose.richText, which escapes author text before adding tags).
    // Never pass raw chapter strings here.
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'class') node.className = String(v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Clamp + format helpers used across the readouts. */
export const fmt = (v, digits = 0) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
