-- v5: RLPO role + SG (security) day status, HK morning/evening split, approvals routing + history,
--     login by mail, login stats, punch vendors, admin RLPO master. Additive and v4-compatible.
-- Applied as 4 migrations: v5_a_schema, v5_b_auth, v5_c_dash, v5_d_requests_admin (split on the markers below).

-- =====================================================================================
-- @@ v5_a_schema
-- =====================================================================================
alter table public.stores
  add column if not exists rlpo_emp text,
  add column if not exists sg_set int not null default 8;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stores_sg_set_check') then
    alter table public.stores add constraint stores_sg_set_check check (sg_set in (8, 12));
  end if;
end $$;
create index if not exists stores_rlpo_emp_idx on public.stores (rlpo_emp);

alter table public.users
  add column if not exists phone text,
  add column if not exists region text;
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check check (role in ('store','am','zfm','hodept','admin','rlpo'));
alter table public.users drop constraint if exists users_emp_code_check;
alter table public.users add constraint users_emp_code_check check (
  emp_code ~ '^[0-9]{5,}$'
  or (role in ('hodept','rlpo') and emp_code ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and emp_code = lower(emp_code)));
create index if not exists users_email_lower_idx on public.users (lower(email));

alter table public.manpower add column if not exists hk_total int check (hk_total >= 0);

alter table public.change_requests drop constraint if exists change_requests_kind_check;
alter table public.change_requests add constraint change_requests_kind_check
  check (kind in ('compoff','staff','missed_out','missed_in','sg_mispunch','sg_edit'));
alter table public.change_requests add column if not exists decision text;   -- SG: P / H / A chosen by RLPO
create index if not exists change_requests_created_idx on public.change_requests (created_at desc);

create table if not exists public.hk_split (
  id bigserial primary key,
  store_code text not null references public.stores(store_code) on delete cascade,
  effective_from date not null,
  morning int not null check (morning >= 0),
  evening int not null check (evening >= 0),
  set_by text,
  created_at timestamptz not null default now()
);
create index if not exists hk_split_store_idx on public.hk_split (store_code, effective_from desc, id desc);

create table if not exists public.sg_exceptions (
  id bigserial primary key,
  associate_id bigint not null references public.associates(id) on delete cascade,
  work_date date not null,
  status text not null check (status in ('P','H','A','P*')),
  reason text,
  by_emp text,
  at timestamptz not null default now(),
  cr_id bigint references public.change_requests(id) on delete set null,
  unique (associate_id, work_date)
);
create index if not exists sg_exceptions_date_idx on public.sg_exceptions (work_date);

alter table public.settings
  add column if not exists sg12_a numeric not null default 6,
  add column if not exists sg12_p numeric not null default 12,
  add column if not exists sg8_a numeric not null default 4,
  add column if not exists sg8_p numeric not null default 8,
  add column if not exists idle_other_min int not null default 60,
  add column if not exists low_pct int not null default 70,
  add column if not exists low_days int not null default 3;

alter table public.hk_split enable row level security;
alter table public.sg_exceptions enable row level security;

-- ---------- helpers ----------
create or replace function public._scope_stores(s sessions)
returns setof text language sql stable security definer set search_path = public as $$
  select st.store_code from stores st
  where st.active and (
    s.role in ('admin','hodept')
    or (s.role = 'store' and st.store_code = s.store_code)
    or (s.role = 'am'   and st.am_emp   = s.emp_code)
    or (s.role = 'zfm'  and st.zfm_emp  = s.emp_code)
    or (s.role = 'rlpo' and st.rlpo_emp = s.emp_code))
$$;

create or replace function public._scope_cats(s sessions)
returns setof text language sql stable security definer set search_path = public as $$
  select c.id from categories c
  where c.active and (
    (s.role not in ('hodept','rlpo'))
    or (s.role = 'rlpo' and c.id = 'SEC')
    or (s.role = 'hodept' and c.id = any (select unnest(d.category_ids) from users u join departments d on d.id = u.dept_id where u.emp_code = s.emp_code)))
$$;

-- requirement per store/category/brand on a date. HK rows with hk_total use the store's split
-- (latest hk_split <= date whose morning+evening = total); no valid split -> total in Morning.
create or replace function public._req(p_date date)
returns table(store_code text, category_id text, brand text, vendor text, morning int, evening int)
language sql stable security definer set search_path = public as $$
  select c.store_code, c.category_id, c.brand, c.vendor,
    case when c.hk_total is null then c.morning when h.morning + h.evening = c.hk_total then h.morning else c.hk_total end,
    case when c.hk_total is null then c.evening when h.morning + h.evening = c.hk_total then h.evening else 0 end
  from (select distinct on (m.store_code, m.category_id, m.brand) m.*
        from manpower m where m.effective_from <= p_date
        order by m.store_code, m.category_id, m.brand, m.effective_from desc, m.id desc) c
  left join lateral (select x.morning, x.evening from hk_split x
                     where x.store_code = c.store_code and x.effective_from <= p_date
                     order by x.effective_from desc, x.id desc limit 1) h on c.category_id = 'HK' and c.hk_total is not null
$$;

-- HK total + split state per store (only stores whose current HK row carries hk_total)
create or replace function public._hk_state(p_date date)
returns table(store_code text, vendor text, hk_total int, split_from date, morning int, evening int, split_set boolean)
language sql stable security definer set search_path = public as $$
  select c.store_code, c.vendor, c.hk_total, h.effective_from, h.morning, h.evening,
         coalesce(h.morning + h.evening = c.hk_total, false)
  from (select distinct on (m.store_code) m.store_code, m.vendor, m.hk_total
        from manpower m where m.category_id = 'HK' and m.brand = '' and m.effective_from <= p_date
        order by m.store_code, m.effective_from desc, m.id desc) c
  left join lateral (select x.effective_from, x.morning, x.evening from hk_split x
                     where x.store_code = c.store_code and x.effective_from <= p_date
                     order by x.effective_from desc, x.id desc limit 1) h on true
  where c.hk_total is not null
$$;

-- SG day status per guard: hours = last OUT - first IN; < a -> A, < p -> H, else P (thresholds by store sg_set).
-- IN without OUT on a finished day = MP; today = IN (live). sg_exceptions override (P/H/A/P*).
create or replace function public._sg_status(p_from date, p_to date)
returns table(associate_id bigint, store_code text, work_date date, shift text, st text, hours numeric, decided boolean)
language sql stable security definer set search_path = public as $$
  with cfg as (select * from settings where id = 1),
  pa as (select p.associate_id aid, p.work_date wd, min(p.store_code) sc,
                min(p.ts) filter (where p.kind = 'IN') fi, max(p.ts) filter (where p.kind = 'OUT') lo,
                (array_agg(p.shift order by p.ts) filter (where p.kind = 'IN'))[1] sh
         from punches p where p.category_id = 'SEC' and p.work_date between p_from and p_to group by 1, 2),
  ex as (select e.associate_id aid, e.work_date wd, e.status from sg_exceptions e where e.work_date between p_from and p_to),
  j as (select coalesce(pa.aid, ex.aid) aid, coalesce(pa.wd, ex.wd) wd, pa.sc, pa.fi, pa.lo, pa.sh, ex.status ex
        from pa full join ex on ex.aid = pa.aid and ex.wd = pa.wd)
  select j.aid, coalesce(j.sc, a.store_code), j.wd, coalesce(j.sh, 'M'),
    case when j.ex is not null then j.ex
         when j.fi is null or j.lo is null or j.lo <= j.fi then case when j.wd < _ist_today() then 'MP' else 'IN' end
         when extract(epoch from (j.lo - j.fi)) / 3600 < case when st.sg_set = 12 then cfg.sg12_a else cfg.sg8_a end then 'A'
         when extract(epoch from (j.lo - j.fi)) / 3600 < case when st.sg_set = 12 then cfg.sg12_p else cfg.sg8_p end then 'H'
         else 'P' end,
    case when j.fi is not null and j.lo > j.fi then round((extract(epoch from (j.lo - j.fi)) / 3600)::numeric, 1) end,
    j.ex is not null
  from j join associates a on a.id = j.aid
  left join stores st on st.store_code = coalesce(j.sc, a.store_code)
  cross join cfg
