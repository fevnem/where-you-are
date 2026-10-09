// Declarative controls. A chapter declares what the reader may turn; this builds
// the widgets, keeps a reactive `params` object, and fires change callbacks.

import { el } from './dom.js';

/**
 * Control spec (all optional except id/label):
 *   { id, type: 'range'|'toggle'|'select'|'button', label, min, max, step, value,
 *     unit, hint, options: [{value,label}], format: (v) => string }
 *
 * Returns { node, params, set(id, value), get(id), onChange(fn), values() }
 */
export function createControls(specs, onAny) {
  const params = {};
  const inputs = new Map();
  const readouts = new Map();
  const node = el('div.controls');

  const listener = () => { /* replaced below */ };
  const fire = (id, value) => {
    params[id] = value;
    const r = readouts.get(id);
    const spec = specs.find((s) => s.id === id);
    if (r && spec && spec.format) r.textContent = spec.format(value, params);
    if (onAny) onAny(id, value, params);
    listener(id, value, params);
  };

  let changeFn = null;
  const api = {
    node,
    params,
    get: (id) => params[id],
    set(id, value) { const i = inputs.get(id); if (i) { i.value = value; } fire(id, value); },
    values: () => ({ ...params }),
    onChange(fn) { changeFn = fn; return api; }
  };
  const bridge = (id, value, p) => { if (changeFn) changeFn(id, value, p); };
  Object.assign(listener, { call: bridge });
  const dispatch = (id, value, p) => { if (changeFn) changeFn(id, value, p); };
  // simple indirection so `fire` can call the latest handler
  const callHandlers = (id, value, p) => { if (changeFn) changeFn(id, value, p); };

  for (const spec of specs) {
    params[spec.id] = spec.value ?? (spec.type === 'toggle' ? false : 0);
    const row = el('div.control', { dataset: { control: spec.id } });
    const head = el('div.control-head', {}, [
      el('label.control-label', { for: 'c-' + spec.id, text: spec.label }),
      el('output.control-value', {})
    ]);
    const out = head.querySelector('.control-value');
    readouts.set(spec.id, out);
    out.textContent = spec.format ? spec.format(params[spec.id], params) :
      `${params[spec.id]}${spec.unit ? ' ' + spec.unit : ''}`;

    let input;
    if (spec.type === 'toggle') {
      input = el('input', { type: 'checkbox', id: 'c-' + spec.id, checked: !!params[spec.id], role: 'switch' });
      input.addEventListener('change', () => fire(spec.id, input.checked));
    } else if (spec.type === 'select') {
      input = el('select', { id: 'c-' + spec.id });
      for (const o of spec.options) input.appendChild(el('option', { value: String(o.value), text: o.label }));
      input.value = String(params[spec.id]);
      input.addEventListener('change', () => fire(spec.id, input.value));
    } else if (spec.type === 'button') {
      input = el('button.btn', { id: 'c-' + spec.id, type: 'button', text: spec.label });
      input.addEventListener('click', () => fire(spec.id, Date.now()));
      head.removeChild(head.querySelector('.control-value'));
      row.appendChild(input);
      inputs.set(spec.id, input);
      row.appendChild(el('div.control-body', {}, []));
      if (spec.hint) row.appendChild(el('p.hint', { text: spec.hint }));
      node.appendChild(row);
      continue;
    } else {
      input = el('input', {
        type: 'range', id: 'c-' + spec.id,
        min: spec.min, max: spec.max, step: spec.step ?? 0.01, value: params[spec.id]
      });
      input.addEventListener('input', () => fire(spec.id, Number(input.value)));
    }
    inputs.set(spec.id, input);
    row.appendChild(head);
    row.appendChild(el('div.control-body', {}, [input]));
    if (spec.hint) row.appendChild(el('p.hint', { text: spec.hint }));
    node.appendChild(row);
  }

  // rewire fire() to the latest handler without recreating widgets
  const originalFire = fire;
  const fireWrapper = (id, value) => {
    params[id] = value;
    const out = readouts.get(id);
    const spec = specs.find((s) => s.id === id);
    if (out && spec) {
      out.textContent = spec.format ? spec.format(value, params)
        : `${value}${spec.unit ? ' ' + spec.unit : ''}`;
    }
    if (onAny) onAny(id, value, params);
    callHandlers(id, value, params);
  };
  for (const [id, input] of inputs) {
    const spec = specs.find((s) => s.id === id);
    if (spec.type === 'range') {
      input.oninput = () => fireWrapper(id, Number(input.value));
    } else if (spec.type === 'toggle') {
      input.onchange = () => fireWrapper(id, input.checked);
    } else if (spec.type === 'select') {
      input.onchange = () => fireWrapper(id, input.value);
    } else {
      input.onclick = () => fireWrapper(id, Date.now());
    }
  }

  api.set = (id, value) => {
    const input = inputs.get(id);
    const spec = specs.find((s) => s.id === id);
    if (input && spec) {
      if (spec.type === 'toggle') input.checked = !!value;
      else input.value = value;
    }
    fireWrapper(id, value);
    return api;
  };

  return api;
}

/** A small key/value readout panel (ranges, DOP, residuals...). */
export function createReadout(rows = []) {
  const node = el('div.readout');
  const cells = new Map();
  for (const r of rows) {
    const cell = el('div.cell', { dataset: { key: r.key } }, [
      el('span.cell-label', { text: r.label }),
      el('span.cell-value', { text: r.value ?? '—' })
    ]);
    cells.set(r.key, cell.querySelector('.cell-value'));
    node.appendChild(cell);
  }
  return {
    node,
    set(key, value) {
      const c = cells.get(key);
      if (c) c.textContent = typeof value === 'number' ? formatNumber(value) : String(value);
      return this;
    },
    setAll(obj) { Object.entries(obj).forEach(([k, v]) => this.set(k, v)); return this; }
  };
}

function formatNumber(v) {
  if (!isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(3);
}
