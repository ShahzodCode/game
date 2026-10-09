import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = !!url && !!key && !url.includes('YOUR-PROJECT');
export const db = createClient(url || 'http://localhost', key || 'missing');

export type EventRow = { id: string; title: string; description: string; location: string; organizer: string; starts_at: string; ends_at: string };
export type Question = { q: string; type: 'text' | 'choice'; options?: string[] };
export type Survey = { id: string; title: string; description: string; questions: Question[]; open: boolean; created_at: string };
export type News = { id: string; title: string; body: string; created_at: string };
export type Member = { id: string; name: string; role: string; bio: string; sort: number };
export type RequestRow = { id: string; kind: string; name: string; email: string; message: string; details: Record<string, string>; status: string; created_at: string };

export const LINKS = {
  email: 'hello@aerovision.example',
  instagram: 'https://instagram.com/aerovision',
  telegram: 'https://t.me/aerovision',
};