$$;

create or replace function public._is_sg_kind(p_kind text)
returns boolean language sql immutable set search_path = public as $$ select p_kind in ('sg_mispunch','sg_edit') $$;

-- who may decide a request: AM = non-SG kinds of his stores; RLPO = SG kinds of stores mapped to him. Nobody else.
create or replace function public._can_decide(s sessions, r change_requests)
returns boolean language sql stable security definer set search_path = public as $$
  select s.view_by is null and r.status = 'pending' and (
    (s.role = 'am' and not _is_sg_kind(r.kind) and exists (select 1 from stores x where x.store_code = r.store_code and x.am_emp = s.emp_code))
    or (s.role = 'rlpo' and _is_sg_kind(r.kind) and exists (select 1 from stores x where x.store_code = r.store_code and x.rlpo_emp = s.emp_code)))
$$;

revoke execute on function public._req(date), public._hk_state(date), public._sg_status(date, date),
  public._is_sg_kind(text), public._can_decide(sessions, change_requests),
  public._scope_stores(sessions), public._scope_cats(sessions) from public, anon, authenticated;

-- =====================================================================================
-- @@ v5_b_auth
-- =====================================================================================
-- am/zfm/admin: emp code OR users.email; hodept/rlpo: mail (= emp_code) OR users.email
create or replace function public._match_user(p_role text, p_emp text, p_post text, p_store text, p_dept bigint)
returns users language plpgsql stable security definer set search_path = public as $$
declare u users; v text := btrim(coalesce(p_emp, ''));
begin
  select * into u from users
  where role = p_role and active
    and (case
           when p_role in ('hodept','rlpo') then emp_code = lower(v) or (email is not null and lower(email) = lower(v))
           when p_role in ('am','zfm','admin') then emp_code = v or (position('@' in v) > 0 and email is not null and lower(email) = lower(v))
           else emp_code = v end)
    and (p_role <> 'store'  or (post = p_post and store_code = upper(btrim(p_store))))
    and (p_role <> 'hodept' or dept_id = p_dept)
  order by (emp_code = v or emp_code = lower(v)) desc, last_login_at desc nulls last, emp_code
  limit 1;
  return u;
end $$;

create or replace function public.auth_check(p_role text, p_emp text, p_post text default null, p_store text default null, p_dept bigint default null)
returns json language plpgsql security definer set search_path = public as $$
declare u users; x users; st stores;
begin
  if not (btrim(coalesce(p_emp,'')) ~ '^[0-9]{5,}$'
          or (p_role in ('hodept','rlpo','am','zfm','admin') and btrim(coalesce(p_emp,'')) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')) then
    return json_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if p_role = 'store' then
    select * into st from stores where store_code = upper(btrim(p_store)) and active;
    if not found then return json_build_object('ok', false, 'error', 'STORE_NOT_FOUND'); end if;
    u := _match_user(p_role, p_emp, p_post, p_store, p_dept);
    if u.emp_code is null then
      select * into x from users where emp_code = btrim(p_emp);
      if found and x.active then
        return json_build_object('ok', false, 'error', 'EMP_ELSEWHERE',
          'where', case when x.role = 'store' then x.post || ' · ' || x.store_code else upper(x.role) end);
      end if;
      select * into x from users where role = 'store' and active and store_code = st.store_code and post = p_post;
      if found then
        return json_build_object('ok', false, 'error', 'POST_TAKEN', 'by_name', x.name, 'by_emp', x.emp_code, 'post', p_post, 'store', st.store_code);
      end if;
      return json_build_object('ok', true, 'register', true, 'name', null, 'pin_set', false, 'store_name', st.name, 'locked_sec', 0);
    end if;
  else
    u := _match_user(p_role, p_emp, p_post, p_store, p_dept);
    if u.emp_code is null then return json_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  end if;
  return json_build_object('ok', true, 'name', u.name, 'emp', u.emp_code, 'pin_set', u.pin_hash is not null,
    'need_code', u.role <> 'store' and u.pin_hash is null,
    'store_name', (select name from stores where store_code = u.store_code),
    'locked_sec', greatest(0, ceil(extract(epoch from (coalesce(u.locked_until, now()) - now()))))::int);
end $$;

create or replace function public.auth_me(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; u users; cfg settings;
begin
  s := _sess(p_token);
  select * into u from users where emp_code = s.emp_code;
  select * into cfg from settings where id = 1;
  return json_build_object('ok', true, 'role', u.role, 'emp', u.emp_code, 'name', u.name, 'post', u.post,
    'store_code', u.store_code, 'store_name', (select name from stores where store_code = u.store_code),
    'dept', (select name from departments where id = u.dept_id),
    'view_by', s.view_by, 'view_by_name', (select name from users where emp_code = s.view_by),
    'email', u.email,
    'idle_min', case when u.role = 'store' then cfg.store_idle_min else cfg.idle_other_min end,
    'stores_n', (select count(*) from _scope_stores(s)));
exception when others then
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.login_options()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('departments', (select coalesce(json_agg(json_build_object('id', id, 'name', name) order by name), '[]') from departments where active),
    'posts', json_build_array('SM','ASM','DM Apps','DM FMCG','DM GM'),
    'stats', (select json_build_object(
        'guards',       coalesce(sum(r.morning + r.evening) filter (where r.category_id = 'SEC'), 0),
        'housekeeping', coalesce(sum(r.morning + r.evening) filter (where r.category_id = 'HK'), 0),
        'promoters',    coalesce(sum(r.morning + r.evening) filter (where c.photo_group = 'PROM'), 0),
        'vendors',      count(distinct lower(btrim(r.vendor))),
        'stores',       (select count(*) from stores where active and not is_test))
      from _req(_ist_today()) r join categories c on c.id = r.category_id
      join stores st on st.store_code = r.store_code and st.active and not st.is_test))
$$;

create or replace function public.punch_context(p_store text)
returns json language plpgsql security definer set search_path = public as $$
declare st stores; cfg settings;
begin
  select * into st from stores where store_code = upper(btrim(p_store)) and active;
  if not found then return json_build_object('ok', false, 'error', 'STORE_NOT_FOUND'); end if;
  select * into cfg from settings where id = 1;
  return json_build_object('ok', true,
    'store', json_build_object('code', st.store_code, 'name', st.name, 'mapped', st.lat is not null),
    'test_mode', cfg.test_mode, 'live_check', cfg.live_check, 'radius_m', cfg.radius_m,
    'categories', (select coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'name_hi', c.name_hi, 'brands', c.brands,
        'vendors', (select coalesce(json_agg(distinct v), '[]') from (
            select m.vendor v from manpower m where m.store_code = st.store_code and m.category_id = c.id and m.vendor is not null
            union select a.vendor from associates a where a.store_code = st.store_code and a.category_id = c.id and a.vendor is not null) x))
        order by c.sort), '[]') from categories c where c.active),
    'vendors', (select coalesce(json_agg(json_build_object('cat', x.category_id, 'vendor', x.vendor, 'brand', x.brand)
                  order by x.sort, x.brand, x.vendor), '[]')
                from (select distinct r.category_id, r.vendor, r.brand, c.sort from _req(_ist_today()) r
                      join categories c on c.id = r.category_id and c.active
                      where r.store_code = st.store_code and nullif(btrim(r.vendor), '') is not null) x));
