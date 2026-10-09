# Aero Vision website

Vite + TypeScript + Supabase (auth, database, row-level security).

## Pages
- **Main** – intro, news, open surveys/forms
- **Events** – All / Current / Upcoming / Past buttons, registration (name prefilled from the account, editable per event)
- **Request** – join the team, organize an event, ask for an opportunity, share an idea (no account needed)
- **About us** – team members, contact form and links
- **Admin** (admins only) – answer requests, create events/news/surveys, view registrations and survey responses, edit team

## Setup
1. Create a project at supabase.com.
2. SQL Editor -> run `supabase/schema.sql`.
3. `cp .env.example .env` and fill in the Project URL and anon key (Settings -> API).
4. `npm install && npm run dev`
5. Sign up on the site, then make yourself admin (SQL Editor):
   `update public.profiles set role='admin' where id=(select id from auth.users where email='YOU@example.com');`
6. Put your real contact links in `src/supabase.ts` (`LINKS`).

Authentication > Providers > Email: turn off "Confirm email" for instant sign-up while testing.
