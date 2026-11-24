-- v5.6 speed fix (24 Nov 2026). Goal: hold ~7000+ punches/day on the current compute.
-- Root cause: helper functions (_req, _sg_status, _hk_state, _scope_*) were SECURITY DEFINER with SET search_path,
-- so Postgres could not inline them. Every caller computed ALL 852 stores (79 ms per _req call) and filtered afterwards.
-- The punch page, login page, store page and dashboards all paid this. Anon calls stop at 3 s ("hang").
-- CREATE OR REPLACE drops SECURITY DEFINER / SET when not restated.
-- Fix: make the helpers plain inlinable SQL (owner postgres, callers are SECURITY DEFINER, anon still has no EXECUTE),
-- schema-qualify tables, throttle the last_seen write, cache the login page counts.

create or replace function public._ist_today() returns date language sql stable
as $f$ select (now() at time zone 'Asia/Kolkata')::date $f$;
create or replace function public._ist_now() returns timestamp language sql stable
as $f$ select (now() at time zone 'Asia/Kolkata') $f$;
create or replace function public._shift_req(m integer, e integer, p_shift text) returns integer language sql immutable
as $f$ select case p_shift when 'M' then m when 'E' then e else m + e end $f$;

create or replace function public._req(p_date date)
returns table(store_code text, category_id text, brand text, vendor text, morning integer, evening integer)
language sql stable
as $f$
  select c.store_code, c.category_id, c.brand, c.vendor,
    case when c.hk_total is null then c.morning when h.morning + h.evening = c.hk_total then h.morning else c.hk_total end,
    case when c.hk_total is null then c.evening when h.morning + h.evening = c.hk_total then h.evening else 0 end
  from (select distinct on (m.store_code, m.category_id, m.brand) m.*
        from public.manpower m where m.effective_from <= p_date
        order by m.store_code, m.category_id, m.brand, m.effective_from desc, m.id desc) c
  left join lateral (select x.morning, x.evening from public.hk_split x
                     where x.store_code = c.store_code and x.effective_from <= p_date
                     order by x.effective_from desc, x.id desc limit 1) h on c.category_id = 'HK' and c.hk_total is not null
$f$;

create or replace function public._hk_state(p_date date)
returns table(store_code text, vendor text, hk_total integer, split_from date, morning integer, evening integer, split_set boolean)
language sql stable
as $f$
  select c.store_code, c.vendor, c.hk_total, h.effective_from, h.morning, h.evening,
         coalesce(h.morning + h.evening = c.hk_total, false)
  from (select distinct on (m.store_code) m.store_code, m.vendor, m.hk_total
        from public.manpower m where m.category_id = 'HK' and m.brand = '' and m.effective_from <= p_date
        order by m.store_code, m.effective_from desc, m.id desc) c
  left join lateral (select x.effective_from, x.morning, x.evening from public.hk_split x
                     where x.store_code = c.store_code and x.effective_from <= p_date
                     order by x.effective_from desc, x.id desc limit 1) h on true
  where c.hk_total is not null
$f$;

create or replace function public._scope_stores(s public.sessions) returns setof text language sql stable
as $f$
  select st.store_code from public.stores st
  where st.active and (
    s.role in ('admin','hodept')
    or (s.role = 'store' and st.store_code = s.store_code)
    or (s.role = 'am'   and st.am_emp   = s.emp_code)
    or (s.role = 'zfm'  and st.zfm_emp  = s.emp_code)
    or (s.role = 'rlpo' and st.rlpo_emp = s.emp_code))
$f$;

create or replace function public._scope_cats(s public.sessions) returns setof text language sql stable
as $f$
  select c.id from public.categories c
  where c.active and (
    (s.role not in ('hodept','rlpo'))
    or (s.role = 'rlpo' and c.id = 'SEC')
    or (s.role = 'hodept' and c.id = any (select unnest(d.category_ids) from public.users u join public.departments d on d.id = u.dept_id where u.emp_code = s.emp_code)))
$f$;

