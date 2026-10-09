import './styles.css';
import { configured } from './supabase';
import { me, onAuth, refreshMe } from './auth';
import { route, start, render } from './router';
import { h } from './ui';
import { home, surveyPage } from './pages/home';
import { events } from './pages/events';
import { request } from './pages/request';
import { about } from './pages/about';
import { login } from './pages/login';
import { admin } from './pages/admin';

route('home', home);
route('events', events);
route('request', request);
route('about', about);
route('login', login);
route('admin', admin);
route('survey', surveyPage);

const app = document.getElementById('app')!;
const nav = h('nav');
const main = h('main');
const drawNav = () => nav.replaceChildren(
  h('a', { class: 'brand', href: '#/home' }, '✈ Aero Vision'),
  h('div', { class: 'links' },
    h('a', { href: '#/home' }, 'Main'),
    h('a', { href: '#/events' }, 'Events'),
    h('a', { href: '#/request' }, 'Request'),
    h('a', { href: '#/about' }, 'About us'),
    me?.admin ? h('a', { href: '#/admin' }, 'Admin') : null,
    h('a', { href: '#/login', class: 'acct' }, me ? me.name.split(' ')[0] : 'Log in')));

if (!configured) {
  app.append(h('main', {}, h('div', { class: 'panel' },
    h('h1', {}, 'Almost there'),
    h('p', {}, 'Copy .env.example to .env, fill in your Supabase URL and anon key, run supabase/schema.sql in the Supabase SQL editor, then restart the dev server.'))));
} else {
  app.append(nav, main, h('footer', {}, '© Aero Vision — a public team'));
  drawNav();
  onAuth(() => { drawNav(); void render(); });
  start(main);
  void refreshMe();
}
