// Prose renderer. Chapters write plain strings; this turns them into DOM.
//
// Supported, deliberately small:
//   "paragraph"                       -> <p>
//   "> a quotation"                   -> <blockquote>
//   "— a caption"                     -> <p class="caption">
//   "## a heading"                    -> <h3 class="sub">   (h2 is the chapter title)
//   "- item"                          -> <ul><li>
//   "1. item"                         -> <ol><li>
//   "![](caption)" / "[[figure:..]]"   -> <figure> (chapters may append real DOM)
//   inline: **bold**, *em*, `code`, [text](url), ~sub~, ^sup^
//   "$ math $"                        -> <span class="math"> (styled, not typeset)

import { el } from './dom.js';

const escapeHtml = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\$([^$]+)\$/g, '<span class="math">$1</span>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~([^~]+)~/g, '<sub>$1</sub>');
  out = out.replace(/\^([^^]+)\^/g, '<sup>$1</sup>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  out = out.replace(/&quot;/g, '"');
  return out;
}

/** Render an array of prose strings into a fragment. */
export function renderProse(blocks) {
  const frag = document.createDocumentFragment();
  let list = null, listTag = null;

  const flush = () => { if (list) { frag.appendChild(list); list = null; listTag = null; } };

  for (const raw of blocks) {
    const line = String(raw);
    if (!line.trim()) { flush(); continue; }

    if (/^##\s+/.test(line)) {
      flush();
      frag.appendChild(el('h3.sub', { html: inline(line.replace(/^##\s+/, '')) }));
      continue;
    }
    if (/^-\s+/.test(line)) {
      if (listTag !== 'ul') { flush(); list = el('ul'); listTag = 'ul'; }
      list.appendChild(el('li', { html: inline(line.replace(/^-\s+/, '')) }));
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      if (listTag !== 'ol') { flush(); list = el('ol'); listTag = 'ol'; }
      list.appendChild(el('li', { html: inline(line.replace(/^\d+\.\s+/, '')) }));
      continue;
    }
    flush();
    if (/^>\s?/.test(line)) {
      frag.appendChild(el('blockquote', { html: inline(line.replace(/^>\s?/, '')) }));
    } else if (/^(—|--)\s/.test(line)) {
      frag.appendChild(el('p.caption', { html: inline(line.replace(/^(—|--)\s/, '')) }));
    } else if (/^\[\[figure:([^\]]+)\]\]$/.test(line)) {
      const m = line.match(/^\[\[figure:([^\]]+)\]\]$/);
      frag.appendChild(el('figure', {}, [el('figcaption', { html: inline(m[1]) })]));
    } else {
      frag.appendChild(el('p', { html: inline(line) }));
    }
  }
  flush();
  return frag;
}

/**
 * Turn a single line of author-written text into markup-safe HTML:
 * everything is escaped first, then a fixed set of inline tags is added.
 * This is the ONLY function that should feed innerHTML in this project.
 */
export function richText(text) {
  return inline(String(text ?? ''));
}

/** A pull-quote used to land a chapter's point. */
export function pullQuote(text) {
  return el('p.pull', { html: richText(text) });
}
