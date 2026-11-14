-- v3: security hardening, 7-day trend, admin "View as user" (read-only)

alter table public.sessions add column if not exists view_by text;

-- read-write session: refuses "View as" sessions
create or replace function public._sess_rw(p_token uuid)
returns sessions language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  s := _sess(p_token);
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  return s;
end $$;
revoke all on function public._sess_rw(uuid) from public, anon, authenticated;

-- every function that writes with a session token now uses _sess_rw
do $$
declare r record; d text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('mark_compoff', 'punch_submit') loop
    d := pg_get_functiondef(r.oid);
    if position('_sess(' in d) > 0 then
      execute replace(d, '_sess(', '_sess_rw(');
    end if;
  end loop;
  -- "active now" in the access log ignores View-as sessions
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'access_view' loop
    d := pg_get_functiondef(r.oid);
    execute replace(d, 'se.ended_at is null)', 'se.ended_at is null and se.view_by is null)');
  end loop;
end $$;

-- auth_me tells the page when it is a View-as session
create or replace function public.auth_me(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; u users;
begin
  s := _sess(p_token);
  select * into u from users where emp_code = s.emp_code;
  return json_build_object('ok', true, 'role', u.role, 'emp', u.emp_code, 'name', u.name, 'post', u.post,
    'store_code', u.store_code, 'store_name', (select name from stores where store_code = u.store_code),
    'dept', (select name from departments where id = u.dept_id),
    'view_by', s.view_by, 'view_by_name', (select name from users where emp_code = s.view_by));
exception when others then
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- login: progressive lock (3rd lock within 24 h = 24 h lock); View-as sessions never block a store
create or replace function public.auth_login(p_role text, p_emp text, p_post text, p_store text, p_dept bigint, p_pin text, p_device text,
  p_lat double precision default null, p_lng double precision default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare u users; st settings; other sessions; v_token uuid; v_left int; s stores; v_dist int; v_locks int; v_min int;
begin
  select * into st from settings where id = 1;
  u := _match_user(p_role, p_emp, p_post, p_store, p_dept);
  if u.emp_code is null then return json_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if u.pin_hash is null then return json_build_object('ok', false, 'error', 'PIN_NOT_SET'); end if;
  if u.locked_until is not null and u.locked_until > now() then
    return json_build_object('ok', false, 'error', 'LOCKED', 'locked_sec', ceil(extract(epoch from (u.locked_until - now())))::int);
  end if;

  if u.pin_hash <> crypt(coalesce(p_pin,''), u.pin_hash) then
    if u.failed_count + 1 >= st.pin_max_tries then
      select count(*) into v_locks from access_log where emp_code = u.emp_code and event = 'pin_lock' and ts > now() - interval '24 hours';
      v_min := case when v_locks >= 2 then 24 * 60 else st.pin_lock_min end;
      update users set failed_count = 0, locked_until = now() + make_interval(mins => v_min) where emp_code = u.emp_code;
      perform _log(u.emp_code, u.role, u.store_code, 'pin_lock', null, st.pin_max_tries || ' wrong PINs · ' || v_min || ' min');
      return json_build_object('ok', false, 'error', 'LOCKED', 'locked_sec', v_min * 60);
    end if;
    update users set failed_count = failed_count + 1 where emp_code = u.emp_code returning st.pin_max_tries - failed_count into v_left;
    return json_build_object('ok', false, 'error', 'WRONG_PIN', 'tries_left', v_left);
  end if;

  update users set failed_count = 0, locked_until = null where emp_code = u.emp_code;

  if u.role = 'store' then
    select * into s from stores where store_code = u.store_code;
    if not st.test_mode and s.lat is not null then
      if p_lat is null then return json_build_object('ok', false, 'error', 'NO_GPS'); end if;
      v_dist := _dist_m(p_lat, p_lng, s.lat, s.lng);
      if v_dist > st.radius_m then
        perform _log(u.emp_code, u.role, u.store_code, 'geo_block', null, v_dist || ' m');
        return json_build_object('ok', false, 'error', 'OUT_OF_RANGE', 'dist_m', v_dist, 'radius_m', st.radius_m);
      end if;
    end if;

    perform _sweep_sessions(u.store_code);
    select * into other from sessions
     where store_code = u.store_code and ended_at is null and view_by is null
       and not (emp_code = u.emp_code and coalesce(device_id,'') = coalesce(p_device,''))
     order by created_at desc limit 1;
    if found then
      perform _log(u.emp_code, u.role, u.store_code, 'store_busy', null, 'open on ' || other.emp_code);
      return json_build_object('ok', false, 'error', 'STORE_BUSY',
        'by_emp', other.emp_code,
        'by_name', (select name || ' (' || coalesce(post,'') || ')' from users where emp_code = other.emp_code),
        'since', to_char(other.created_at at time zone 'Asia/Kolkata', 'HH24:MI'),
        'last_seen', to_char(other.last_seen at time zone 'Asia/Kolkata', 'HH24:MI'),
        'unlock_at', to_char((other.last_seen + make_interval(mins => st.store_idle_min)) at time zone 'Asia/Kolkata', 'HH24:MI'));
    end if;
  end if;

  update sessions set ended_at = now(), end_reason = 'relogin'
   where emp_code = u.emp_code and ended_at is null and view_by is null and coalesce(device_id,'') = coalesce(p_device,'');

  insert into sessions(emp_code, role, store_code, device_id) values (u.emp_code, u.role, u.store_code, p_device)
  returning token into v_token;
  update users set last_login_at = now(), first_login_at = coalesce(first_login_at, now()) where emp_code = u.emp_code;
  perform _log(u.emp_code, u.role, u.store_code, 'login', null, case when v_dist is not null then v_dist || ' m' end);
  return json_build_object('ok', true, 'token', v_token, 'role', u.role, 'emp', u.emp_code, 'name', u.name,
    'post', u.post, 'store_code', u.store_code, 'store_name', (select name from stores where store_code = u.store_code),
    'dept', (select name from departments where id = u.dept_id));
end $$;

-- first PIN: never for Admin (Admin PIN only via Change PIN); store users must be inside the store when Test mode is OFF
drop function if exists public.auth_set_pin(text,text,text,text,bigint,text);
create or replace function public.auth_set_pin(p_role text, p_emp text, p_post text, p_store text, p_dept bigint, p_pin text,
  p_lat double precision default null, p_lng double precision default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare u users; st settings; s stores; v_dist int;
begin
  if p_pin !~ '^[0-9]{4}$' or p_pin in ('0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123','9876')
    then return json_build_object('ok', false, 'error', 'WEAK_PIN'); end if;
  u := _match_user(p_role, p_emp, p_post, p_store, p_dept);
  if u.emp_code is null then return json_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if u.role = 'admin' then return json_build_object('ok', false, 'error', 'ADMIN_SETUP'); end if;
  if u.pin_hash is not null then return json_build_object('ok', false, 'error', 'PIN_ALREADY_SET'); end if;
  select * into st from settings where id = 1;
  if u.role = 'store' and not st.test_mode then
    select * into s from stores where store_code = u.store_code;
    if s.lat is not null then
      if p_lat is null then return json_build_object('ok', false, 'error', 'NO_GPS'); end if;
      v_dist := _dist_m(p_lat, p_lng, s.lat, s.lng);
      if v_dist > st.radius_m then
        perform _log(u.emp_code, u.role, u.store_code, 'geo_block', null, 'set PIN · ' || v_dist || ' m');
        return json_build_object('ok', false, 'error', 'OUT_OF_RANGE', 'dist_m', v_dist, 'radius_m', st.radius_m);
      end if;
    end if;
  end if;
  update users set pin_hash = crypt(p_pin, gen_salt('bf')), failed_count = 0, locked_until = null where emp_code = u.emp_code;
  perform _log(u.emp_code, u.role, u.store_code, 'pin_set');
  return json_build_object('ok', true);
end $$;

-- change own PIN (old + new), any logged-in user
create or replace function public.change_pin(p_token uuid, p_old text, p_new text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare s sessions; u users;
begin
  s := _sess_rw(p_token);
  select * into u from users where emp_code = s.emp_code;
  if u.pin_hash is null or u.pin_hash <> crypt(coalesce(p_old,''), u.pin_hash) then
    perform _log(u.emp_code, u.role, u.store_code, 'pin_change_fail');
    return json_build_object('ok', false, 'error', 'WRONG_OLD_PIN'); end if;
  if p_new !~ '^[0-9]{4}$' or p_new = p_old or p_new in ('0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123','9876')
    then return json_build_object('ok', false, 'error', 'WEAK_PIN'); end if;
  update users set pin_hash = crypt(p_new, gen_salt('bf')), failed_count = 0, locked_until = null where emp_code = u.emp_code;
  update sessions set ended_at = now(), end_reason = 'pin_change' where emp_code = u.emp_code and ended_at is null and token <> p_token;
  perform _log(u.emp_code, u.role, u.store_code, 'pin_change');
  return json_build_object('ok', true);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- reset PIN: never for an Admin, never from a View-as session
create or replace function public.reset_pin(p_token uuid, p_emp text)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; u users;
begin
  s := _sess_rw(p_token);
  select * into u from users where emp_code = btrim(p_emp);
  if not found then return json_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if u.role = 'admin' then return json_build_object('ok', false, 'error', 'ADMIN_PROTECTED'); end if;
  if not (s.role = 'admin'
     or (s.role = 'zfm' and ((u.role = 'store' and u.store_code in (select _scope_stores(s)))
                          or (u.role = 'am' and u.emp_code in (select am_emp from stores where zfm_emp = s.emp_code))))) then
    return json_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  update users set pin_hash = null, failed_count = 0, locked_until = null where emp_code = u.emp_code;
  update sessions set ended_at = now(), end_reason = 'pin_reset' where emp_code = u.emp_code and ended_at is null;
  perform _log(u.emp_code, u.role, u.store_code, 'pin_reset', s.emp_code);
  return json_build_object('ok', true, 'name', u.name);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- Admin: open the portal as another user, read-only
create or replace function public.admin_view_as(p_token uuid, p_emp text)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; u users; v uuid;
begin
  s := _admin(p_token);
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  select * into u from users where emp_code = btrim(p_emp) and active;
  if not found then return json_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if u.role = 'admin' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  update sessions set ended_at = now(), end_reason = 'view_end' where view_by = s.emp_code and ended_at is null;
  insert into sessions(emp_code, role, store_code, device_id, view_by)
  values (u.emp_code, u.role, u.store_code, 'view', s.emp_code) returning token into v;
  perform _log(u.emp_code, u.role, u.store_code, 'view_as', s.emp_code);
  return json_build_object('ok', true, 'token', v, 'role', u.role, 'emp', u.emp_code, 'name', u.name, 'post', u.post,
    'store_code', u.store_code, 'store_name', (select name from stores where store_code = u.store_code),
    'dept', (select name from departments where id = u.dept_id), 'view_by', s.emp_code);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- 7-day trend (per day, per category) for the current scope and filters
create or replace function public.dash_trend(p_token uuid, p_end date, p_shift text default 'B',
  p_zfm text default null, p_am text default null, p_store text default null, p_days int default 7)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_days int := least(greatest(coalesce(p_days, 7), 1), 31);
begin
  s := _sess(p_token);
  return json_build_object('ok', true, 'end', p_end, 'days', v_days, 'rows', (
    with sc as (select st.store_code code from stores st
                where st.store_code in (select _scope_stores(s))
                  and (p_zfm is null or st.zfm_emp = p_zfm) and (p_am is null or st.am_emp = p_am)
                  and (p_store is null or st.store_code = p_store)),
    cs as (select _scope_cats(s) id),
    dd as (select (p_end - g)::date d from generate_series(0, v_days - 1) g),
    rq as (select dd.d, r.category_id c, sum(_shift_req(r.morning, r.evening, p_shift))::int req
           from dd cross join lateral _req(dd.d) r
           where r.store_code in (select code from sc) and r.category_id in (select id from cs) group by 1, 2),
    pr as (select p.work_date d, p.category_id c, count(distinct p.associate_id)::int n
           from punches p
           where p.work_date between p_end - (v_days - 1) and p_end and p.kind = 'IN'
             and p.store_code in (select code from sc) and p.category_id in (select id from cs)
             and (p_shift = 'B' or p.shift = p_shift) group by 1, 2),
    co as (select c.work_date d, a.category_id c, count(*)::int n
           from compoffs c join associates a on a.id = c.associate_id
           where c.work_date between p_end - (v_days - 1) and p_end and a.store_code in (select code from sc) group by 1, 2)
    select coalesce(json_agg(json_build_object('d', coalesce(rq.d, pr.d), 'c', coalesce(rq.c, pr.c),
             'req', greatest(coalesce(rq.req, 0) - coalesce(co.n, 0), 0), 'p', coalesce(pr.n, 0)) order by coalesce(rq.d, pr.d)), '[]')
    from rq full join pr on pr.d = rq.d and pr.c = rq.c
    left join co on co.d = coalesce(rq.d, pr.d) and co.c = coalesce(rq.c, pr.c)));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- permissions: only the API functions are callable by the website
revoke execute on function public.auth_set_pin(text,text,text,text,bigint,text,double precision,double precision) from public, authenticated;
revoke execute on function public.change_pin(uuid,text,text) from public, authenticated;
revoke execute on function public.admin_view_as(uuid,text) from public, authenticated;
revoke execute on function public.dash_trend(uuid,date,text,text,text,text,int) from public, authenticated;
grant execute on function public.auth_set_pin(text,text,text,text,bigint,text,double precision,double precision) to anon;
grant execute on function public.change_pin(uuid,text,text) to anon;
grant execute on function public.admin_view_as(uuid,text) to anon;
grant execute on function public.dash_trend(uuid,date,text,text,text,text,int) to anon;
