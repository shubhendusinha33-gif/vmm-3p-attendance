-- v4: store self-registration (5 posts), setup codes, change requests (AM approves), store team / vacate,
--     7-day week data, alert times, liveness flag, emails, test-data flag

-- ---------- schema ----------
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.users'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%post%' loop
    execute format('alter table public.users drop constraint %I', c);
  end loop;
end $$;
update public.users set post = 'DM GM' where post = 'MOD';
alter table public.users add constraint users_post_check check (post in ('SM','ASM','DM Apps','DM FMCG','DM GM'));
alter table public.users
  add column if not exists email text,
  add column if not exists setup_hash text,
  add column if not exists setup_exp timestamptz,
  add column if not exists is_test boolean not null default false,
  add column if not exists vacated_at timestamptz,
  add column if not exists vacated_reason text;
create unique index if not exists users_one_post_per_store on public.users(store_code, post) where role = 'store' and active;

alter table public.stores
  add column if not exists store_email text,
  add column if not exists am_email text,
  add column if not exists zfm_email text,
  add column if not exists is_test boolean not null default false;
alter table public.departments add column if not exists active boolean not null default true;
alter table public.settings
  add column if not exists alert_m time not null default '10:00',
  add column if not exists alert_e time not null default '16:00',
  add column if not exists edit_types text[] not null default '{compoff,staff}',
  add column if not exists setup_days int not null default 7;
alter table public.punches add column if not exists live text;

