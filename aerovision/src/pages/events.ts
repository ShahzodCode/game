import { db, EventRow } from '../supabase';
import { me } from '../auth';
import { h, fmtDate, note, toast, field, input } from '../ui';

type Filter = 'all' | 'current' | 'upcoming' | 'past';
const FILTERS: Filter[] = ['all', 'current', 'upcoming', 'past'];

function when(e: EventRow): Exclude<Filter, 'all'> {
  const now = Date.now();
  if (new Date(e.ends_at).getTime() < now) return 'past';
  if (new Date(e.starts_at).getTime() > now) return 'upcoming';
  return 'current';
}

export async function events() {
  const { data, error } = await db.from('events').select('*').order('starts_at', { ascending: true });
  const all = (data as EventRow[]) ?? [];
  let filter: Filter = 'all';
  const list = h('div', { class: 'list' });
  const bar = h('div', { class: 'tabs' });

  const draw = () => {
    bar.replaceChildren(...FILTERS.map((f) =>
      h('button', { class: 'tab' + (f === filter ? ' on' : ''), onclick: () => { filter = f; draw(); } },
        f[0].toUpperCase() + f.slice(1))));
    const shown = all.filter((e) => filter === 'all' || when(e) === filter);
    list.replaceChildren(...(shown.length
      ? shown.map(eventCard)
      : [note(error ? error.message : 'No events here yet.')]));
  };
  draw();
  return h('div', {}, h('h1', {}, 'Events'), bar, list);
}

function eventCard(e: EventRow) {
  const status = when(e);
  const body = h('div', { class: 'panel' },
    h('div', { class: 'row between' }, h('h3', {}, e.title), h('span', { class: 'badge ' + status }, status)),
    h('small', {}, `${fmtDate(e.starts_at)} – ${fmtDate(e.ends_at)} · ${e.location || 'TBA'} · by ${e.organizer}`),
    h('p', {}, e.description));
  if (status !== 'past') body.append(h('button', { class: 'btn small', onclick: () => regForm(e, body) }, 'Register'));
  return body;
}

function regForm(e: EventRow, host: HTMLElement) {
  host.querySelector('form')?.remove();
  // The account name is the default; it can be changed for this registration only.
  const name = input('text', me?.name ?? '', true);
  const email = input('email', me?.email ?? '', true);
  const form = h('form', { class: 'form', onsubmit: async (ev: Event) => {
    ev.preventDefault();
    const { error } = await db.from('event_registrations').insert({
      event_id: e.id, user_id: me?.id ?? null, name: name.value.trim(), email: email.value.trim() });
    if (error) toast(error.message, true);
    else { toast('Registered!'); form.remove(); }
  } },
    field('Name for this registration', name), field('Email', email),
    me ? note('Filled from your account. Change it if you register someone else.')
       : note('Tip: create an account to have your name filled in automatically.'),
    h('button', { class: 'btn' }, 'Confirm'));
  host.append(form);
}