end $$;

-- =====================================================================================
-- @@ v5_c_dash
-- =====================================================================================
create or replace function public.dash_overview(p_token uuid, p_date date, p_shift text default 'B', p_upto time default null)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; cfg settings; v_today date := _ist_today(); v_sgday boolean; v_sec boolean; v_rows json;
  v_req int; v_p int := 0; v_h int := 0; v_ps int := 0; v_mp int := 0; v_ax int := 0; v_mpd date; v_mpl json := '[]';
begin
  s := _sess(p_token);
  select * into cfg from settings where id = 1;
  v_sgday := p_date < v_today and p_upto is null;
  v_sec := 'SEC' in (select _scope_cats(s));

  with sc as (select _scope_stores(s) code), cs as (select _scope_cats(s) id),
  rq as (select r.store_code, r.category_id, sum(_shift_req(r.morning, r.evening, p_shift))::int req
         from _req(p_date) r where r.store_code in (select code from sc) and r.category_id in (select id from cs)
         group by 1, 2),
  pr as (select p.store_code, p.category_id, count(distinct p.associate_id)::int present
         from punches p
         where p.work_date = p_date and p.kind = 'IN'
           and p.store_code in (select code from sc) and p.category_id in (select id from cs)
           and (p_shift = 'B' or p.shift = p_shift)
           and (p_upto is null or (p.ts at time zone 'Asia/Kolkata')::time <= p_upto)
           and not (v_sgday and p.category_id = 'SEC')
         group by 1, 2
         union all
         select g.store_code, 'SEC', count(*)::int
         from _sg_status(p_date, p_date) g
         where v_sgday and v_sec and g.store_code in (select code from sc) and g.st in ('P','H','P*')
           and (p_shift = 'B' or g.shift = p_shift)
         group by 1),
  co as (select a.store_code, a.category_id, count(*)::int compoff
         from compoffs c join associates a on a.id = c.associate_id
         where c.work_date = p_date group by 1, 2)
  select coalesce(json_agg(json_build_object('s', coalesce(rq.store_code, pr.store_code), 'c', coalesce(rq.category_id, pr.category_id),
           'req', greatest(coalesce(rq.req,0) - coalesce(co.compoff,0), 0), 'p', coalesce(pr.present,0), 'co', coalesce(co.compoff,0))), '[]')
  into v_rows
  from rq full join pr on pr.store_code = rq.store_code and pr.category_id = rq.category_id
  left join co on co.store_code = coalesce(rq.store_code, pr.store_code) and co.category_id = coalesce(rq.category_id, pr.category_id);

  if v_sec then
    v_req := coalesce((select sum((r->>'req')::int) from json_array_elements(v_rows) r where r->>'c' = 'SEC'), 0);
    if v_sgday then
      select count(*) filter (where g.st = 'P'), count(*) filter (where g.st = 'H'), count(*) filter (where g.st = 'P*'),
             count(*) filter (where g.st = 'MP'), count(*) filter (where g.st = 'A')
        into v_p, v_h, v_ps, v_mp, v_ax
      from _sg_status(p_date, p_date) g
      where g.store_code in (select _scope_stores(s)) and (p_shift = 'B' or g.shift = p_shift);
    else
      v_p := coalesce((select sum((r->>'p')::int) from json_array_elements(v_rows) r where r->>'c' = 'SEC'), 0);
      select count(*) into v_ps from sg_exceptions e join associates a on a.id = e.associate_id
       where e.work_date = p_date and e.status = 'P*' and a.store_code in (select _scope_stores(s))
         and not exists (select 1 from punches p where p.associate_id = e.associate_id and p.work_date = p_date and p.kind = 'IN');
    end if;
    v_mpd := case when p_date < v_today then p_date else v_today - 1 end;
    select coalesce(json_agg(json_build_object('s', x.store_code, 'n', x.n, 'names', x.names, 'ids', x.ids) order by x.store_code), '[]') into v_mpl
    from (select g.store_code, count(*)::int n, array_agg(a.name order by a.name) names, array_agg(a.id order by a.name) ids
          from _sg_status(v_mpd, v_mpd) g join associates a on a.id = g.associate_id
          where g.st = 'MP' and g.store_code in (select _scope_stores(s)) group by 1) x;
  end if;

  return json_build_object('ok', true,
    'date', p_date, 'shift', p_shift, 'today', v_today, 'now', to_char(_ist_now(), 'HH24:MI'),
    'alert_m', to_char(cfg.alert_m, 'HH24:MI'), 'alert_e', to_char(cfg.alert_e, 'HH24:MI'),
    'low_pct', cfg.low_pct, 'low_days', cfg.low_days, 'sg_final', v_sgday,
    'categories', (select coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'name_hi', c.name_hi) order by c.sort), '[]')
                   from categories c where c.id in (select _scope_cats(s))),
    'stores', (select coalesce(json_agg(json_build_object('code', st.store_code, 'name', st.name,
                 'am', st.am_emp, 'am_name', ua.name, 'zfm', st.zfm_emp, 'zfm_name', uz.name,
                 'rlpo', st.rlpo_emp, 'rlpo_name', ur.name, 'sg_set', st.sg_set, 'hk_split_set', hu.store_code is null) order by st.store_code), '[]')
               from stores st left join users ua on ua.emp_code = st.am_emp left join users uz on uz.emp_code = st.zfm_emp
               left join users ur on ur.emp_code = st.rlpo_emp
               left join (select h.store_code from _hk_state(p_date) h where not h.split_set) hu on hu.store_code = st.store_code
               where st.store_code in (select _scope_stores(s))),
    'photo_due', (select coalesce(json_agg(json_build_object('s', x.store_code, 'c', x.category_id, 'n', x.n)), '[]') from (
                  select p.store_code, p.category_id, count(*)::int n from punches p
                  where p.work_date = p_date and p.photo_status = 'pending' and p.store_code in (select _scope_stores(s))
                    and p.category_id in (select _scope_cats(s)) and (p_shift = 'B' or p.shift = p_shift) group by 1, 2) x),
    'sg_counts', case when v_sec then json_build_object('P', v_p, 'H', v_h, 'Pstar', v_ps, 'MP', v_mp,
                    'A', greatest(v_req - v_p - v_h - v_ps - v_mp, v_ax), 'req', v_req) end,
    'mispunch_date', v_mpd,
    'mispunch', v_mpl,
    'rows', v_rows);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.dash_week(p_token uuid, p_end date, p_shift text default 'B')
