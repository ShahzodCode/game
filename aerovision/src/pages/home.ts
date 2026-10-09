import { db, News, Survey } from '../supabase';
import { me } from '../auth';
import { h, fmtDate, note, toast, field, area, select } from '../ui';

export async function home() {
  const [news, surveys] = await Promise.all([
    db.from('news').select('*').order('created_at', { ascending: false }).limit(5),
    db.from('surveys').select('*').eq('open', true).order('created_at', { ascending: false }),
  ]);
  return h('div', {},
    h('section', { class: 'hero' },
      h('h1', {}, 'Aero Vision'),
      h('p', {}, 'A public team for people who love building, flying and learning. Everyone can join. Anyone can organize an event under the Aero Vision name.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn', href: '#/events' }, 'See events'),
        h('a', { class: 'btn ghost', href: '#/request/join' }, 'Join the team'))),
    h('section', { class: 'cards3' },
      card('Everyone can join', 'No school or membership needed. Send a join request and become part of the team.'),
      card('Organize your event', 'Have an idea? We give you a place (a school for now) and the support to run it on behalf of Aero Vision.'),
      card('Create an account', 'Your name is filled in automatically when you register for events, and you can still change it per event.')),
    h('h2', {}, 'News'),
    h('div', { class: 'list' }, ...((news.data as News[]) ?? []).map((n) =>
      h('article', { class: 'panel' }, h('h3', {}, n.title), h('small', {}, fmtDate(n.created_at)), h('p', {}, n.body)))),
    !news.data?.length ? note('No news yet.') : null,
    h('h2', {}, 'Surveys & forms'),
    h('div', { class: 'list' }, ...((surveys.data as Survey[]) ?? []).map((s) =>
      h('article', { class: 'panel' }, h('h3', {}, s.title), h('p', {}, s.description),
        h('a', { class: 'btn small', href: `#/survey/${s.id}` }, 'Answer')))),
    !surveys.data?.length ? note('No open surveys.') : null);
}

const card = (t: string, p: string) => h('div', { class: 'panel' }, h('h3', {}, t), h('p', {}, p));

export async function surveyPage(id?: string) {
  const { data } = await db.from('surveys').select('*').eq('id', id ?? '').maybeSingle();
  const s = data as Survey | null;
  if (!s) return h('div', {}, note('Survey not found.'));
  if (!me) return h('div', {}, h('h1', {}, s.title), note('Please log in to answer.'), h('a', { class: 'btn', href: '#/login' }, 'Log in'));
  const inputs = s.questions.map((q) =>
    q.type === 'choice' ? select((q.options ?? []).map((o) => [o, o] as [string, string])) : area());
  const form = h('form', { class: 'panel form', onsubmit: async (e: Event) => {
    e.preventDefault();
    const answers = s.questions.map((q, i) => ({ q: q.q, a: inputs[i].value }));
    const { error } = await db.from('survey_responses').insert({ survey_id: s.id, user_id: me!.id, answers });
    if (error) toast(error.code === '23505' ? 'You already answered this survey.' : error.message, true);
    else { toast('Thank you!'); location.hash = '#/home'; }
  } }, ...s.questions.map((q, i) => field(q.q, inputs[i])), h('button', { class: 'btn' }, 'Send'));
  return h('div', {}, h('h1', {}, s.title), h('p', {}, s.description), form);
}
