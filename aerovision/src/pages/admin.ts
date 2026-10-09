import { db, RequestRow, EventRow, News, Survey, Member, Question } from '../supabase';
import { me } from '../auth';
import { h, fmtDate, field, input, area, note, toast } from '../ui';

type Tab = 'requests' | 'events' | 'news' | 'surveys' | 'team';
let tab: Tab = 'requests';

export async function admin() {
  if (!me?.admin) return h('div', {}, h('h1', {}, 'Admin'), note('Admins only. Log in with an admin account.'));
  const body = h('div');
  const bar = h('div', { class: 'tabs' });
  const show = async (t: Tab) => {
    tab = t;
    bar.replaceChildren(...(['requests', 'events', 'news', 'surveys', 'team'] as Tab[]).map((x) =>
      h('button', { class: 'tab' + (x === tab ? ' on' : ''), onclick: () => show(x) }, x[0].toUpperCase() + x.slice(1))));
    body.replaceChildren(await { requests, events, news, surveys, team }[t](() => show(t)));
  };
  await show(tab);
  return h('div', {}, h('h1', {}, 'Admin panel'), bar, body);
}

const run = async (p: PromiseLike<{ error: { message: string } | null }>, again: () => void) => {
  const { error } = await p;
  if (error) toast(error.message, true); else again();
};
const del = (table: string, id: string, again: () => void) =>
  h('button', { class: 'btn small danger', onclick: () => confirm('Delete?') && run(db.from(table).delete().eq('id', id), again) }, 'Delete');

async function requests(again: () => void) {
  const { data } = await db.from('requests').select('*').order('created_at', { ascending: false });
  const rows = (data as RequestRow[]) ?? [];
  return h('div', { class: 'list' }, ...rows.map((r) =>
    h('div', { class: 'panel' },
      h('div', { class: 'row between' }, h('h3', {}, `${r.kind} — ${r.name}`), h('span', { class: 'badge ' + r.status }, r.status)),
      h('small', {}, `${r.email} · ${fmtDate(r.created_at)}`),
      h('p', {}, r.message),
      Object.keys(r.details ?? {}).length ? h('small', {}, JSON.stringify(r.details)) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => run(db.from('requests').update({ status: 'approved' }).eq('id', r.id), again) }, 'Approve'),
        h('button', { class: 'btn small ghost', onclick: () => run(db.from('requests').update({ status: 'declined' }).eq('id', r.id), again) }, 'Decline'),
        del('requests', r.id, again)))),
    rows.length ? null : note('No requests.'));
}

async function events(again: () => void) {
  const { data } = await db.from('events').select('*').order('starts_at', { ascending: false });
  const { data: regs } = await db.from('event_registrations').select('event_id, name, email');
  const title = input('text', '', true), place = input('text'), org = input('text', 'Aero Vision');
  const start = input('datetime-local', '', true), end = input('datetime-local', '', true), desc = area();
  const form = h('form', { class: 'panel form', onsubmit: (e: Event) => {
    e.preventDefault();
    void run(db.from('events').insert({
      title: title.value, location: place.value, organizer: org.value, description: desc.value,
      starts_at: new Date(start.value).toISOString(), ends_at: new Date(end.value).toISOString() }), again);
  } }, h('h3', {}, 'New event'), field('Title', title), field('Place', place), field('Organizer', org),
    field('Starts', start), field('Ends', end), field('Description', desc), h('button', { class: 'btn' }, 'Create event'));
  return h('div', {}, form, h('div', { class: 'list' }, ...((data as EventRow[]) ?? []).map((e) => {
    const mine = (regs ?? []).filter((r: any) => r.event_id === e.id);
    return h('div', { class: 'panel' }, h('h3', {}, e.title), h('small', {}, `${fmtDate(e.starts_at)} · ${mine.length} registered`),
      mine.length ? h('details', {}, h('summary', {}, 'Registrations'), ...mine.map((r: any) => h('div', {}, `${r.name} <${r.email}>`))) : null,
      del('events', e.id, again));
  })));
}

async function news(again: () => void) {
  const { data } = await db.from('news').select('*').order('created_at', { ascending: false });
  const title = input('text', '', true), body = area();
  const form = h('form', { class: 'panel form', onsubmit: (e: Event) => {
    e.preventDefault(); void run(db.from('news').insert({ title: title.value, body: body.value }), again);
  } }, h('h3', {}, 'Post news'), field('Title', title), field('Text', body), h('button', { class: 'btn' }, 'Publish'));
  return h('div', {}, form, h('div', { class: 'list' }, ...((data as News[]) ?? []).map((n) =>
    h('div', { class: 'panel' }, h('h3', {}, n.title), h('small', {}, fmtDate(n.created_at)), h('p', {}, n.body), del('news', n.id, again)))));
}

async function surveys(again: () => void) {
  const { data } = await db.from('surveys').select('*').order('created_at', { ascending: false });
  const { data: resp } = await db.from('survey_responses').select('survey_id, answers, created_at');
  const title = input('text', '', true), desc = area();
  const qs = area(); qs.placeholder = 'One question per line.\nFor multiple choice: Question? | Option A | Option B';
  const form = h('form', { class: 'panel form', onsubmit: (e: Event) => {
    e.preventDefault();
    const questions: Question[] = qs.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [q, ...options] = l.split('|').map((x) => x.trim());
      return options.length ? { q, type: 'choice', options } : { q, type: 'text' };
    });
    if (!questions.length) return toast('Add at least one question.', true);
    void run(db.from('surveys').insert({ title: title.value, description: desc.value, questions }), again);
  } }, h('h3', {}, 'New survey / form'), field('Title', title), field('Description', desc), field('Questions', qs), h('button', { class: 'btn' }, 'Create'));
  return h('div', {}, form, h('div', { class: 'list' }, ...((data as Survey[]) ?? []).map((s) => {
    const mine = (resp ?? []).filter((r: any) => r.survey_id === s.id);
    return h('div', { class: 'panel' }, h('h3', {}, s.title), h('small', {}, `${s.questions.length} questions · ${mine.length} responses · ${s.open ? 'open' : 'closed'}`),
      mine.length ? h('details', {}, h('summary', {}, 'Responses'), ...mine.map((r: any) =>
        h('pre', {}, (r.answers as { q: string; a: string }[]).map((a) => `${a.q}\n  → ${a.a}`).join('\n')))) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn small ghost', onclick: () => run(db.from('surveys').update({ open: !s.open }).eq('id', s.id), again) }, s.open ? 'Close' : 'Reopen'),
        del('surveys', s.id, again)));
  })));
}

async function team(again: () => void) {
  const { data } = await db.from('team_members').select('*').order('sort');
  const name = input('text', '', true), role = input('text'), bio = area(), sort = input('number', '0');
  const form = h('form', { class: 'panel form', onsubmit: (e: Event) => {
    e.preventDefault(); void run(db.from('team_members').insert({ name: name.value, role: role.value, bio: bio.value, sort: +sort.value }), again);
  } }, h('h3', {}, 'Add team member'), field('Name', name), field('Role', role), field('Bio', bio), field('Order', sort), h('button', { class: 'btn' }, 'Add'));
  return h('div', {}, form, h('div', { class: 'list' }, ...((data as Member[]) ?? []).map((m) =>
    h('div', { class: 'panel' }, h('h3', {}, m.name), h('small', {}, m.role), del('team_members', m.id, again)))));
}