returns json language plpgsql security definer set search_path = public as $$
declare v_s sessions; v_today date := _ist_today();
begin
  v_s := _sess(p_token);
  return json_build_object('ok', true, 'end', p_end, 'rows', (
    with sc as (select _scope_stores(v_s) code), cs as (select _scope_cats(v_s) id),
    dd as (select (p_end - g)::date d from generate_series(0, 6) g),
    rq as (select dd.d, r.store_code sx, r.category_id cx, sum(_shift_req(r.morning, r.evening, p_shift))::int req
           from dd cross join lateral _req(dd.d) r
           where r.store_code in (select code from sc) and r.category_id in (select id from cs) group by 1, 2, 3),
    pr as (select p.work_date d, p.store_code sx, p.category_id cx, count(distinct p.associate_id)::int n
           from punches p where p.work_date between p_end - 6 and p_end and p.kind = 'IN'
             and p.store_code in (select code from sc) and p.category_id in (select id from cs)
             and (p_shift = 'B' or p.shift = p_shift)
             and not (p.category_id = 'SEC' and p.work_date < v_today)
           group by 1, 2, 3
           union all
           select g.work_date, g.store_code, 'SEC', count(*)::int
           from _sg_status(p_end - 6, least(p_end, v_today - 1)) g
           where 'SEC' in (select id from cs) and g.store_code in (select code from sc) and g.st in ('P','H','P*')
             and (p_shift = 'B' or g.shift = p_shift)
           group by 1, 2),
    co as (select c.work_date d, a.store_code sx, a.category_id cx, count(*)::int n
           from compoffs c join associates a on a.id = c.associate_id
           where c.work_date between p_end - 6 and p_end and a.store_code in (select code from sc) group by 1, 2, 3),
    j as (select coalesce(rq.d, pr.d) d, coalesce(rq.sx, pr.sx) sx, coalesce(rq.cx, pr.cx) cx,
                 greatest(coalesce(rq.req, 0) - coalesce(co.n, 0), 0) req, coalesce(pr.n, 0) pn
          from rq full join pr on pr.d = rq.d and pr.sx = rq.sx and pr.cx = rq.cx
          left join co on co.d = coalesce(rq.d, pr.d) and co.sx = coalesce(rq.sx, pr.sx) and co.cx = coalesce(rq.cx, pr.cx)),
    k as (select distinct j.sx, j.cx from j),
    g as (select k.sx, k.cx, dd.d, coalesce(j.req, 0) req, coalesce(j.pn, 0) pn from k cross join dd left join j on j.sx = k.sx and j.cx = k.cx and j.d = dd.d)
    select coalesce(json_agg(json_build_object('s', z.sx, 'c', z.cx, 'r', z.r, 'p', z.p)), '[]')
    from (select g.sx, g.cx, array_agg(g.req order by g.d) r, array_agg(g.pn order by g.d) p from g group by g.sx, g.cx) z));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.dash_store(p_token uuid, p_store text, p_date date, p_shift text default 'B')
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_store text; v_sgday boolean := p_date < _ist_today(); st stores; h record;
begin
  s := _sess(p_token);
  v_store := case when s.role = 'store' then s.store_code else upper(p_store) end;
  if v_store not in (select _scope_stores(s)) then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  select * into st from stores where store_code = v_store;
  select * into h from _hk_state(p_date) x where x.store_code = v_store;
  return json_build_object('ok', true, 'store', v_store,
    'store_name', st.name, 'date', p_date,
    'sg_set', st.sg_set, 'rlpo', st.rlpo_emp, 'rlpo_name', (select name from users where emp_code = st.rlpo_emp),
    'hk', case when h.store_code is not null then json_build_object('total', h.hk_total, 'set', h.split_set, 'morning', h.morning, 'evening', h.evening) end,
    'slots', (
      with rq as (select r.category_id, r.brand, r.vendor, _shift_req(r.morning, r.evening, p_shift) req
                  from _req(p_date) r where r.store_code = v_store and r.category_id in (select _scope_cats(s))),
      pr as (select p.category_id, p.brand, count(distinct p.associate_id)::int present
             from punches p where p.store_code = v_store and p.work_date = p_date and p.kind = 'IN'
               and (p_shift = 'B' or p.shift = p_shift) and not (v_sgday and p.category_id = 'SEC') group by 1, 2
             union all
             select a.category_id, a.brand, count(*)::int from _sg_status(p_date, p_date) g join associates a on a.id = g.associate_id
             where v_sgday and g.store_code = v_store and g.st in ('P','H','P*') and (p_shift = 'B' or g.shift = p_shift) group by 1, 2),
      co as (select a.category_id, a.brand, count(*)::int compoff from compoffs c join associates a on a.id = c.associate_id
             where a.store_code = v_store and c.work_date = p_date group by 1, 2)
      select coalesce(json_agg(json_build_object('c', coalesce(rq.category_id, pr.category_id), 'brand', coalesce(rq.brand, pr.brand),
               'vendor', rq.vendor, 'req', greatest(coalesce(rq.req,0) - coalesce(co.compoff,0), 0), 'p', coalesce(pr.present,0),
               'co', coalesce(co.compoff,0)) order by coalesce(rq.category_id, pr.category_id), coalesce(rq.brand, pr.brand)), '[]')
      from rq full join pr on pr.category_id = rq.category_id and pr.brand = rq.brand
      left join co on co.category_id = coalesce(rq.category_id, pr.category_id) and co.brand = coalesce(rq.brand, pr.brand)),
    'present', (
      with sgd as (select g.* from _sg_status(p_date, p_date) g where g.store_code = v_store)
      select coalesce(json_agg(x order by x.c = 'SEC', x.first_in, x.name), '[]') from (
        select a.id, a.code, a.name, a.category_id c, a.brand, a.vendor,
          case when a.category_id <> 'SEC' then to_char(min(p.ts) filter (where p.kind = 'IN') at time zone 'Asia/Kolkata', 'HH24:MI') end first_in,
          case when a.category_id <> 'SEC' then to_char(max(p.ts) filter (where p.kind = 'OUT') at time zone 'Asia/Kolkata', 'HH24:MI') end last_out,
          case when a.category_id <> 'SEC' then round((extract(epoch from (max(p.ts) filter (where p.kind = 'OUT') - min(p.ts) filter (where p.kind = 'IN'))) / 3600)::numeric, 1) end hours,
          max(p.shift) filter (where p.kind = 'IN') shift,
          bool_or(p.device_kind = 'mod') via_mod,
          max(p.photo_status) filter (where p.photo_status <> 'none') photo, max(p.live) live,
          max(g.st) st
        from punches p join associates a on a.id = p.associate_id
        left join sgd g on g.associate_id = a.id
        where p.store_code = v_store and p.work_date = p_date and a.category_id in (select _scope_cats(s))
          and (p_shift = 'B' or p.shift = p_shift)
        group by a.id
        union all
        select a.id, a.code, a.name, a.category_id, a.brand, a.vendor, null::text, null::text, null::numeric, g.shift, false, null::text, null::text, g.st
        from sgd g join associates a on a.id = g.associate_id
        where 'SEC' in (select _scope_cats(s)) and (p_shift = 'B' or g.shift = p_shift)
          and not exists (select 1 from punches p where p.associate_id = g.associate_id and p.work_date = p_date)) x),
    'regulars_missing', (
      select coalesce(json_agg(json_build_object('id', a.id, 'name', a.name, 'c', a.category_id, 'brand', a.brand, 'days', r.days) order by r.days desc), '[]')
      from (select p.associate_id, count(distinct p.work_date)::int days from punches p
            where p.store_code = v_store and p.kind = 'IN' and p.work_date between p_date - 7 and p_date - 1
            group by 1 having count(distinct p.work_date) >= 4) r
      join associates a on a.id = r.associate_id
      where a.category_id in (select _scope_cats(s))
        and not exists (select 1 from punches p where p.associate_id = a.id and p.work_date = p_date)
        and not exists (select 1 from compoffs c where c.associate_id = a.id and c.work_date = p_date)
        and not exists (select 1 from sg_exceptions e where e.associate_id = a.id and e.work_date = p_date)));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- statement: days keep in/out/hours (v4 compat) + st: P / H / A / CO / '' (future or today without punch). SEC: sg = raw SG status.