create table if not exists public.change_requests (
  id bigserial primary key,
  store_code text not null references public.stores(store_code),
  kind text not null check (kind in ('compoff','staff','missed_out','missed_in')),
  associate_id bigint references public.associates(id),
  work_date date,
  payload jsonb not null default '{}',
  reason text not null,
  requested_by text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by text,
  decided_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
alter table public.change_requests enable row level security;
create index if not exists change_requests_store_status on public.change_requests(store_code, status);

-- ---------- helpers ----------
create or replace function public._new_code(p_emp text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v text; d int;
begin
  select setup_days into d from settings where id = 1;
  v := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  update users set setup_hash = crypt(v, gen_salt('bf')), setup_exp = now() + make_interval(days => d) where emp_code = p_emp;
  return v;
end $$;

create or replace function public._weak_pin(p text) returns boolean language sql immutable as $$
  select p !~ '^[0-9]{4}$' or p in ('0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123','9876','2345','5678','1212','1122')
$$;

-- ---------- login: check / register / set PIN ----------
create or replace function public.auth_check(p_role text, p_emp text, p_post text default null, p_store text default null, p_dept bigint default null)
returns json language plpgsql security definer set search_path = public as $$
declare u users; x users; st stores;
begin
  if btrim(coalesce(p_emp,'')) !~ '^[0-9]{5,}$' then return json_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
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
  return json_build_object('ok', true, 'name', u.name, 'pin_set', u.pin_hash is not null,
    'need_code', u.role <> 'store' and u.pin_hash is null,
    'store_name', (select name from stores where store_code = u.store_code),
    'locked_sec', greatest(0, ceil(extract(epoch from (coalesce(u.locked_until, now()) - now()))))::int);
end $$;

create or replace function public.auth_register(p_emp text, p_post text, p_store text, p_name text, p_pin text,
  p_lat double precision default null, p_lng double precision default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare st stores; cfg settings; x users; v_dist int; v_name text := regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g');
begin
  if btrim(coalesce(p_emp,'')) !~ '^[0-9]{5,}$' then return json_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if p_post not in ('SM','ASM','DM Apps','DM FMCG','DM GM') then return json_build_object('ok', false, 'error', 'BAD_POST'); end if;
  if length(v_name) < 3 or length(v_name) > 60 or v_name !~ '^[A-Za-z][A-Za-z .]+$' then return json_build_object('ok', false, 'error', 'BAD_NAME'); end if;
  if _weak_pin(p_pin) then return json_build_object('ok', false, 'error', 'WEAK_PIN'); end if;
  select * into st from stores where store_code = upper(btrim(p_store)) and active;
  if not found then return json_build_object('ok', false, 'error', 'STORE_NOT_FOUND'); end if;
  select * into cfg from settings where id = 1;
  if not cfg.test_mode and st.lat is not null then
    if p_lat is null then return json_build_object('ok', false, 'error', 'NO_GPS'); end if;
    v_dist := _dist_m(p_lat, p_lng, st.lat, st.lng);
    if v_dist > cfg.radius_m then
      perform _log(btrim(p_emp), 'store', st.store_code, 'geo_block', null, 'register · ' || v_dist || ' m');
      return json_build_object('ok', false, 'error', 'OUT_OF_RANGE', 'dist_m', v_dist, 'radius_m', cfg.radius_m);
    end if;
  end if;
  select * into x from users where emp_code = btrim(p_emp);
  if found and x.active then return json_build_object('ok', false, 'error', 'EMP_ELSEWHERE'); end if;
  if found and x.role <> 'store' then return json_build_object('ok', false, 'error', 'EMP_ELSEWHERE'); end if;
  if exists (select 1 from users where role = 'store' and active and store_code = st.store_code and post = p_post) then
    return json_build_object('ok', false, 'error', 'POST_TAKEN'); end if;
  insert into users(emp_code, name, role, post, store_code, pin_hash, active, is_test)
  values (btrim(p_emp), initcap(v_name), 'store', p_post, st.store_code, crypt(p_pin, gen_salt('bf')), true, st.is_test)
  on conflict (emp_code) do update set name = excluded.name, role = 'store', post = excluded.post, store_code = excluded.store_code,
    pin_hash = excluded.pin_hash, active = true, failed_count = 0, locked_until = null, vacated_at = null, vacated_reason = null;
  perform _log(btrim(p_emp), 'store', st.store_code, 'register', null, p_post || case when v_dist is not null then ' · ' || v_dist || ' m' else '' end);
  return json_build_object('ok', true);
exception when unique_violation then return json_build_object('ok', false, 'error', 'POST_TAKEN');
  when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

drop function if exists public.auth_set_pin(text,text,text,text,bigint,text,double precision,double precision);
create or replace function public.auth_set_pin(p_role text, p_emp text, p_post text, p_store text, p_dept bigint, p_pin text,
  p_lat double precision default null, p_lng double precision default null, p_code text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare u users; st settings; s stores; v_dist int;
begin
  if _weak_pin(p_pin) then return json_build_object('ok', false, 'error', 'WEAK_PIN'); end if;
  u := _match_user(p_role, p_emp, p_post, p_store, p_dept);
  if u.emp_code is null then return json_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if u.pin_hash is not null then return json_build_object('ok', false, 'error', 'PIN_ALREADY_SET'); end if;
  if u.locked_until is not null and u.locked_until > now() then
    return json_build_object('ok', false, 'error', 'LOCKED', 'locked_sec', ceil(extract(epoch from (u.locked_until - now())))::int); end if;
  select * into st from settings where id = 1;
  if u.role <> 'store' then
    if u.setup_hash is null or u.setup_exp < now() then return json_build_object('ok', false, 'error', 'CODE_EXPIRED'); end if;
    if u.setup_hash <> crypt(coalesce(btrim(p_code), ''), u.setup_hash) then
      if u.failed_count + 1 >= st.pin_max_tries then
        update users set failed_count = 0, locked_until = now() + make_interval(mins => st.pin_lock_min) where emp_code = u.emp_code;
        perform _log(u.emp_code, u.role, null, 'pin_lock', null, 'wrong setup code');
        return json_build_object('ok', false, 'error', 'LOCKED', 'locked_sec', st.pin_lock_min * 60);
      end if;
      update users set failed_count = failed_count + 1 where emp_code = u.emp_code;
      return json_build_object('ok', false, 'error', 'BAD_CODE');
    end if;
  elsif not st.test_mode then
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
  update users set pin_hash = crypt(p_pin, gen_salt('bf')), failed_count = 0, locked_until = null, setup_hash = null, setup_exp = null
   where emp_code = u.emp_code;
  perform _log(u.emp_code, u.role, u.store_code, 'pin_set');
  return json_build_object('ok', true);
end $$;

-- ---------- PIN reset (AM/ZFM/HO/Admin get a new setup code) ----------
create or replace function public.reset_pin(p_token uuid, p_emp text)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; u users; v_code text;
begin
  s := _sess_rw(p_token);
  select * into u from users where emp_code = btrim(p_emp);
  if not found then return json_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if u.role = 'admin' and not (s.role = 'admin' and s.emp_code <> u.emp_code) then
    return json_build_object('ok', false, 'error', 'ADMIN_PROTECTED'); end if;
  if not (s.role = 'admin'
     or (s.role = 'zfm' and ((u.role = 'store' and u.store_code in (select _scope_stores(s)))
                          or (u.role = 'am' and u.emp_code in (select am_emp from stores where zfm_emp = s.emp_code))))) then
    return json_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;
  update users set pin_hash = null, failed_count = 0, locked_until = null where emp_code = u.emp_code;
  update sessions set ended_at = now(), end_reason = 'pin_reset' where emp_code = u.emp_code and ended_at is null;
  if u.role <> 'store' then v_code := _new_code(u.emp_code); end if;
  perform _log(u.emp_code, u.role, u.store_code, 'pin_reset', s.emp_code);
  return json_build_object('ok', true, 'name', u.name, 'code', v_code);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- Admin: new setup codes for AM / ZFM / HO / Admin users with no PIN (for invite mails)
create or replace function public.admin_issue_codes(p_token uuid, p_emps text[])
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; r record; out jsonb := '[]';
begin
  s := _admin(p_token);
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  for r in select emp_code from users where emp_code = any(p_emps) and active and role <> 'store' and pin_hash is null loop
    out := out || jsonb_build_object('emp', r.emp_code, 'code', _new_code(r.emp_code));
  end loop;
  perform _log(s.emp_code, s.role, null, 'codes_issued', null, jsonb_array_length(out) || ' users');
  return json_build_object('ok', true, 'rows', out, 'days', (select setup_days from settings where id = 1));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------- store team / vacate (AM or Admin) ----------
create or replace function public.store_team(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  s := _sess(p_token);
  if s.role not in ('am','zfm','admin') then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  return json_build_object('ok', true, 'can_vacate', s.role in ('am','admin'),
    'stores', (select coalesce(json_agg(json_build_object('code', st.store_code, 'name', st.name) order by st.store_code), '[]')
               from stores st where st.store_code in (select _scope_stores(s))),
    'rows', (select coalesce(json_agg(json_build_object('emp', u.emp_code, 'name', u.name, 'post', u.post, 'store', u.store_code,
               'pin_set', u.pin_hash is not null, 'last_login', to_char(u.last_login_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'))
               order by u.store_code, u.post), '[]')
             from users u where u.role = 'store' and u.active and u.store_code in (select _scope_stores(s))));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.store_vacate(p_token uuid, p_emp text, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; u users;
begin
  s := _sess_rw(p_token);
  if s.role not in ('am','admin') then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then return json_build_object('ok', false, 'error', 'REASON_REQUIRED'); end if;
  select * into u from users where emp_code = btrim(p_emp) and role = 'store' and active;
  if not found or u.store_code not in (select _scope_stores(s)) then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  update users set active = false, pin_hash = null, vacated_at = now(), vacated_reason = left(btrim(p_reason), 200) where emp_code = u.emp_code;
  update sessions set ended_at = now(), end_reason = 'vacated' where emp_code = u.emp_code and ended_at is null;
  perform _log(u.emp_code, u.role, u.store_code, 'vacate', s.emp_code, u.post || ' · ' || left(btrim(p_reason), 200));
  return json_build_object('ok', true, 'name', u.name, 'post', u.post);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------- change requests: store asks, AM (or Admin) decides ----------
create or replace function public.cr_create(p_token uuid, p_kind text, p_associate bigint, p_date date, p_payload jsonb, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; a associates; cfg settings; v_id bigint; v_payload jsonb := coalesce(p_payload, '{}');
begin
  s := _sess_rw(p_token);
  if s.role <> 'store' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  select * into cfg from settings where id = 1;
  if not (p_kind = any(cfg.edit_types)) then return json_build_object('ok', false, 'error', 'EDIT_TYPE_OFF'); end if;
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
  end if;
  if exists (select 1 from change_requests where status = 'pending' and kind = p_kind and associate_id = a.id and work_date is not distinct from p_date) then
    return json_build_object('ok', false, 'error', 'ALREADY_PENDING'); end if;
  insert into change_requests(store_code, kind, associate_id, work_date, payload, reason, requested_by)
  values (s.store_code, p_kind, a.id, p_date, v_payload, left(btrim(p_reason), 300), s.emp_code) returning id into v_id;
  perform _log(s.emp_code, s.role, s.store_code, 'cr_create', null, p_kind || ' #' || v_id);
  return json_build_object('ok', true, 'id', v_id);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.cr_list(p_token uuid, p_status text default 'pending', p_days int default 30)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  s := _sess(p_token);
  return json_build_object('ok', true, 'can_decide', s.role in ('am','admin') and s.view_by is null,
    'edit_types', (select edit_types from settings where id = 1),
    'rows', (select coalesce(json_agg(json_build_object('id', r.id, 'store', r.store_code, 'store_name', st.name, 'kind', r.kind,
        'date', r.work_date, 'payload', r.payload, 'reason', r.reason, 'status', r.status, 'note', r.note,
        'by', r.requested_by, 'by_name', ub.name, 'by_post', ub.post, 'assoc', a.name, 'assoc_code', a.code, 'cat', a.category_id,
        'decided_by', ud.name, 'at', to_char(r.created_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'),
        'decided_at', to_char(r.decided_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')) order by r.created_at desc), '[]')
      from change_requests r join stores st on st.store_code = r.store_code
      left join associates a on a.id = r.associate_id left join users ub on ub.emp_code = r.requested_by left join users ud on ud.emp_code = r.decided_by
      where r.store_code in (select _scope_stores(s))
        and (p_status is null or p_status = 'all' or r.status = p_status)
        and r.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 120))));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.cr_decide(p_token uuid, p_id bigint, p_approve boolean, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; r change_requests;
begin
  s := _sess_rw(p_token);
  if s.role not in ('am','admin') then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  select * into r from change_requests where id = p_id for update;
  if not found or r.store_code not in (select _scope_stores(s)) then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if r.status <> 'pending' then return json_build_object('ok', false, 'error', 'ALREADY_DECIDED'); end if;
  if p_approve then
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
  update change_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_by = s.emp_code, decided_at = now(),
    note = left(nullif(btrim(coalesce(p_note,'')), ''), 300) where id = p_id;
  perform _log(s.emp_code, s.role, r.store_code, case when p_approve then 'cr_approve' else 'cr_reject' end, null, r.kind || ' #' || r.id);
  return json_build_object('ok', true);
exception when unique_violation then return json_build_object('ok', false, 'error', 'DUPLICATE_NAME');
  when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- comp-off directly: Admin only (stores now send a request)
do $$ declare d text; begin
  d := pg_get_functiondef('public.mark_compoff(uuid,bigint,date,boolean)'::regprocedure);
  execute replace(d, 's.role not in (''store'',''admin'')', 's.role <> ''admin''');
end $$;

-- dash_store: show live-check result
do $$ declare d text; begin
  d := pg_get_functiondef('public.dash_store(uuid,text,date,text)'::regprocedure);
  if position('live' in d) = 0 then
    execute replace(d, 'max(p.photo_status) filter (where p.photo_status <> ''none'') photo',
                       'max(p.photo_status) filter (where p.photo_status <> ''none'') photo, max(p.live) live');
  end if;
end $$;

-- ---------- live face check result (before photo upload) ----------
create or replace function public.punch_live(p_photo_token uuid, p_result text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if p_result not in ('pass','fail','skip') then return json_build_object('ok', false, 'error', 'BAD_RESULT'); end if;
  update punches set live = p_result where photo_token = p_photo_token and photo_status = 'pending';
  return json_build_object('ok', found);
end $$;

-- ---------- dashboard: overview + 7-day week ----------
create or replace function public.dash_overview(p_token uuid, p_date date, p_shift text default 'B', p_upto time default null)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; cfg settings;
begin
  s := _sess(p_token);
  select * into cfg from settings where id = 1;
  return json_build_object('ok', true,
    'date', p_date, 'shift', p_shift, 'today', _ist_today(), 'now', to_char(_ist_now(), 'HH24:MI'),
    'alert_m', to_char(cfg.alert_m, 'HH24:MI'), 'alert_e', to_char(cfg.alert_e, 'HH24:MI'),
    'categories', (select coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'name_hi', c.name_hi) order by c.sort), '[]')
                   from categories c where c.id in (select _scope_cats(s))),
    'stores', (select coalesce(json_agg(json_build_object('code', st.store_code, 'name', st.name,
                 'am', st.am_emp, 'am_name', ua.name, 'zfm', st.zfm_emp, 'zfm_name', uz.name) order by st.store_code), '[]')
               from stores st left join users ua on ua.emp_code = st.am_emp left join users uz on uz.emp_code = st.zfm_emp
               where st.store_code in (select _scope_stores(s))),
    'photo_due', (select coalesce(json_agg(json_build_object('s', x.store_code, 'c', x.category_id, 'n', x.n)), '[]') from (
                  select p.store_code, p.category_id, count(*)::int n from punches p
                  where p.work_date = p_date and p.photo_status = 'pending' and p.store_code in (select _scope_stores(s))
                    and p.category_id in (select _scope_cats(s)) and (p_shift = 'B' or p.shift = p_shift) group by 1, 2) x),
    'rows', (
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
             group by 1, 2),
      co as (select a.store_code, a.category_id, count(*)::int compoff
             from compoffs c join associates a on a.id = c.associate_id
             where c.work_date = p_date group by 1, 2)
      select coalesce(json_agg(json_build_object('s', coalesce(rq.store_code, pr.store_code), 'c', coalesce(rq.category_id, pr.category_id),
               'req', greatest(coalesce(rq.req,0) - coalesce(co.compoff,0), 0), 'p', coalesce(pr.present,0), 'co', coalesce(co.compoff,0))), '[]')
      from rq full join pr on pr.store_code = rq.store_code and pr.category_id = rq.category_id
      left join co on co.store_code = coalesce(rq.store_code, pr.store_code) and co.category_id = coalesce(rq.category_id, pr.category_id)));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.dash_week(p_token uuid, p_end date, p_shift text default 'B')
returns json language plpgsql security definer set search_path = public as $$
declare v_s sessions;
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
             and (p_shift = 'B' or p.shift = p_shift) group by 1, 2, 3),
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

-- ---------- masters ----------
create or replace function public.admin_stores_upsert(p_token uuid, p_rows jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; r jsonb; o stores; n_new int := 0; n_upd int := 0; v_code text; chg text;
begin
  s := _admin(p_token);
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_code := upper(btrim(r->>'store_code'));
    if v_code !~ '^[A-Z]{2}[0-9]{2}$' then continue; end if;
    select * into o from stores where store_code = v_code;
    insert into stores(store_code, name, city, am_emp, zfm_emp, lat, lng, active, store_email, am_email, zfm_email)
    values (v_code, btrim(r->>'name'), nullif(btrim(r->>'city'),''), nullif(btrim(r->>'am_emp'),''), nullif(btrim(r->>'zfm_emp'),''),
            nullif(r->>'lat','')::double precision, nullif(r->>'lng','')::double precision, coalesce((r->>'active')::boolean, true),
            nullif(lower(btrim(r->>'store_email')),''), nullif(lower(btrim(r->>'am_email')),''), nullif(lower(btrim(r->>'zfm_email')),''))
    on conflict (store_code) do update set name = excluded.name, city = excluded.city, am_emp = excluded.am_emp, zfm_emp = excluded.zfm_emp,
       lat = coalesce(excluded.lat, stores.lat), lng = coalesce(excluded.lng, stores.lng), active = excluded.active,
       store_email = coalesce(excluded.store_email, stores.store_email), am_email = coalesce(excluded.am_email, stores.am_email),
       zfm_email = coalesce(excluded.zfm_email, stores.zfm_email);
    if o.store_code is null then n_new := n_new + 1;
    else
      select string_agg(k || ': ' || coalesce(ov, '—') || ' → ' || coalesce(nv, '—'), '; ') into chg from (
        select x.key k, to_jsonb(o)->>x.key ov, to_jsonb(t)->>x.key nv
        from stores t, jsonb_object_keys(to_jsonb(t)) x(key) where t.store_code = v_code and x.key not in ('created_at')) d
      where ov is distinct from nv;
      if chg is not null then n_upd := n_upd + 1; perform _log(s.emp_code, s.role, v_code, 'master_edit', null, 'store · ' || left(chg, 900)); end if;
    end if;
  end loop;
  if n_new > 0 then perform _log(s.emp_code, s.role, null, 'master_edit', null, 'stores added · ' || n_new); end if;
  return json_build_object('ok', true, 'added', n_new, 'updated', n_upd, 'count', n_new + n_upd);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.admin_users_upsert(p_token uuid, p_rows jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; n int;
begin
  s := _admin(p_token);
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  insert into users(emp_code, name, role, post, store_code, dept_id, active, email)
  select btrim(r->>'emp_code'), btrim(r->>'name'), lower(btrim(r->>'role')),
         case when lower(btrim(r->>'role')) = 'store' then nullif(btrim(r->>'post'),'') end,
         nullif(upper(btrim(r->>'store_code')),''), (select id from departments where lower(name) = lower(btrim(r->>'dept'))),
         coalesce((r->>'active')::boolean, true), nullif(lower(btrim(r->>'email')),'')
  from jsonb_array_elements(p_rows) r
  where lower(btrim(r->>'role')) <> 'admin' or exists (select 1 from users where emp_code = btrim(r->>'emp_code') and role = 'admin')
  on conflict (emp_code) do update set name = excluded.name, role = case when users.role = 'admin' then 'admin' else excluded.role end,
     post = excluded.post, store_code = excluded.store_code, dept_id = excluded.dept_id, active = excluded.active,
     email = coalesce(excluded.email, users.email);
  get diagnostics n = row_count;
  perform _log(s.emp_code, s.role, null, 'master_edit', null, 'users saved · ' || n);
  return json_build_object('ok', true, 'count', n);
exception when unique_violation then return json_build_object('ok', false, 'error', 'POST_TAKEN');
  when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.admin_dept_save(p_token uuid, p_id bigint, p_name text, p_cats text[], p_active boolean default true)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  s := _admin(p_token);
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  if length(btrim(coalesce(p_name,''))) < 2 then return json_build_object('ok', false, 'error', 'BAD_NAME'); end if;
  if p_id is null then
    insert into departments(name, category_ids, active) values (btrim(p_name), coalesce(p_cats, '{}'), coalesce(p_active, true))
    on conflict (name) do update set category_ids = excluded.category_ids, active = excluded.active;
  else
    update departments set name = btrim(p_name), category_ids = coalesce(p_cats, '{}'), active = coalesce(p_active, true) where id = p_id;
  end if;
  perform _log(s.emp_code, s.role, null, 'master_edit', null, 'dept · ' || btrim(p_name) || ' → ' || array_to_string(coalesce(p_cats, '{}'), ','));
  return json_build_object('ok', true);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.admin_settings_set(p_token uuid, p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  s := _admin(p_token);
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  update settings set
    test_mode = coalesce((p->>'test_mode')::boolean, test_mode),
    radius_m = coalesce((p->>'radius_m')::int, radius_m),
    store_idle_min = coalesce((p->>'store_idle_min')::int, store_idle_min),
    pin_max_tries = coalesce((p->>'pin_max_tries')::int, pin_max_tries),
    pin_lock_min = coalesce((p->>'pin_lock_min')::int, pin_lock_min),
    storage_alert_pct = coalesce((p->>'storage_alert_pct')::int, storage_alert_pct),
    alert_email = coalesce(p->>'alert_email', alert_email),
    alert_m = coalesce((p->>'alert_m')::time, alert_m),
    alert_e = coalesce((p->>'alert_e')::time, alert_e),
    setup_days = coalesce((p->>'setup_days')::int, setup_days),
    edit_types = coalesce((select array_agg(x) from jsonb_array_elements_text(p->'edit_types') x where x in ('compoff','staff','missed_out','missed_in')), edit_types)
  where id = 1;
  perform _log(s.emp_code, s.role, null, 'settings', null, p::text);
  return json_build_object('ok', true);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- admin_get: users with email / setup code state; departments keep to_jsonb
do $$ declare d text; begin
  d := pg_get_functiondef('public.admin_get(uuid,text)'::regprocedure);
  if position('has_code' in d) = 0 then
    execute replace(d, '''locked'', u.locked_until > now(), ''last_login''',
      '''locked'', u.locked_until > now(), ''email'', u.email, ''is_test'', u.is_test, ''has_code'', u.setup_hash is not null and u.setup_exp > now(), ''store_name'', (select name from stores where store_code = u.store_code), ''last_login_ts'', u.last_login_at, ''last_login''');
  end if;
end $$;

-- login options: active departments only
create or replace function public.login_options()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('departments', (select coalesce(json_agg(json_build_object('id', id, 'name', name) order by name), '[]') from departments where active),
    'posts', json_build_array('SM','ASM','DM Apps','DM FMCG','DM GM'))
$$;

-- ---------- test data removal ----------
create or replace function public.admin_test_data(p_token uuid, p_action text)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_stores text[]; n int;
begin
  s := _admin(p_token);
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  select array_agg(store_code) into v_stores from stores where is_test;
  if p_action = 'count' then
    return json_build_object('ok', true, 'stores', coalesce(array_length(v_stores, 1), 0),
      'users', (select count(*) from users where is_test), 'punches', (select count(*) from punches where store_code = any(coalesce(v_stores, '{}'))));
  end if;
  if p_action <> 'delete' then return json_build_object('ok', false, 'error', 'BAD_ACTION'); end if;
  delete from change_requests where store_code = any(coalesce(v_stores, '{}'));
  delete from compoffs where associate_id in (select id from associates where store_code = any(coalesce(v_stores, '{}')));
  delete from punches where store_code = any(coalesce(v_stores, '{}'));
  delete from photo_slots where store_code = any(coalesce(v_stores, '{}'));
  delete from associates where store_code = any(coalesce(v_stores, '{}'));
  delete from manpower where store_code = any(coalesce(v_stores, '{}'));
  delete from sessions where emp_code in (select emp_code from users where is_test) or store_code = any(coalesce(v_stores, '{}'));
  delete from access_log where emp_code in (select emp_code from users where is_test) or store_code = any(coalesce(v_stores, '{}'));
  delete from consent_log where store_code = any(coalesce(v_stores, '{}'));
  delete from users where is_test;
  delete from stores where is_test;
  get diagnostics n = row_count;
  perform _log(s.emp_code, s.role, null, 'test_data_deleted', null, n || ' stores');
  return json_build_object('ok', true, 'stores', n);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------- permissions ----------
revoke all on function public._new_code(text) from public, anon, authenticated;
revoke all on function public._weak_pin(text) from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array[
    'auth_check(text,text,text,text,bigint)', 'auth_register(text,text,text,text,text,double precision,double precision)',
    'auth_set_pin(text,text,text,text,bigint,text,double precision,double precision,text)', 'reset_pin(uuid,text)',
    'admin_issue_codes(uuid,text[])', 'store_team(uuid)', 'store_vacate(uuid,text,text)',
    'cr_create(uuid,text,bigint,date,jsonb,text)', 'cr_list(uuid,text,int)', 'cr_decide(uuid,bigint,boolean,text)',
    'punch_live(uuid,text)', 'dash_overview(uuid,date,text,time)', 'dash_week(uuid,date,text)',
    'admin_stores_upsert(uuid,jsonb)', 'admin_users_upsert(uuid,jsonb)', 'admin_dept_save(uuid,bigint,text,text[],boolean)',
    'admin_settings_set(uuid,jsonb)', 'login_options()', 'admin_test_data(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, authenticated', f);
    execute format('grant execute on function public.%s to anon', f);
  end loop;
end $$;
