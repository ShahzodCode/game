import { db } from './supabase';

export type Me = { id: string; email: string; name: string; admin: boolean } | null;
export let me: Me = null;
const listeners: (() => void)[] = [];
export const onAuth = (f: () => void) => listeners.push(f);

export async function refreshMe() {
  const { data } = await db.auth.getSession();
  const u = data.session?.user;
  if (!u) me = null;
  else {
    const { data: p } = await db.from('profiles').select('full_name, role').eq('id', u.id).maybeSingle();
    me = { id: u.id, email: u.email ?? '', name: p?.full_name || u.email || '', admin: p?.role === 'admin' };
  }
  listeners.forEach((f) => f());
}

export const signIn = (email: string, password: string) => db.auth.signInWithPassword({ email, password });
export const signUp = (email: string, password: string, name: string) =>
  db.auth.signUp({ email, password, options: { data: { full_name: name } } });
export const signOut = () => db.auth.signOut();

db.auth.onAuthStateChange(() => { void refreshMe(); });
