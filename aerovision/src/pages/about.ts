import { db, LINKS, Member } from '../supabase';
import { me } from '../auth';
import { h, field, input, area, note, toast } from '../ui';

export async function about() {
  const { data } = await db.from('team_members').select('*').order('sort');
  const members = (data as Member[]) ?? [];

  const name = input('text', me?.name ?? '', true);
  const email = input('email', me?.email ?? '', true);
  const msg = area();
  const form = h('form', { class: 'panel form', onsubmit: async (e: Event) => {
    e.preventDefault();
    const { error } = await db.from('requests').insert({
      kind: 'contact', name: name.value.trim(), email: email.value.trim(), message: msg.value.trim(), user_id: me?.id ?? null });
    if (error) toast(error.message, true); else { toast('Message sent!'); msg.value = ''; }
  } }, field('Name', name), field('Email', email), field('Message', msg), h('button', { class: 'btn' }, 'Send'));

  return h('div', {},
    h('h1', {}, 'About us'),
    h('p', {}, 'Aero Vision started as a school team and is now open to everyone.'),
    h('h2', { id: 'team' }, 'Team members'),
    h('div', { class: 'cards3' }, ...members.map((m) =>
      h('div', { class: 'panel' }, h('h3', {}, m.name), h('small', {}, m.role), h('p', {}, m.bio)))),
    !members.length ? note('Team list coming soon.') : null,
    h('h2', { id: 'contact' }, 'Contact us'),
    h('p', {}, h('a', { href: `mailto:${LINKS.email}` }, LINKS.email), ' · ',
      h('a', { href: LINKS.instagram, target: '_blank', rel: 'noopener' }, 'Instagram'), ' · ',
      h('a', { href: LINKS.telegram, target: '_blank', rel: 'noopener' }, 'Telegram')),
    form);
}
