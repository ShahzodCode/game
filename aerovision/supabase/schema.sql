-- Aero Vision schema. Run once in Supabase -> SQL Editor.
-- After signing up on the site, make yourself admin:
--   update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'YOU@example.com');

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  location text not null default '',
  organizer text not null default 'Aero Vision',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  user_id uuid references auth.users on delete set null,
  name text not null,
  email text not null default '',
  created_at timestamptz not null default now()
);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('join','event','idea','opportunity','contact')),
  name text not null,
  email text not null,
  message text not null default '',
  details jsonb not null default '{}',
  user_id uuid references auth.users on delete set null,
  status text not null default 'new' check (status in ('new','approved','declined')),
  created_at timestamptz not null default now()
);

create table public.news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now()
);

create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  -- [{ "q": "Question?", "type": "text" | "choice", "options": ["A","B"] }]
  questions jsonb not null default '[]',
  open boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  answers jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (survey_id, user_id)
);

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null default '',
  bio text not null default '',
  sort int not null default 0
);

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_registrations enable row level security;
alter table public.requests enable row level security;
alter table public.news enable row level security;
alter table public.surveys enable row level security;
alter table public.survey_responses enable row level security;
alter table public.team_members enable row level security;

-- profiles: read/update own name; admins read all. Role cannot be changed by users.
create policy "profile read" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profile update" on public.profiles for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

-- public read, admin write
create policy "events read" on public.events for select using (true);
create policy "events admin" on public.events for all using (public.is_admin()) with check (public.is_admin());
create policy "news read" on public.news for select using (true);
create policy "news admin" on public.news for all using (public.is_admin()) with check (public.is_admin());
create policy "team read" on public.team_members for select using (true);
create policy "team admin" on public.team_members for all using (public.is_admin()) with check (public.is_admin());
create policy "surveys read" on public.surveys for select using (true);
create policy "surveys admin" on public.surveys for all using (public.is_admin()) with check (public.is_admin());

-- registrations: anyone can register; users see their own; admins see all
create policy "reg insert" on public.event_registrations for insert
  with check (user_id is null or user_id = auth.uid());
create policy "reg read" on public.event_registrations for select using (user_id = auth.uid() or public.is_admin());
create policy "reg admin delete" on public.event_registrations for delete using (public.is_admin());

-- requests: anyone can send; users see their own; admins see and answer all
create policy "req insert" on public.requests for insert
  with check (user_id is null or user_id = auth.uid());
create policy "req read" on public.requests for select using (user_id = auth.uid() or public.is_admin());
create policy "req admin update" on public.requests for update using (public.is_admin());
create policy "req admin delete" on public.requests for delete using (public.is_admin());

-- survey answers: signed-in users answer once; admins read
create policy "resp insert" on public.survey_responses for insert with check (user_id = auth.uid());
create policy "resp read" on public.survey_responses for select using (user_id = auth.uid() or public.is_admin());

-- starter content
insert into public.team_members (name, role, bio, sort) values
  ('Your Name', 'Founder', 'Edit me in the admin panel.', 1);
