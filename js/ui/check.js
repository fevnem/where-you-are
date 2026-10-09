// "Your turn" checks. A chapter can ask the reader to commit to an answer, then
// explain. Nothing is scored or hidden: the point is the moment of choosing.

import { el } from './dom.js';
import { richText } from './prose.js';

/**
 * spec: { q, options: [..], answer: index, why: 'explanation shown after choosing',
 *         hint: 'optional nudge before choosing' }
 * Returns { node }.
 */
export function createCheck(spec) {
  const node = el('div.check', { dataset: { check: spec.id ?? '' } });
  node.appendChild(el('p.check-q', { html: richText(spec.q) }));

  const body = el('div.check-options');
  const why = el('p.check-why', { hidden: true });
  let chosen = false;

  spec.options.forEach((opt, i) => {
    const btn = el('button.option', { type: 'button' }, [el('span.option-mark', { text: String.fromCharCode(65 + i) }), el('span.option-text', { html: richText(opt) })]);
    btn.addEventListener('click', () => {
      if (chosen) return;
      chosen = true;
      const right = i === spec.answer;
      btn.classList.add(right ? 'is-right' : 'is-wrong');
      body.querySelectorAll('.option').forEach((b, j) => {
        b.disabled = true;
        if (j === spec.answer) b.classList.add('is-right');
      });
      why.hidden = false;
      why.classList.add(right ? 'is-right' : 'is-wrong');
      // richText escapes the text before adding the few tags we allow, so
      // chapter prose cannot inject markup.
      why.innerHTML = (right ? '<strong>Yes.</strong> ' : '<strong>Not quite.</strong> ') + richText(spec.why);
      node.classList.add('is-answered', right ? 'was-right' : 'was-wrong');
    });
    body.appendChild(btn);
  });

  node.appendChild(body);
  if (spec.hint) node.appendChild(el('p.hint', { html: richText(spec.hint) }));
  node.appendChild(why);
  return { node, spec, answered: () => chosen };
}
