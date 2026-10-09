type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Record<string, any> = {}, ...kids: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k in el) (el as any)[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c) el.append(c);
  return el;
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function toast(msg: string, bad = false) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

/** A labelled input/textarea/select. Read the value back with `.value`. */
export function field(label: string, el: HTMLElement) {
  return h('label', { class: 'field' }, h('span', {}, label), el);
}
export const input = (type = 'text', value = '', required = false) =>
  h('input', { type, value, required });
export const area = (value = '') => h('textarea', { rows: 4, value });
export function select(options: [string, string][], value = '') {
  const s = h('select');
  for (const [v, t] of options) s.append(h('option', { value: v, selected: v === value }, t));
  return s;
}
export const note = (msg: string) => h('p', { class: 'note' }, msg);
