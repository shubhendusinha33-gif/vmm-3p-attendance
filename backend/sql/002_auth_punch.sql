-- ---------- helpers (internal) ----------
create or replace function public._ist_now() returns timestamp language sql stable
as $$ select (now() at time zone 'Asia/Kolkata') $$;

create or replace function public._ist_today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

create or replace function public._norm(t text) returns text language sql immutable
as $$ select lower(regexp_replace(btrim(coalesce(t,'')), '\s+', ' ', 'g')) $$;

create or replace function public._dist_m(a1 double precision, o1 double precision, a2 double precision, o2 double precision)
returns int language sql immutable as $$
  select round(2*6371000*asin(sqrt(
    power(sin(radians(a2-a1)/2),2) + cos(radians(a1))*cos(radians(a2))*power(sin(radians(o2-o1)/2),2))))::int
$$;

create or replace function public._log(p_emp text, p_role text, p_store text, p_event text, p_by text default null, p_detail text default null)
returns void language sql security definer set search_path = public as $$
  insert into access_log(emp_code, role, store_code, event, by_emp, detail)
  values (p_emp, p_role, p_store, p_event, p_by, p_detail)
$$;

-- end idle sessions (store role uses settings.store_idle_min, others 12h)
create or replace function public._sweep_sessions(p_store text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_idle int;
begin
  select store_idle_min into v_idle from settings where id = 1;
  for r in
    select s.* from sessions s
    where s.ended_at is null
      and (p_store is null or s.store_code = p_store)
      and ((s.role = 'store' and s.last_seen < now() - make_interval(mins => v_idle))
        or (s.role <> 'store' and s.last_seen < now() - interval '12 hours'))
  loop
    update sessions set ended_at = now(), end_reason = 'auto_logout' where token = r.token;
    perform _log(r.emp_code, r.role, r.store_code, 'auto_logout', null, 'idle');
  end loop;
end $$;

-- validate a token, refresh last_seen, return the session (raises on invalid)
create or replace function public._sess(p_token uuid)
returns sessions language plpgsql security definer set search_path = public as $$
declare s sessions; v_idle int;
begin
  select * into s from sessions where token = p_token;
  if not found or s.ended_at is not null then raise exception 'SESSION_EXPIRED'; end if;
  select store_idle_min into v_idle from settings where id = 1;
  if (s.role = 'store' and s.last_seen < now() - make_interval(mins => v_idle))
     or (s.role <> 'store' and s.last_seen < now() - interval '12 hours') then
    update sessions set ended_at = now(), end_reason = 'auto_logout' where token = p_token;
    perform _log(s.emp_code, s.role, s.store_code, 'auto_logout', null, 'idle');
    raise exception 'SESSION_EXPIRED';
  end if;
  update sessions set last_seen = now() where token = p_token returning * into s;
  return s;
end $$;

-- store codes visible to a session
create or replace function public._scope_stores(s sessions)
returns setof text language sql stable security definer set search_path = public as $$
  select st.store_code from stores st
  where st.active and (
    s.role in ('admin','hodept')
    or (s.role = 'store' and st.store_code = s.store_code)
    or (s.role = 'am'  and st.am_emp  = s.emp_code)
    or (s.role = 'zfm' and st.zfm_emp = s.emp_code))
$$;

-- category ids visible to a session (hodept = own department only)
create or replace function public._scope_cats(s sessions)
returns setof text language sql stable security definer set search_path = public as $$
  select c.id from categories c
  where c.active and (
    s.role <> 'hodept'
    or c.id = any (select unnest(d.category_ids) from users u join departments d on d.id = u.dept_id where u.emp_code = s.emp_code))
$$;

-- find the user matching a login attempt
create or replace function public._match_user(p_role text, p_emp text, p_post text, p_store text, p_dept bigint)
returns users language plpgsql stable security definer set search_path = public as $$
declare u users;
begin
  select * into u from users
  where emp_code = btrim(p_emp) and role = p_role and active
    and (p_role <> 'store'  or (post = p_post and store_code = upper(btrim(p_store))))
    and (p_role <> 'hodept' or dept_id = p_dept);
  return u;
end $$;

-- ---------- login (public) ----------
create or replace function public.login_options()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'departments', (select coalesce(json_agg(json_build_object('id', id, 'name', name) order by name), '[]') from departments))
$$;