create or replace function public.statement(p_token uuid, p_associate bigint, p_from date, p_to date)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; a associates; v_today date := _ist_today();
begin
  s := _sess(p_token);
  select * into a from associates where id = p_associate;
  if not found or a.store_code not in (select _scope_stores(s)) or a.category_id not in (select _scope_cats(s)) then
    return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  return json_build_object('ok', true,
    'associate', json_build_object('id', a.id, 'code', a.code, 'name', a.name, 'c', a.category_id, 'brand', a.brand, 'vendor', a.vendor,
       'cat_name', (select name from categories where id = a.category_id)),
    'store', json_build_object('code', a.store_code, 'name', (select name from stores where store_code = a.store_code),
       'sg_set', (select sg_set from stores where store_code = a.store_code)),
    'from', p_from, 'to', p_to,
    'days', (select coalesce(json_agg(json_build_object('d', d.d::date,
        'in', to_char(x.fi at time zone 'Asia/Kolkata', 'HH24:MI'), 'out', to_char(x.lo at time zone 'Asia/Kolkata', 'HH24:MI'),
        'hours', round((extract(epoch from (x.lo - x.fi)) / 3600)::numeric, 1),
        'co', cx.co,
        'st', case when cx.co then 'CO'
                   when a.category_id = 'SEC' then case when g.st in ('P','P*','IN') then 'P' when g.st = 'H' then 'H'
                                                        when g.st in ('A','MP') then 'A' when d.d::date >= v_today then '' else 'A' end
                   when x.fi is not null then 'P'
                   when d.d::date >= v_today then '' else 'A' end,
        'sg', g.st) order by d.d), '[]')
      from generate_series(p_from, p_to, interval '1 day') d(d)
      cross join lateral (select exists (select 1 from compoffs c where c.associate_id = a.id and c.work_date = d.d::date) co) cx
      left join (select work_date, min(ts) filter (where kind = 'IN') fi, max(ts) filter (where kind = 'OUT') lo
                 from punches where associate_id = a.id and work_date between p_from and p_to group by 1) x on x.work_date = d.d::date
      left join (select y.work_date, y.st from _sg_status(p_from, p_to) y where a.category_id = 'SEC' and y.associate_id = a.id) g
        on g.work_date = d.d::date));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- =====================================================================================
-- @@ v5_d_requests_admin
-- =====================================================================================
create or replace function public.cr_create(p_token uuid, p_kind text, p_associate bigint, p_date date, p_payload jsonb, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; a associates; cfg settings; v_id bigint; v_payload jsonb := coalesce(p_payload, '{}'); v_rlpo text;
begin
  s := _sess_rw(p_token);
  if s.role <> 'store' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  select * into cfg from settings where id = 1;
  if not (_is_sg_kind(p_kind) or p_kind = any(cfg.edit_types)) then return json_build_object('ok', false, 'error', 'EDIT_TYPE_OFF'); end if;
  if length(btrim(coalesce(p_reason,''))) < 5 then return json_build_object('ok', false, 'error', 'REASON_REQUIRED'); end if;
  select * into a from associates where id = p_associate and store_code = s.store_code;
  if not found then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if p_kind = 'compoff' then
    if p_date is null or p_date > _ist_today() or p_date < _ist_today() - 45 then return json_build_object('ok', false, 'error', 'BAD_DATE'); end if;
    v_payload := jsonb_build_object('on', coalesce((v_payload->>'on')::boolean, true));
  elsif p_kind = 'staff' then
    v_payload := jsonb_build_object('old', jsonb_build_object('name', a.name, 'vendor', a.vendor, 'brand', a.brand),
      'new', jsonb_build_object('name', coalesce(nullif(btrim(v_payload->>'name'),''), a.name), 'vendor', coalesce(nullif(btrim(v_payload->>'vendor'),''), a.vendor),
                                'brand', coalesce(v_payload->>'brand', a.brand)));
  elsif _is_sg_kind(p_kind) then
    if a.category_id <> 'SEC' then return json_build_object('ok', false, 'error', 'NOT_SECURITY'); end if;
    if p_date is null or p_date > _ist_today() or p_date < _ist_today() - 45 then return json_build_object('ok', false, 'error', 'BAD_DATE'); end if;
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'in', left(nullif(btrim(v_payload->>'in'), ''), 5), 'out', left(nullif(btrim(v_payload->>'out'), ''), 5),
      'missing', left(nullif(btrim(v_payload->>'missing'), ''), 3),
      'sg', (select y.st from _sg_status(p_date, p_date) y where y.associate_id = a.id)));
    select rlpo_emp into v_rlpo from stores where store_code = s.store_code;
  end if;
  if exists (select 1 from change_requests where status = 'pending' and kind = p_kind and associate_id = a.id and work_date is not distinct from p_date) then
    return json_build_object('ok', false, 'error', 'ALREADY_PENDING'); end if;
  insert into change_requests(store_code, kind, associate_id, work_date, payload, reason, requested_by)
  values (s.store_code, p_kind, a.id, p_date, v_payload, left(btrim(p_reason), 300), s.emp_code) returning id into v_id;
  perform _log(s.emp_code, s.role, s.store_code, 'cr_create', null, p_kind || ' #' || v_id);
  return json_build_object('ok', true, 'id', v_id, 'route', case when _is_sg_kind(p_kind) then 'rlpo' else 'am' end,
    'no_rlpo', _is_sg_kind(p_kind) and v_rlpo is null);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

drop function if exists public.cr_decide(uuid, bigint, boolean, text);
create or replace function public.cr_decide(p_token uuid, p_id bigint, p_approve boolean, p_note text default null, p_status text default null)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; r change_requests; v_st text; v_ok boolean := p_approve; v_note text := left(nullif(btrim(coalesce(p_note,'')), ''), 300);
begin
  s := _sess_rw(p_token);
  if s.role not in ('am','rlpo') then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  select * into r from change_requests where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if r.status <> 'pending' then return json_build_object('ok', false, 'error', 'ALREADY_DECIDED'); end if;
  if not _can_decide(s, r) then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if _is_sg_kind(r.kind) then
    v_st := case when not coalesce(p_approve, false) then 'A' else upper(coalesce(nullif(btrim(p_status), ''), 'P')) end;
    if v_st not in ('P','H','A') then return json_build_object('ok', false, 'error', 'BAD_STATUS'); end if;
    v_ok := v_st <> 'A';
    insert into sg_exceptions(associate_id, work_date, status, reason, by_emp, cr_id)
    values (r.associate_id, r.work_date, v_st, coalesce(v_note, r.reason), s.emp_code, r.id)
    on conflict (associate_id, work_date) do update set status = excluded.status, reason = excluded.reason,
      by_emp = excluded.by_emp, at = now(), cr_id = excluded.cr_id;
  elsif p_approve then
    if r.kind = 'compoff' then
      if coalesce((r.payload->>'on')::boolean, true) then
        insert into compoffs(associate_id, work_date, marked_by) values (r.associate_id, r.work_date, r.requested_by) on conflict do nothing;
      else delete from compoffs where associate_id = r.associate_id and work_date = r.work_date; end if;
    elsif r.kind = 'staff' then
      update associates set name = r.payload->'new'->>'name', norm_name = _norm(r.payload->'new'->>'name'),
        vendor = r.payload->'new'->>'vendor', brand = coalesce(r.payload->'new'->>'brand', brand)
      where id = r.associate_id;
    end if;
  end if;
  update change_requests set status = case when v_ok then 'approved' else 'rejected' end, decided_by = s.emp_code, decided_at = now(),
    note = v_note, decision = v_st where id = p_id;
  perform _log(s.emp_code, s.role, r.store_code, case when _is_sg_kind(r.kind) then 'sg_approve' else 'approval' end, null,
    r.kind || ' #' || r.id || ' ' || case when v_ok then 'approved' else 'rejected' end || coalesce(' ' || v_st, '') || coalesce(' · ' || v_note, ''));
  return json_build_object('ok', true, 'status', case when v_ok then 'approved' else 'rejected' end, 'decision', v_st);