create or replace function public._sg_status(p_from date, p_to date)
returns table(associate_id bigint, store_code text, work_date date, shift text, st text, hours numeric, decided boolean)
language sql stable
as $f$
  with cfg as (select * from public.settings where id = 1),
  pa as (select p.associate_id aid, p.work_date wd, min(p.store_code) sc,
                min(p.ts) filter (where p.kind = 'IN') fi, max(p.ts) filter (where p.kind = 'OUT') lo,
                (array_agg(p.shift order by p.ts) filter (where p.kind = 'IN'))[1] sh
         from public.punches p where p.category_id = 'SEC' and p.work_date between p_from and p_to group by 1, 2),
  ex as (select e.associate_id aid, e.work_date wd, e.status from public.sg_exceptions e where e.work_date between p_from and p_to),
  j as (select coalesce(pa.aid, ex.aid) aid, coalesce(pa.wd, ex.wd) wd, pa.sc, pa.fi, pa.lo, pa.sh, ex.status ex
        from pa full join ex on ex.aid = pa.aid and ex.wd = pa.wd)
  select j.aid, coalesce(j.sc, a.store_code), j.wd, coalesce(j.sh, 'M'),
    case when j.ex is not null then j.ex
         when j.fi is null or j.lo is null or j.lo <= j.fi then case when j.wd < public._ist_today() then 'MP' else 'IN' end
         when extract(epoch from (j.lo - j.fi)) / 3600 < case when st.sg_set = 12 then cfg.sg12_a else cfg.sg8_a end then 'A'
         when extract(epoch from (j.lo - j.fi)) / 3600 < case when st.sg_set = 12 then cfg.sg12_p else cfg.sg8_p end then 'H'
         else 'P' end,
    case when j.fi is not null and j.lo > j.fi then round((extract(epoch from (j.lo - j.fi)) / 3600)::numeric, 1) end,
    j.ex is not null
  from j join public.associates a on a.id = j.aid
  left join public.stores st on st.store_code = coalesce(j.sc, a.store_code)
  cross join cfg
$f$;

revoke all on function public._req(date), public._hk_state(date), public._scope_stores(public.sessions),
  public._scope_cats(public.sessions), public._sg_status(date, date) from public, anon, authenticated;

-- last_seen: write at most once a minute per session (was an UPDATE on every call)
create or replace function public._sess(p_token uuid)
 returns sessions language plpgsql security definer set search_path to 'public'
as $function$
declare s sessions; v_idle int; v_noidle boolean;
begin
  select * into s from sessions where token = p_token;
  if not found or s.ended_at is not null then raise exception 'SESSION_EXPIRED'; end if;
  if s.last_seen > now() - interval '60 seconds' then return s; end if;
  select store_idle_min into v_idle from settings where id = 1;
  select coalesce(no_idle, false) into v_noidle from users where emp_code = coalesce(s.view_by, s.emp_code);
  if not coalesce(v_noidle, false) and (
       (s.role = 'store' and s.last_seen < now() - make_interval(mins => v_idle))
    or (s.role <> 'store' and s.last_seen < now() - interval '12 hours')) then
    update sessions set ended_at = now(), end_reason = 'auto_logout' where token = p_token;
    perform _log(s.emp_code, s.role, s.store_code, 'auto_logout', null, 'idle');
    raise exception 'SESSION_EXPIRED';
  end if;
  update sessions set last_seen = now() where token = p_token returning * into s;
  return s;
end $function$;

-- login page counts: cached 10 min (they were computed for all stores on every login page load)
create table if not exists public.kv_cache (k text primary key, v jsonb not null, at timestamptz not null default now());
alter table public.kv_cache enable row level security;
revoke all on public.kv_cache from anon, authenticated;

create or replace function public.login_options()
 returns json language plpgsql volatile security definer set search_path to 'public'
as $function$
declare c kv_cache;
begin
  select * into c from kv_cache where k = 'login_options';
  if not found or c.at < now() - interval '10 minutes' then
    insert into kv_cache(k, v, at) values ('login_options', _login_options_base()::jsonb, now())
    on conflict (k) do update set v = excluded.v, at = excluded.at returning * into c;
  end if;
  return (c.v || jsonb_build_object('consent_epoch', (select consent_epoch from settings where id = 1)))::json;
end $function$;

-- indexes used by the hot paths
create index if not exists sessions_emp_idx on public.sessions (emp_code) where ended_at is null;
create index if not exists punches_sec_day_idx on public.punches (work_date, associate_id) where category_id = 'SEC';
