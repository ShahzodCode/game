import { signIn, signUp, signOut, me } from '../auth';
import { h, field, input, toast } from '../ui';

export function login() {
  if (me) {
    return h('div', {}, h('h1', {}, 'Account'),
      h('div', { class: 'panel' }, h('p', {}, `Signed in as ${me.name} (${me.email})`),
        h('button', { class: 'btn', onclick: async () => { await signOut(); location.hash = '#/home'; } }, 'Log out')));
  }
  let signup = false;
  const name = input('text'); const email = input('email', '', true); const pass = input('password', '', true);
  const nameField = field('Name (used for event registrations)', name);
  const title = h('h1'); const submit = h('button', { class: 'btn' }); const toggle = h('button', { class: 'link', type: 'button' });
  const draw = () => {
    title.textContent = signup ? 'Create account' : 'Log in';
    submit.textContent = signup ? 'Create account' : 'Log in';
    toggle.textContent = signup ? 'I already have an account' : 'Create an account';
    nameField.style.display = signup ? '' : 'none';
  };
  toggle.onclick = () => { signup = !signup; draw(); };
  draw();
  const form = h('form', { class: 'panel form', onsubmit: async (e: Event) => {
    e.preventDefault();
    const r = signup ? await signUp(email.value, pass.value, name.value.trim()) : await signIn(email.value, pass.value);
    if (r.error) return toast(r.error.message, true);
    if (signup && !r.data.session) return toast('Check your email to confirm the account, then log in.');
    location.hash = '#/home';
  } }, nameField, field('Email', email), field('Password (min 6)', pass), submit, toggle);
  return h('div', {}, title, form);
}
