-- ============================================================
-- TRIBASE — schema + segurança (Row Level Security) para Supabase
-- Cole TODO este arquivo no SQL Editor do seu projeto Supabase e rode.
-- ============================================================

-- ---------- Tabelas ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'athlete' check (role in ('coach','athlete')),
  coach_id   uuid references public.profiles(id) on delete set null,
  race       text,
  race_date  date,
  goal       text,
  created_at timestamptz default now()
);

create table if not exists public.workouts (
  id           uuid primary key default gen_random_uuid(),
  athlete_id   uuid not null references public.profiles(id) on delete cascade,
  coach_id     uuid references public.profiles(id) on delete set null,
  date         date not null,
  discipline   text not null,
  type         text not null,
  duration_min int default 0,
  distance     numeric default 0,
  dist_unit    text default 'km',
  target       text,
  notes        text,
  status       text not null default 'planejado' check (status in ('planejado','concluído')),
  rpe          int,
  -- métricas de performance (preenchidas na importação Strava/Garmin; alimentam a recalibração mensal)
  source       text,
  avg_hr       int,
  max_hr       int,
  elevation_m  int,
  calories     int,
  avg_power    int,
  created_at   timestamptz default now()
);

-- patch idempotente: adiciona as colunas de métrica em bancos já existentes
alter table public.workouts add column if not exists source      text;
alter table public.workouts add column if not exists avg_hr      int;
alter table public.workouts add column if not exists max_hr      int;
alter table public.workouts add column if not exists elevation_m int;
alter table public.workouts add column if not exists calories    int;
alter table public.workouts add column if not exists avg_power   int;

create index if not exists workouts_athlete_idx on public.workouts(athlete_id);
create index if not exists workouts_coach_idx   on public.workouts(coach_id);

-- ---------- Cria o profile automaticamente ao registrar usuário ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RPC: tornar-se treinador ----------
create or replace function public.become_coach()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set role = 'coach' where id = auth.uid();
end; $$;

