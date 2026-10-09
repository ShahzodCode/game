import { db } from '../supabase';
import { me } from '../auth';
import { h, field, input, area, select, toast } from '../ui';

const KINDS: [string, string][] = [
  ['join', 'Join the team'],
  ['event', 'Organize an event'],
  ['opportunity', 'Ask for an opportunity'],
  ['idea', 'Share an idea'],
];

export function request(kind?: string) {
  const sel = select(KINDS, KINDS.some(([k]) => k === kind) ? kind! : 'join');
  const name = input('text', me?.name ?? '', true);
  const email = input('email', me?.email ?? '', true);
  const message = area();
  const extra = h('div');

  // Event requests ask for the details we need to give them a place.
  const eventDate = input('date'); const eventPlace = input('text', 'A school (default)'); const people = input('number');
  const syncExtra = () => extra.replaceChildren(...(sel.value === 'event'
    ? [field('Preferred date', eventDate), field('Place', eventPlace), field('Expected people', people)] : []));
  sel.addEventListener('change', syncExtra); syncExtra();

  const form = h('form', { class: 'panel form', onsubmit: async (e: Event) => {
    e.preventDefault();
    const details = sel.value === 'event'
      ? { date: eventDate.value, place: eventPlace.value, people: people.value } : {};
    const { error } = await db.from('requests').insert({
      kind: sel.value, name: name.value.trim(), email: email.value.trim(),
      message: message.value.trim(), details, user_id: me?.id ?? null });
    if (error) return toast(error.message, true);
    toast('Request sent. We will get back to you!');
    message.value = '';
  } },
    field('What do you want?', sel), field('Your name', name), field('Email', email),
    extra, field('Tell us more', message), h('button', { class: 'btn' }, 'Send request'));

  return h('div', {}, h('h1', {}, 'Request'),
    h('p', {}, 'Anyone can join Aero Vision or organize an event on behalf of the team. No account needed.'), form);
}