exception when unique_violation then return json_build_object('ok', false, 'error', 'DUPLICATE_NAME');
  when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public._cr_rows(s sessions, p_from timestamptz, p_to timestamptz, p_status text, p_group text)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', r.id, 'store', r.store_code, 'store_name', st.name, 'kind', r.kind,
      'group', case when _is_sg_kind(r.kind) then 'sg' else 'other' end,
      'date', r.work_date, 'payload', r.payload, 'reason', r.reason, 'status', r.status, 'note', r.note, 'decision', r.decision,
      'by', r.requested_by, 'by_name', ub.name, 'by_post', ub.post, 'assoc', a.name, 'assoc_code', a.code, 'assoc_id', a.id, 'cat', a.category_id,
      'decided_by', ud.name, 'decided_by_emp', r.decided_by, 'decided_by_role', ud.role,
      'at', to_char(r.created_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), 'created_at', r.created_at,
      'decided_at', to_char(r.decided_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'),
      'approver', case when _is_sg_kind(r.kind) then 'RLPO' else 'AM' end,
      'can_decide', _can_decide(s, r)) order by r.created_at desc), '[]')
  from change_requests r join stores st on st.store_code = r.store_code
  left join associates a on a.id = r.associate_id left join users ub on ub.emp_code = r.requested_by left join users ud on ud.emp_code = r.decided_by
  where r.store_code in (select _scope_stores(s))
    and (s.role <> 'rlpo' or _is_sg_kind(r.kind))
    and (p_group is null or p_group = 'all' or (p_group = 'sg' and _is_sg_kind(r.kind)) or (p_group in ('other','am','nonsg') and not _is_sg_kind(r.kind)))
    and (p_status is null or p_status = 'all' or r.status = p_status)
    and r.created_at >= p_from and r.created_at < p_to
$$;