create or replace function public.auth_check(p_role text, p_emp text, p_post text default null, p_store text default null, p_dept bigint default null)
returns json language plpgsql security definer set search_path = public as $$
declare u users;
begin
  u := _match_user(p_role, p_emp, p_post, p_store, p_dept);
  if u.emp_code is null then return json_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  return json_build_object('ok', true, 'name', u.name, 'pin_set', u.pin_hash is not null,
    'store_name', (select name from stores where store_code = u.store_code),
    'locked_sec', greatest(0, ceil(extract(epoch from (coalesce(u.locked_until, now()) - now()))))::int);
end $$;

create or replace function public.auth_set_pin(p_role text, p_emp text, p_post text, p_store text, p_dept bigint, p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare u users;
begin
  if p_pin !~ '^[0-9]{4}$' then return json_build_object('ok', false, 'error', 'BAD_PIN'); end if;
  u := _match_user(p_role, p_emp, p_post, p_store, p_dept);
  if u.emp_code is null then return json_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if u.pin_hash is not null then return json_build_object('ok', false, 'error', 'PIN_ALREADY_SET'); end if;
  update users set pin_hash = crypt(p_pin, gen_salt('bf')), failed_count = 0, locked_until = null where emp_code = u.emp_code;
  perform _log(u.emp_code, u.role, u.store_code, 'pin_set');
  return json_build_object('ok', true);
end $$;

create or replace function public.auth_login(p_role text, p_emp text, p_post text, p_store text, p_dept bigint, p_pin text, p_device text)
returns json language plpgsql security definer set search_path = public as $$
declare u users; st settings; other sessions; v_token uuid; v_left int;
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
      update users set failed_count = 0, locked_until = now() + make_interval(mins => st.pin_lock_min) where emp_code = u.emp_code;
      perform _log(u.emp_code, u.role, u.store_code, 'pin_lock', null, st.pin_max_tries || ' wrong PINs');
      return json_build_object('ok', false, 'error', 'LOCKED', 'locked_sec', st.pin_lock_min * 60);
    end if;
    update users set failed_count = failed_count + 1 where emp_code = u.emp_code returning st.pin_max_tries - failed_count into v_left;
    return json_build_object('ok', false, 'error', 'WRONG_PIN', 'tries_left', v_left);
  end if;

  update users set failed_count = 0, locked_until = null where emp_code = u.emp_code;

  if u.role = 'store' then
    perform _sweep_sessions(u.store_code);
    select * into other from sessions
     where store_code = u.store_code and ended_at is null
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

  -- same person re-logging on the same device: close the old session
  update sessions set ended_at = now(), end_reason = 'relogin'
   where emp_code = u.emp_code and ended_at is null and coalesce(device_id,'') = coalesce(p_device,'');

  insert into sessions(emp_code, role, store_code, device_id) values (u.emp_code, u.role, u.store_code, p_device)
  returning token into v_token;
  update users set last_login_at = now(), first_login_at = coalesce(first_login_at, now()) where emp_code = u.emp_code;
  perform _log(u.emp_code, u.role, u.store_code, 'login');
  return json_build_object('ok', true, 'token', v_token, 'role', u.role, 'emp', u.emp_code, 'name', u.name,
    'post', u.post, 'store_code', u.store_code, 'store_name', (select name from stores where store_code = u.store_code),
    'dept', (select name from departments where id = u.dept_id));
end $$;

create or replace function public.auth_me(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; u users;
begin
  s := _sess(p_token);
  select * into u from users where emp_code = s.emp_code;
  return json_build_object('ok', true, 'role', u.role, 'emp', u.emp_code, 'name', u.name, 'post', u.post,
    'store_code', u.store_code, 'store_name', (select name from stores where store_code = u.store_code),
    'dept', (select name from departments where id = u.dept_id));
exception when others then
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.auth_logout(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  select * into s from sessions where token = p_token and ended_at is null;
  if found then
    update sessions set ended_at = now(), end_reason = 'logout' where token = p_token;
    perform _log(s.emp_code, s.role, s.store_code, 'logout');
  end if;
  return json_build_object('ok', true);
end $$;

-- ---------- punch (public, from store QR) ----------
create or replace function public.punch_context(p_store text)
returns json language plpgsql security definer set search_path = public as $$
declare st stores; cfg settings;
begin
  select * into st from stores where store_code = upper(btrim(p_store)) and active;
  if not found then return json_build_object('ok', false, 'error', 'STORE_NOT_FOUND'); end if;
  select * into cfg from settings where id = 1;
  return json_build_object('ok', true,
    'store', json_build_object('code', st.store_code, 'name', st.name, 'mapped', st.lat is not null),
    'test_mode', cfg.test_mode, 'radius_m', cfg.radius_m,
    'categories', (select coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'name_hi', c.name_hi, 'brands', c.brands,
        'vendors', (select coalesce(json_agg(distinct v), '[]') from (
            select m.vendor v from manpower m where m.store_code = st.store_code and m.category_id = c.id and m.vendor is not null
            union select a.vendor from associates a where a.store_code = st.store_code and a.category_id = c.id and a.vendor is not null) x))
        order by c.sort), '[]') from categories c where c.active));
