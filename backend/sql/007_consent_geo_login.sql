-- v2: consent log, store-login geo-fence, punch requires consent

create table if not exists public.consent_log (
  id bigserial primary key,
  ts timestamptz not null default now(),
  kind text not null check (kind in ('associate','user','mod_associate')),
  store_code text,
  device_id text,
  emp_code text,
  associate_name text,
  mod_emp text,
  policy_version text not null,
  lang text,
  user_agent text
);
create index if not exists consent_log_ts on public.consent_log (ts desc);
alter table public.consent_log enable row level security;

-- public: record consent given on a device (associate on own phone, or a user at login)
create or replace function public.consent_record(p_kind text, p_store text, p_device text, p_emp text, p_version text, p_lang text, p_ua text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('associate','user') then return json_build_object('ok', false, 'error', 'BAD_KIND'); end if;
  insert into consent_log(kind, store_code, device_id, emp_code, policy_version, lang, user_agent)
  values (p_kind, nullif(upper(btrim(coalesce(p_store,''))),''), left(p_device, 80), nullif(btrim(coalesce(p_emp,'')),''), left(p_version, 30), left(p_lang, 5), left(p_ua, 300));
  return json_build_object('ok', true);
end $$;

-- store login now needs location inside the geo-fence (unless test mode)
drop function if exists public.auth_login(text,text,text,text,bigint,text,text);
create or replace function public.auth_login(p_role text, p_emp text, p_post text, p_store text, p_dept bigint, p_pin text, p_device text,
  p_lat double precision default null, p_lng double precision default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare u users; st settings; other sessions; v_token uuid; v_left int; s stores; v_dist int;
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

  update sessions set ended_at = now(), end_reason = 'relogin'
   where emp_code = u.emp_code and ended_at is null and coalesce(device_id,'') = coalesce(p_device,'');

  insert into sessions(emp_code, role, store_code, device_id) values (u.emp_code, u.role, u.store_code, p_device)
  returning token into v_token;
  update users set last_login_at = now(), first_login_at = coalesce(first_login_at, now()) where emp_code = u.emp_code;
  perform _log(u.emp_code, u.role, u.store_code, 'login', null, case when v_dist is not null then v_dist || ' m' end);
  return json_build_object('ok', true, 'token', v_token, 'role', u.role, 'emp', u.emp_code, 'name', u.name,
    'post', u.post, 'store_code', u.store_code, 'store_name', (select name from stores where store_code = u.store_code),
    'dept', (select name from departments where id = u.dept_id));
end $$;

-- punch now requires consent; MOD punches log the associate's consent
drop function if exists public.punch_submit(text,text,text,text,text,double precision,double precision,text,uuid);
create or replace function public.punch_submit(p_store text, p_cat text, p_brand text, p_vendor text, p_name text,
  p_lat double precision, p_lng double precision, p_device text, p_mod_token uuid default null,
  p_consent boolean default false, p_policy text default null)
returns json language plpgsql security definer set search_path = public as $$
declare st stores; c categories; cfg settings; s sessions; a associates;
  v_dist int; v_today date := _ist_today(); v_now timestamp := _ist_now();
  v_last punches; v_kind text; v_shift text; v_seq int; v_req int; slot photo_slots;
  v_photo boolean := false; v_token uuid; v_name text := regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g');
  v_brand text := coalesce(p_brand,''); v_mod_emp text; v_dev_kind text := 'own';
begin
  if not coalesce(p_consent, false) then return json_build_object('ok', false, 'error', 'CONSENT_REQUIRED'); end if;
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
  if not cfg.test_mode then
    if p_lat is null then return json_build_object('ok', false, 'error', 'NO_GPS'); end if;
    if st.lat is not null and v_dist > cfg.radius_m then return json_build_object('ok', false, 'error', 'OUT_OF_RANGE', 'dist_m', v_dist, 'radius_m', cfg.radius_m); end if;
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

  if v_dev_kind = 'mod' then
    insert into consent_log(kind, store_code, device_id, emp_code, associate_name, mod_emp, policy_version)
    values ('mod_associate', st.store_code, left(p_device, 80), a.code, a.name, v_mod_emp, coalesce(left(p_policy, 30), '?'));
  end if;

  return json_build_object('ok', true, 'kind', v_kind, 'code', a.code, 'name', a.name, 'shift', v_shift,
    'time', to_char(v_now, 'HH24:MI'), 'dist_m', v_dist, 'photo_required', v_photo, 'photo_token', v_token);
exception when others then
  return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- admin: consent log
create or replace function public.consent_view(p_token uuid, p_from date, p_to date, p_kind text default null)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; d0 timestamptz; d1 timestamptz;
begin
  s := _admin(p_token);
  d0 := (p_from::timestamp) at time zone 'Asia/Kolkata'; d1 := ((p_to + 1)::timestamp) at time zone 'Asia/Kolkata';
  return json_build_object('ok', true,
    'counts', (select coalesce(json_object_agg(kind, n), '{}') from (select kind, count(*) n from consent_log where ts >= d0 and ts < d1 group by kind) x),
    'rows', (select coalesce(json_agg(json_build_object('at', to_char(l.ts at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), 'kind', l.kind,
        'store', l.store_code, 'emp', l.emp_code, 'user_name', u.name, 'associate', l.associate_name, 'mod_emp', l.mod_emp, 'mod_name', m.name,
        'version', l.policy_version, 'lang', l.lang, 'device', l.device_id, 'ua', l.user_agent) order by l.ts desc), '[]')
      from (select * from consent_log where ts >= d0 and ts < d1 and (p_kind is null or kind = p_kind) order by ts desc limit 2000) l
      left join users u on u.emp_code = l.emp_code left join users m on m.emp_code = l.mod_emp));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

revoke execute on function public.consent_record(text,text,text,text,text,text,text) from public, authenticated;
revoke execute on function public.auth_login(text,text,text,text,bigint,text,text,double precision,double precision) from public, authenticated;
revoke execute on function public.punch_submit(text,text,text,text,text,double precision,double precision,text,uuid,boolean,text) from public, authenticated;
revoke execute on function public.consent_view(uuid,date,date,text) from public, authenticated;
grant execute on function public.consent_record(text,text,text,text,text,text,text) to anon;
grant execute on function public.auth_login(text,text,text,text,bigint,text,text,double precision,double precision) to anon;
grant execute on function public.punch_submit(text,text,text,text,text,double precision,double precision,text,uuid,boolean,text) to anon;
grant execute on function public.consent_view(uuid,date,date,text) to anon;