create or replace function public.cr_list(p_token uuid, p_status text default 'pending', p_days int default 30)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  s := _sess(p_token);
  return json_build_object('ok', true, 'can_decide', s.role in ('am','rlpo') and s.view_by is null,
    'edit_types', (select edit_types from settings where id = 1),
    'rows', _cr_rows(s, now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 120)), now() + interval '1 minute', p_status, 'all'));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.cr_history(p_token uuid, p_from date, p_to date, p_group text default 'all')
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_from date := coalesce(p_from, _ist_today() - 30); v_to date := coalesce(p_to, _ist_today()); v_rows json;
begin
  s := _sess(p_token);
  if v_to < v_from then return json_build_object('ok', false, 'error', 'BAD_RANGE'); end if;
  if v_to - v_from > 400 then v_from := v_to - 400; end if;
  v_rows := _cr_rows(s, (v_from::timestamp at time zone 'Asia/Kolkata'), ((v_to + 1)::timestamp at time zone 'Asia/Kolkata'), 'all', p_group);
  return json_build_object('ok', true, 'from', v_from, 'to', v_to, 'group', coalesce(p_group, 'all'),
    'can_decide', s.role in ('am','rlpo') and s.view_by is null,
    'counts', (select json_build_object('pending', count(*) filter (where x->>'status' = 'pending'),
                 'approved', count(*) filter (where x->>'status' = 'approved'), 'rejected', count(*) filter (where x->>'status' = 'rejected'))
               from json_array_elements(v_rows) x),
    'rows', v_rows);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.rlpo_manual(p_token uuid, p_associate bigint, p_date date, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; a associates;
begin
  s := _sess_rw(p_token);
  if s.role <> 'rlpo' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  select * into a from associates where id = p_associate;
  if not found or a.category_id <> 'SEC'
     or not exists (select 1 from stores x where x.store_code = a.store_code and x.rlpo_emp = s.emp_code) then
    return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if p_date is null or p_date > _ist_today() or p_date < _ist_today() - 45 then return json_build_object('ok', false, 'error', 'BAD_DATE'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then return json_build_object('ok', false, 'error', 'REASON_REQUIRED'); end if;
  insert into sg_exceptions(associate_id, work_date, status, reason, by_emp)
  values (a.id, p_date, 'P*', left(btrim(p_reason), 300), s.emp_code)
  on conflict (associate_id, work_date) do update set status = 'P*', reason = excluded.reason, by_emp = excluded.by_emp, at = now(), cr_id = null;
  perform _log(s.emp_code, s.role, a.store_code, 'sg_approve', null, 'manual P* · ' || a.code || ' ' || p_date || ' · ' || left(btrim(p_reason), 200));
  return json_build_object('ok', true, 'status', 'P*');
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.hk_split_get(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; h record;
begin
  s := _sess(p_token);
  if s.role <> 'store' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  select * into h from _hk_state(_ist_today()) x where x.store_code = s.store_code;
  return json_build_object('ok', true, 'store', s.store_code, 'has_hk', h.store_code is not null,
    'total', h.hk_total, 'vendor', h.vendor, 'set', coalesce(h.split_set, false),
    'morning', case when h.split_set then h.morning end, 'evening', case when h.split_set then h.evening end,
    'effective_from', case when h.split_set then h.split_from end,
    'history', (select coalesce(json_agg(json_build_object('effective_from', x.effective_from, 'morning', x.morning, 'evening', x.evening,
                  'by', x.set_by, 'by_name', u.name, 'at', to_char(x.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI'))
                  order by x.effective_from desc, x.id desc), '[]')
                from (select * from hk_split where store_code = s.store_code order by effective_from desc, id desc limit 20) x
                left join users u on u.emp_code = x.set_by));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.hk_split_set(p_token uuid, p_morning int, p_evening int, p_effective date default null)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_eff date := coalesce(p_effective, _ist_today()); v_total int;
begin
  s := _sess_rw(p_token);
  if s.role <> 'store' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if v_eff < _ist_today() - 31 or v_eff > _ist_today() + 90 then return json_build_object('ok', false, 'error', 'BAD_DATE'); end if;
  if p_morning is null or p_evening is null or p_morning < 0 or p_evening < 0 then return json_build_object('ok', false, 'error', 'BAD_VALUE'); end if;
  select x.hk_total into v_total from _hk_state(greatest(v_eff, _ist_today())) x where x.store_code = s.store_code;
  if v_total is null then return json_build_object('ok', false, 'error', 'NO_HK_TOTAL'); end if;
  if p_morning + p_evening <> v_total then return json_build_object('ok', false, 'error', 'SUM_MISMATCH', 'total', v_total); end if;
  insert into hk_split(store_code, effective_from, morning, evening, set_by) values (s.store_code, v_eff, p_morning, p_evening, s.emp_code);
  perform _log(s.emp_code, s.role, s.store_code, 'hk_split', null, 'M ' || p_morning || ' / E ' || p_evening || ' from ' || v_eff);
  return json_build_object('ok', true, 'total', v_total, 'morning', p_morning, 'evening', p_evening, 'effective_from', v_eff);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------- admin ----------
create or replace function public.admin_get(p_token uuid, p_kind text)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_today date := _ist_today();
begin
  s := _admin(p_token);
  return json_build_object('ok', true, 'rows', case p_kind
    when 'stores' then (select coalesce(json_agg(to_jsonb(t) || jsonb_build_object('rlpo_mail', t.rlpo_emp, 'rlpo_name', ur.name,
          'hk_total', h.hk_total, 'hk_split_set', coalesce(h.split_set, h.store_code is null), 'hk_morning', h.morning, 'hk_evening', h.evening)
        order by t.store_code), '[]')
        from stores t left join users ur on ur.emp_code = t.rlpo_emp left join _hk_state(v_today) h on h.store_code = t.store_code)
    when 'users' then (select coalesce(json_agg(json_build_object('emp_code', u.emp_code, 'name', u.name, 'role', u.role, 'post', u.post,
        'store_code', u.store_code, 'dept', d.name, 'active', u.active, 'pin_set', u.pin_hash is not null,
        'locked', u.locked_until > now(), 'email', u.email, 'phone', u.phone, 'region', u.region, 'is_test', u.is_test,
        'has_code', u.setup_hash is not null and u.setup_exp > now(), 'store_name', (select name from stores where store_code = u.store_code),
        'last_login_ts', u.last_login_at, 'last_login', to_char(u.last_login_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')) order by u.role, u.emp_code), '[]')
        from users u left join departments d on d.id = u.dept_id)
    when 'rlpos' then (select coalesce(json_agg(json_build_object('mail', u.emp_code, 'emp_code', u.emp_code, 'name', u.name, 'phone', u.phone,
        'region', u.region, 'active', u.active, 'pin_set', u.pin_hash is not null, 'locked', u.locked_until > now(),
        'has_code', u.setup_hash is not null and u.setup_exp > now(), 'is_test', u.is_test,
        'last_login', to_char(u.last_login_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'),
        'stores', coalesce((select array_agg(x.store_code order by x.store_code) from stores x where x.rlpo_emp = u.emp_code), '{}'),
        'n_stores', (select count(*) from stores x where x.rlpo_emp = u.emp_code)) order by u.name), '[]')
        from users u where u.role = 'rlpo')
    when 'manpower' then (select coalesce(json_agg(json_build_object('store_code', r.store_code, 'category_id', r.category_id, 'brand', r.brand,
        'vendor', r.vendor, 'morning', r.morning, 'evening', r.evening,
        'effective_from', (select max(effective_from) from manpower m where m.store_code = r.store_code and m.category_id = r.category_id and m.brand = r.brand and m.effective_from <= v_today),
        'hk_total', h.hk_total, 'hk_split_set', case when r.category_id = 'HK' then coalesce(h.split_set, h.store_code is null) end,
        'sg_set', case when r.category_id = 'SEC' then st.sg_set end
        ) order by r.store_code, r.category_id, r.brand), '[]')
        from _req(v_today) r left join stores st on st.store_code = r.store_code
        left join _hk_state(v_today) h on h.store_code = r.store_code and r.category_id = 'HK' and r.brand = '')
    when 'departments' then (select coalesce(json_agg(to_jsonb(t) order by name), '[]') from departments t)
    when 'categories' then (select coalesce(json_agg(to_jsonb(t) order by sort), '[]') from categories t)
    when 'settings' then (select to_json(t) from settings t where id = 1)
    else null end);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.admin_rlpo_upsert(p_token uuid, p_rows jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; r jsonb; v_mail text; o users; n_new int := 0; n_upd int := 0; errs jsonb := '[]';
begin
  s := _admin(p_token);
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_mail := lower(btrim(coalesce(r->>'mail', r->>'email', r->>'emp_code', '')));
    begin
      if v_mail !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'BAD_MAIL'; end if;
      select * into o from users where emp_code = v_mail;
      if found and o.role <> 'rlpo' then raise exception 'MAIL_USED_BY_%', upper(o.role); end if;
      if not found then
        if nullif(btrim(r->>'name'), '') is null then raise exception 'NAME_REQUIRED'; end if;
        insert into users(emp_code, name, role, email, phone, region, active)
        values (v_mail, btrim(r->>'name'), 'rlpo', v_mail, nullif(btrim(r->>'phone'), ''), nullif(btrim(r->>'region'), ''),
                coalesce((r->>'active')::boolean, true));
        n_new := n_new + 1;
      else
        update users set name = coalesce(nullif(btrim(r->>'name'), ''), name),
          phone = case when r ? 'phone' then nullif(btrim(r->>'phone'), '') else phone end,
          region = case when r ? 'region' then nullif(btrim(r->>'region'), '') else region end,
          active = coalesce((r->>'active')::boolean, active)
        where emp_code = v_mail;
        n_upd := n_upd + 1;
      end if;
    exception when others then
      errs := errs || jsonb_build_object('mail', v_mail, 'error', SQLERRM);
    end;
  end loop;
  perform _log(s.emp_code, s.role, null, 'master_edit', null, 'rlpo · added ' || n_new || ' · updated ' || n_upd);
  return json_build_object('ok', true, 'added', n_new, 'updated', n_upd, 'errors', errs);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.admin_rlpo_map(p_token uuid, p_rows jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; r jsonb; v_code text; v_mail text; v_old text; n int := 0; errs jsonb := '[]';
begin
  s := _admin(p_token);
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_code := upper(btrim(coalesce(r->>'store', r->>'store_code', '')));
    v_mail := nullif(lower(btrim(coalesce(r->>'rlpo_mail', r->>'mail', ''))), '');
    select rlpo_emp into v_old from stores where store_code = v_code;
    if not found then errs := errs || jsonb_build_object('store', v_code, 'error', 'STORE_NOT_FOUND'); continue; end if;
    if v_mail is not null and not exists (select 1 from users where emp_code = v_mail and role = 'rlpo') then
      errs := errs || jsonb_build_object('store', v_code, 'error', 'RLPO_NOT_FOUND'); continue; end if;
    if v_old is distinct from v_mail then
      update stores set rlpo_emp = v_mail where store_code = v_code;
      perform _log(s.emp_code, s.role, v_code, 'master_edit', null, 'store · rlpo_emp: ' || coalesce(v_old, '—') || ' → ' || coalesce(v_mail, '—'));
      n := n + 1;
    end if;
  end loop;
  return json_build_object('ok', true, 'updated', n, 'errors', errs);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.admin_stores_upsert(p_token uuid, p_rows jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; r jsonb; o stores; n_new int := 0; n_upd int := 0; v_code text; chg text; errs jsonb := '[]';
  v_rlpo text; v_sg int; v_hk int; v_cur record; v_hkchg boolean;
begin
  s := _admin(p_token);
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_code := upper(btrim(r->>'store_code'));
    if v_code is null or v_code !~ '^[A-Z]{2}[0-9]{2}$' then
      errs := errs || jsonb_build_object('store', v_code, 'error', 'BAD_CODE'); continue; end if;
    begin
      select * into o from stores where store_code = v_code;
      v_hkchg := false;
      insert into stores(store_code, name, city, am_emp, zfm_emp, lat, lng, active, store_email, am_email, zfm_email)
      values (v_code, btrim(r->>'name'), nullif(btrim(r->>'city'),''), nullif(btrim(r->>'am_emp'),''), nullif(btrim(r->>'zfm_emp'),''),
              nullif(r->>'lat','')::double precision, nullif(r->>'lng','')::double precision, coalesce((r->>'active')::boolean, true),
              nullif(lower(btrim(r->>'store_email')),''), nullif(lower(btrim(r->>'am_email')),''), nullif(lower(btrim(r->>'zfm_email')),''))
      on conflict (store_code) do update set name = excluded.name, city = excluded.city, am_emp = excluded.am_emp, zfm_emp = excluded.zfm_emp,
         lat = coalesce(excluded.lat, stores.lat), lng = coalesce(excluded.lng, stores.lng), active = excluded.active,
         store_email = coalesce(excluded.store_email, stores.store_email), am_email = coalesce(excluded.am_email, stores.am_email),
         zfm_email = coalesce(excluded.zfm_email, stores.zfm_email);
      -- v5 fields (only when the key is present)
      if r ? 'rlpo_mail' or r ? 'rlpo_emp' then
        v_rlpo := nullif(lower(btrim(coalesce(r->>'rlpo_mail', r->>'rlpo_emp', ''))), '');
        if v_rlpo is not null and not exists (select 1 from users where emp_code = v_rlpo and role = 'rlpo') then raise exception 'RLPO_NOT_FOUND'; end if;
        update stores set rlpo_emp = v_rlpo where store_code = v_code;
      end if;
      if nullif(r->>'sg_set', '') is not null then
        v_sg := (r->>'sg_set')::numeric::int;
        if v_sg not in (8, 12) then raise exception 'BAD_SG_SET'; end if;
        update stores set sg_set = v_sg where store_code = v_code;
      end if;
      if nullif(r->>'hk_total', '') is not null then
        v_hk := (r->>'hk_total')::numeric::int;
        if v_hk < 0 then raise exception 'BAD_HK_TOTAL'; end if;
        select m.vendor, m.hk_total, m.morning, m.evening into v_cur from manpower m
         where m.store_code = v_code and m.category_id = 'HK' and m.brand = '' and m.effective_from <= _ist_today()
         order by m.effective_from desc, m.id desc limit 1;
        if v_cur is null or coalesce(v_cur.hk_total, v_cur.morning + v_cur.evening) is distinct from v_hk then
          insert into manpower(store_code, category_id, brand, vendor, morning, evening, hk_total, effective_from, uploaded_by)
          values (v_code, 'HK', '', v_cur.vendor, v_hk, 0, v_hk, _ist_today(), s.emp_code);
          v_hkchg := true;
          perform _log(s.emp_code, s.role, v_code, 'master_edit', null, 'hk_total: ' || coalesce(v_cur.hk_total::text, '—') || ' → ' || v_hk);
        end if;
      end if;
      if o.store_code is null then n_new := n_new + 1;
      else
        select string_agg(k || ': ' || coalesce(ov, '—') || ' → ' || coalesce(nv, '—'), '; ') into chg from (
          select x.key k, to_jsonb(o)->>x.key ov, to_jsonb(t)->>x.key nv
          from stores t, jsonb_object_keys(to_jsonb(t)) x(key) where t.store_code = v_code and x.key not in ('created_at')) d
        where ov is distinct from nv;
        if chg is not null then perform _log(s.emp_code, s.role, v_code, 'master_edit', null, 'store · ' || left(chg, 900)); end if;
        if chg is not null or v_hkchg then n_upd := n_upd + 1; end if;
      end if;
    exception when others then
      errs := errs || jsonb_build_object('store', v_code, 'error', SQLERRM);
    end;
  end loop;
  if n_new > 0 then perform _log(s.emp_code, s.role, null, 'master_edit', null, 'stores added · ' || n_new); end if;
  return json_build_object('ok', true, 'added', n_new, 'updated', n_upd, 'count', n_new + n_upd, 'errors', errs);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.admin_manpower_upload(p_token uuid, p_rows jsonb, p_effective date)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; n int; n_sg int := 0;
begin
  s := _admin(p_token);
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  insert into manpower(store_code, category_id, brand, vendor, morning, evening, hk_total, effective_from, uploaded_by)
  select upper(btrim(r->>'store_code')), c.id, coalesce(btrim(r->>'brand'), ''), nullif(btrim(r->>'vendor'),''),
         case when c.id = 'HK' and nullif(r->>'hk_total','') is not null then (r->>'hk_total')::numeric::int else coalesce((r->>'morning')::int, 0) end,
         case when c.id = 'HK' and nullif(r->>'hk_total','') is not null then 0 else coalesce((r->>'evening')::int, 0) end,
         case when c.id = 'HK' then nullif(r->>'hk_total','')::numeric::int end,
         coalesce(nullif(r->>'effective_from','')::date, p_effective), s.emp_code
  from jsonb_array_elements(p_rows) r
  join categories c on lower(c.id) = lower(btrim(r->>'category')) or lower(c.name) = lower(btrim(r->>'category'));
  get diagnostics n = row_count;
  update stores st set sg_set = x.v from (
    select distinct on (upper(btrim(r->>'store_code'))) upper(btrim(r->>'store_code')) code, (r->>'sg_set')::numeric::int v
    from jsonb_array_elements(p_rows) r
    join categories c on c.id = 'SEC' and (lower(c.id) = lower(btrim(r->>'category')) or lower(c.name) = lower(btrim(r->>'category')))
    where nullif(r->>'sg_set','') is not null and (r->>'sg_set')::numeric in (8, 12)) x
  where st.store_code = x.code and st.sg_set <> x.v;
  get diagnostics n_sg = row_count;
  perform _log(s.emp_code, s.role, null, 'master_edit', null, 'manpower rows · ' || n || ' from ' || p_effective || case when n_sg > 0 then ' · sg_set ' || n_sg else '' end);
  return json_build_object('ok', true, 'count', n, 'skipped', jsonb_array_length(p_rows) - n, 'sg_updated', n_sg);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.admin_settings_set(p_token uuid, p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; cfg settings;
begin
  s := _admin(p_token);
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  update settings set
    test_mode = coalesce((p->>'test_mode')::boolean, test_mode), live_check = coalesce((p->>'live_check')::boolean, live_check),
    radius_m = coalesce((p->>'radius_m')::int, radius_m),
    store_idle_min = coalesce((p->>'store_idle_min')::int, store_idle_min),
    pin_max_tries = coalesce((p->>'pin_max_tries')::int, pin_max_tries),
    pin_lock_min = coalesce((p->>'pin_lock_min')::int, pin_lock_min),
    storage_alert_pct = coalesce((p->>'storage_alert_pct')::int, storage_alert_pct),
    alert_email = coalesce(p->>'alert_email', alert_email),
    alert_m = coalesce((p->>'alert_m')::time, alert_m),
    alert_e = coalesce((p->>'alert_e')::time, alert_e),
    setup_days = coalesce((p->>'setup_days')::int, setup_days),
    edit_types = coalesce((select array_agg(x) from jsonb_array_elements_text(p->'edit_types') x where x in ('compoff','staff','missed_out','missed_in')), edit_types),
    sg12_a = coalesce((p->>'sg12_a')::numeric, sg12_a), sg12_p = coalesce((p->>'sg12_p')::numeric, sg12_p),
    sg8_a = coalesce((p->>'sg8_a')::numeric, sg8_a), sg8_p = coalesce((p->>'sg8_p')::numeric, sg8_p),
    idle_other_min = coalesce((p->>'idle_other_min')::int, idle_other_min),
    low_pct = coalesce((p->>'low_pct')::int, low_pct),
    low_days = coalesce((p->>'low_days')::int, low_days)
  where id = 1
  returning * into cfg;
  if not (0 <= cfg.sg8_a and cfg.sg8_a <= cfg.sg8_p and cfg.sg8_p <= 24 and 0 <= cfg.sg12_a and cfg.sg12_a <= cfg.sg12_p and cfg.sg12_p <= 24) then
    raise exception 'BAD_SG_HOURS'; end if;
  if cfg.low_pct not between 0 and 100 or cfg.low_days not between 1 and 31 or cfg.idle_other_min < 1 or cfg.store_idle_min < 1 then
    raise exception 'BAD_VALUE'; end if;
  perform _log(s.emp_code, s.role, null, 'settings', null, p::text);
  return json_build_object('ok', true);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------- permissions (same model as 005: anon executes the API, helpers private) ----------
revoke execute on function public._cr_rows(sessions, timestamptz, timestamptz, text, text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'cr_decide(uuid,bigint,boolean,text,text)', 'cr_history(uuid,date,date,text)', 'rlpo_manual(uuid,bigint,date,text)',
    'hk_split_get(uuid)', 'hk_split_set(uuid,int,int,date)', 'admin_rlpo_upsert(uuid,jsonb)', 'admin_rlpo_map(uuid,jsonb)']
  loop
    execute format('revoke execute on function public.%s from public, authenticated', f);
    execute format('grant execute on function public.%s to anon', f);
  end loop;
end $$;