end $$;

create or replace function public.punch_lookup(p_store text, p_cat text, p_brand text, p_name text)
returns json language plpgsql security definer set search_path = public as $$
declare a associates; last_kind text;
begin
  select * into a from associates
   where store_code = upper(btrim(p_store)) and category_id = p_cat and brand = coalesce(p_brand,'') and norm_name = _norm(p_name);
  if not found then return json_build_object('ok', true, 'exists', false, 'next', 'IN'); end if;
  select kind into last_kind from punches where associate_id = a.id and work_date = _ist_today() order by ts desc limit 1;
  return json_build_object('ok', true, 'exists', true, 'code', a.code, 'name', a.name,
    'next', case when last_kind = 'IN' then 'OUT' else 'IN' end);
end $$;

-- associates already seen at this store today / recently, for the MOD picker
create or replace function public.store_roster(p_token uuid, p_cat text)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  s := _sess(p_token);
  if s.role <> 'store' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  return json_build_object('ok', true, 'rows', (
    select coalesce(json_agg(r order by r.name), '[]') from (
      select a.id, a.code, a.name, a.brand, a.vendor,
        (select p.kind from punches p where p.associate_id = a.id and p.work_date = _ist_today() order by p.ts desc limit 1) as last_kind,
        (select to_char(p.ts at time zone 'Asia/Kolkata','HH24:MI') from punches p where p.associate_id = a.id and p.work_date = _ist_today() order by p.ts desc limit 1) as last_time
      from associates a
      where a.store_code = s.store_code and a.category_id = p_cat
        and exists (select 1 from punches p where p.associate_id = a.id and p.work_date >= _ist_today() - 30)) r));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.punch_submit(p_store text, p_cat text, p_brand text, p_vendor text, p_name text,
  p_lat double precision, p_lng double precision, p_device text, p_mod_token uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare st stores; c categories; cfg settings; s sessions; a associates;
  v_dist int; v_today date := _ist_today(); v_now timestamp := _ist_now();
  v_last punches; v_kind text; v_shift text; v_seq int; v_req int; slot photo_slots;
  v_photo boolean := false; v_token uuid; v_name text := regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g');
  v_brand text := coalesce(p_brand,''); v_mod_emp text; v_dev_kind text := 'own';
begin
  select * into cfg from settings where id = 1;
  select * into st from stores where store_code = upper(btrim(p_store)) and active;
  if not found then return json_build_object('ok', false, 'error', 'STORE_NOT_FOUND'); end if;
  select * into c from categories where id = p_cat and active;
  if not found then return json_build_object('ok', false, 'error', 'BAD_CATEGORY'); end if;
  if cardinality(c.brands) > 0 and not (v_brand = any (c.brands)) then return json_build_object('ok', false, 'error', 'BRAND_REQUIRED'); end if;
  if cardinality(c.brands) = 0 then v_brand := ''; end if;
  if v_name !~ '^[[:alpha:] .]{2,40}$' then return json_build_object('ok', false, 'error', 'BAD_NAME'); end if;

  if p_mod_token is not null then
    s := _sess(p_mod_token);
    if s.role <> 'store' or s.store_code <> st.store_code then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
    v_mod_emp := s.emp_code; v_dev_kind := 'mod';
  end if;

  if p_lat is not null and st.lat is not null then v_dist := _dist_m(p_lat, p_lng, st.lat, st.lng); end if;
  if not cfg.test_mode and st.lat is not null then
    if p_lat is null then return json_build_object('ok', false, 'error', 'NO_GPS'); end if;
    if v_dist > cfg.radius_m then return json_build_object('ok', false, 'error', 'OUT_OF_RANGE', 'dist_m', v_dist, 'radius_m', cfg.radius_m); end if;
  end if;

  select * into a from associates where store_code = st.store_code and category_id = c.id and brand = v_brand and norm_name = _norm(v_name);
  if not found then
    select count(*) + 1 into v_seq from associates where store_code = st.store_code and category_id = c.id;
    insert into associates(code, store_code, category_id, brand, vendor, name, norm_name)
    values (c.id || '-' || st.store_code || '-' || lpad(v_seq::text, 3, '0'), st.store_code, c.id, v_brand, nullif(btrim(p_vendor),''), v_name, _norm(v_name))
    returning * into a;
  elsif nullif(btrim(p_vendor),'') is not null and a.vendor is distinct from btrim(p_vendor) then
    update associates set vendor = btrim(p_vendor) where id = a.id returning * into a;
  end if;

  select * into v_last from punches where associate_id = a.id and work_date = v_today order by ts desc limit 1;
  if found and v_last.ts > now() - interval '2 minutes' then
    return json_build_object('ok', false, 'error', 'DUPLICATE', 'last_kind', v_last.kind);
  end if;
  v_kind := case when v_last.kind = 'IN' then 'OUT' else 'IN' end;
  v_shift := case when v_kind = 'OUT' and v_last.shift is not null then v_last.shift
                  when extract(hour from v_now) < 14 then 'M' else 'E' end;

  -- random photo: one per store / day / photo group
  if v_kind = 'IN' and c.photo_group is not null then
    select * into slot from photo_slots where store_code = st.store_code and work_date = v_today and grp = c.photo_group for update;
    if not found then
      select coalesce(sum(x.morning + x.evening), 1) into v_req from (
        select distinct on (m.category_id, m.brand) m.morning, m.evening
        from manpower m join categories cc on cc.id = m.category_id
        where m.store_code = st.store_code and cc.photo_group = c.photo_group and m.effective_from <= v_today
        order by m.category_id, m.brand, m.effective_from desc, m.id desc) x;
      insert into photo_slots(store_code, work_date, grp, target_n)
      values (st.store_code, v_today, c.photo_group, 1 + floor(random() * greatest(v_req, 1))::int)
      on conflict do nothing;
      select * into slot from photo_slots where store_code = st.store_code and work_date = v_today and grp = c.photo_group for update;
    end if;
    update photo_slots set seen_n = seen_n + 1 where store_code = slot.store_code and work_date = slot.work_date and grp = slot.grp returning * into slot;
    if not slot.taken and slot.seen_n >= slot.target_n then
      update photo_slots set taken = true where store_code = slot.store_code and work_date = slot.work_date and grp = slot.grp;
      v_photo := true; v_token := gen_random_uuid();
    end if;
  end if;

  insert into punches(associate_id, store_code, category_id, brand, vendor, work_date, kind, shift, lat, lng, dist_m,
                      device_kind, device_id, mod_emp, photo_status, photo_token)
  values (a.id, st.store_code, c.id, v_brand, a.vendor, v_today, v_kind, v_shift, p_lat, p_lng, v_dist,
          v_dev_kind, p_device, v_mod_emp, case when v_photo then 'pending' else 'none' end, v_token);

  return json_build_object('ok', true, 'kind', v_kind, 'code', a.code, 'name', a.name, 'shift', v_shift,
    'time', to_char(v_now, 'HH24:MI'), 'dist_m', v_dist, 'photo_required', v_photo, 'photo_token', v_token);
exception when others then
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------- permissions ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.login_options() to anon;
grant execute on function public.auth_check(text,text,text,text,bigint) to anon;
grant execute on function public.auth_set_pin(text,text,text,text,bigint,text) to anon;
grant execute on function public.auth_login(text,text,text,text,bigint,text,text) to anon;
grant execute on function public.auth_me(uuid) to anon;
grant execute on function public.auth_logout(uuid) to anon;
grant execute on function public.punch_context(text) to anon;
grant execute on function public.punch_lookup(text,text,text,text) to anon;
grant execute on function public.store_roster(uuid,text) to anon;
grant execute on function public.punch_submit(text,text,text,text,text,double precision,double precision,text,uuid) to anon;