-- ---------- RPC: vincular atleta (por email) ao treinador autenticado ----------
create or replace function public.link_athlete(athlete_email text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  me      uuid := auth.uid();
  my_role text;
  target  public.profiles;
begin
  select role into my_role from public.profiles where id = me;
  if my_role is distinct from 'coach' then
    raise exception 'Apenas treinadores podem vincular atletas';
  end if;

  update public.profiles
     set coach_id = me, role = 'athlete'
   where lower(email) = lower(athlete_email) and id <> me
  returning * into target;

  if target.id is null then
    raise exception 'Nenhum atleta com esse email. Peça para ele se cadastrar primeiro.';
  end if;
  return target;
end; $$;

-- ---------- RPC: atletas pendentes (cadastrados, ainda sem treinador) ----------
-- SECURITY DEFINER (ignora RLS) — só treinadores podem chamar.
create or replace function public.pending_athletes()
returns table (id uuid, email text, full_name text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if (select pr.role from public.profiles pr where pr.id = auth.uid()) is distinct from 'coach' then
    raise exception 'Apenas treinadores podem ver atletas pendentes';
  end if;
  return query
    select p.id, p.email, p.full_name, p.created_at
    from public.profiles p
    where p.role = 'athlete' and p.coach_id is null
    order by p.created_at desc;
end; $$;

-- ---------- RPC: remover atleta do painel (desvincular) ----------
-- SECURITY DEFINER — só o treinador dono pode desvincular o próprio atleta.
-- Mantém a conta e o histórico do atleta; só corta o vínculo (e o coach_id dos treinos).
create or replace function public.unlink_athlete(p_athlete uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if (select role from public.profiles where id = me) is distinct from 'coach' then
    raise exception 'Apenas treinadores podem remover atletas';
  end if;
  update public.profiles set coach_id = null where id = p_athlete and coach_id = me;
  update public.workouts  set coach_id = null where athlete_id = p_athlete and coach_id = me;
end; $$;

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.profiles enable row level security;
alter table public.workouts enable row level security;

-- PROFILES: você vê o seu profile e os profiles dos seus atletas
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using ( id = auth.uid() or coach_id = auth.uid() );

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update
  using ( id = auth.uid() ) with check ( id = auth.uid() );

drop policy if exists profiles_update_coach on public.profiles;
create policy profiles_update_coach on public.profiles for update
  using ( coach_id = auth.uid() ) with check ( coach_id = auth.uid() );

-- ENDURECIMENTO: o usuário NÃO pode alterar o próprio role/coach_id direto.
-- A RLS é por linha, então restringimos por COLUNA: só estas colunas podem ser
-- atualizadas pelo app. role/coach_id mudam apenas via become_coach()/link_athlete()
-- (SECURITY DEFINER, que rodam como dono e ignoram esta restrição).
revoke update on public.profiles from anon, authenticated;
grant update (email, full_name, race, race_date, goal) on public.profiles to authenticated;

-- WORKOUTS: atleta vê os seus; treinador vê os dos seus atletas
drop policy if exists workouts_select on public.workouts;
create policy workouts_select on public.workouts for select
  using ( athlete_id = auth.uid() or coach_id = auth.uid() );

drop policy if exists workouts_insert_coach on public.workouts;
create policy workouts_insert_coach on public.workouts for insert
  with check ( coach_id = auth.uid() );

-- atleta pode inserir os PRÓPRIOS treinos (ex.: importação de Strava/Garmin)
drop policy if exists workouts_insert_athlete on public.workouts;
create policy workouts_insert_athlete on public.workouts for insert
  with check ( athlete_id = auth.uid() );

drop policy if exists workouts_update_coach on public.workouts;
create policy workouts_update_coach on public.workouts for update
  using ( coach_id = auth.uid() ) with check ( coach_id = auth.uid() );

-- atleta pode atualizar os PRÓPRIOS treinos (marcar feito / RPE)
drop policy if exists workouts_update_athlete on public.workouts;
create policy workouts_update_athlete on public.workouts for update
  using ( athlete_id = auth.uid() ) with check ( athlete_id = auth.uid() );

drop policy if exists workouts_delete_coach on public.workouts;
create policy workouts_delete_coach on public.workouts for delete
  using ( coach_id = auth.uid() );

-- atleta pode remover os PRÓPRIOS treinos (ex.: importação errada)
drop policy if exists workouts_delete_athlete on public.workouts;
create policy workouts_delete_athlete on public.workouts for delete
  using ( athlete_id = auth.uid() );

-- Pronto. Veja o README.md para os próximos passos (chaves + deploy).

-- ============================================================
-- FASE 1 — MULTI-TENANT (assessorias / white-label)
-- Override das definições acima p/ escopo por organização (orgs).
-- ============================================================
-- ============ MULTI-TENANT (assessorias / white-label) ============
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  brand_name text,
  logo_url text,
  accent_color text,
  domain text unique,
  created_at timestamptz default now()
);
alter table public.orgs enable row level security;
drop policy if exists orgs_select on public.orgs;
create policy orgs_select on public.orgs for select using (true); -- branding (nome/logo/cor) é público

alter table public.profiles add column if not exists org_id uuid references public.orgs(id) on delete set null;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('owner','coach','athlete'));

-- org padrão + backfill dos usuários existentes
insert into public.orgs (slug, name, brand_name, accent_color)
  values ('default','Assessoria Padrão','TRIBASE','#ff5a3c') on conflict (slug) do nothing;
update public.profiles set org_id = (select id from public.orgs where slug='default') where org_id is null;

-- helpers (security definer evita recursão de RLS)
create or replace function public.my_org() returns uuid language sql security definer stable set search_path=public as $$ select org_id from public.profiles where id = auth.uid() $$;
create or replace function public.my_role() returns text language sql security definer stable set search_path=public as $$ select role from public.profiles where id = auth.uid() $$;

-- profiles_select: próprio + meus atletas + (dono enxerga a própria org)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  id = auth.uid()
  or coach_id = auth.uid()
  or (public.my_role() = 'owner' and org_id is not null and org_id = public.my_org())
);

-- pending_athletes: ESCOPADO à org (isolamento entre assessorias)
create or replace function public.pending_athletes()
returns table (id uuid, email text, full_name text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if (select pr.role from public.profiles pr where pr.id = auth.uid()) not in ('coach','owner') then
    raise exception 'Apenas treinadores/donos';
  end if;
  return query
    select p.id, p.email, p.full_name, p.created_at
    from public.profiles p
    where p.role = 'athlete' and p.coach_id is null and p.org_id = public.my_org()
    order by p.created_at desc;
end; $$;

-- link_athlete: só dentro da MESMA org
create or replace function public.link_athlete(athlete_email text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my_role text; my_o uuid; target public.profiles;
begin
  select role, org_id into my_role, my_o from public.profiles where id = me;
  if my_role not in ('coach','owner') then raise exception 'Apenas treinadores podem vincular atletas'; end if;
  update public.profiles set coach_id = me, role = 'athlete'
   where lower(email) = lower(athlete_email) and id <> me and org_id = my_o
  returning * into target;
  if target.id is null then raise exception 'Nenhum atleta com esse email nesta assessoria. Peça para ele se cadastrar primeiro.'; end if;
  return target;
end; $$;

-- handle_new_user: define org_id (via metadata org_slug, senão a org padrão)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  select id into o from public.orgs where slug = coalesce(new.raw_user_meta_data->>'org_slug','default');
  if o is null then select id into o from public.orgs where slug='default'; end if;
  insert into public.profiles (id, email, full_name, org_id)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email), o)
  on conflict (id) do nothing;
  return new;
end; $$;
