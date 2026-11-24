-- v5.6 features (24 Nov 2026) — run AFTER 020_v5_6_perf.sql
-- A  HK / Security actual reporting count (set once by SM/ASM, change only when needed, remark). % stays on budget.
-- B  punch_submit: random audit selfie lock (next punch blocked until the pending selfie is taken)
--                  + Security night shift (before 12:00, an open evening IN from yesterday is closed by this punch, counted for yesterday)
-- C  Break shift (standing flag, 4 punches; fewer = Half day on statement)
-- D  Week off by SM/ASM without approval (max 1 in any 7 days, not on a day with an IN punch)
-- E  Store direct edits by SM/ASM with remark: staff name / vendor / brand, delete duplicate punch (today + yesterday)
-- F  Admin can approve / reject every request type, reject needs a remark; bulk approve / reject
-- G  dash_store / statement / store_range show the new data

-- ---------- helpers ----------
create or replace function public._is_mgr(s public.sessions) returns boolean language sql stable
as $f$ select s.role = 'store' and s.view_by is null
          and exists (select 1 from public.users u where u.emp_code = s.emp_code and upper(btrim(coalesce(u.post,''))) in ('SM','ASM')) $f$;
revoke all on function public._is_mgr(public.sessions) from public, anon, authenticated;

-- ---------- A: actual reporting count ----------
create table if not exists public.actual_count (
  id bigserial primary key, store_code text not null references public.stores(store_code), category_id text not null check (category_id in ('HK','SEC')),
  n integer not null check (n between 0 and 99), effective_from date not null, set_by text not null, remark text, created_at timestamptz not null default now());
create index if not exists actual_count_idx on public.actual_count (store_code, category_id, effective_from desc, id desc);
alter table public.actual_count enable row level security;
revoke all on public.actual_count from anon, authenticated;

create or replace function public._actual(p_store text, p_cat text, p_date date) returns integer language sql stable
as $f$ select x.n from public.actual_count x where x.store_code = p_store and x.category_id = p_cat and x.effective_from <= p_date
       order by x.effective_from desc, x.id desc limit 1 $f$;
revoke all on function public._actual(text, text, date) from public, anon, authenticated;

-- HK state: split must add up to the target = actual reporting (if set) else the budget
create or replace function public._hk_state(p_date date)
returns table(store_code text, vendor text, hk_total integer, split_from date, morning integer, evening integer, split_set boolean)
language sql stable
as $f$
  select c.store_code, c.vendor, c.hk_total, h.effective_from, h.morning, h.evening,
         coalesce(h.morning + h.evening = coalesce(ac.n, c.hk_total), false)
  from (select distinct on (m.store_code) m.store_code, m.vendor, m.hk_total
        from public.manpower m where m.category_id = 'HK' and m.brand = '' and m.effective_from <= p_date
        order by m.store_code, m.effective_from desc, m.id desc) c
  left join lateral (select x.effective_from, x.morning, x.evening from public.hk_split x
                     where x.store_code = c.store_code and x.effective_from <= p_date
                     order by x.effective_from desc, x.id desc limit 1) h on true
  left join lateral (select y.n from public.actual_count y where y.store_code = c.store_code and y.category_id = 'HK' and y.effective_from <= p_date
                     order by y.effective_from desc, y.id desc limit 1) ac on true
  where c.hk_total is not null
$f$;

-- Required stays = budget. Split M/E follows the store's split (which adds up to actual); morning capped at budget.
create or replace function public._req(p_date date)
returns table(store_code text, category_id text, brand text, vendor text, morning integer, evening integer)
language sql stable
as $f$
  select c.store_code, c.category_id, c.brand, c.vendor,
    case when c.hk_total is null then c.morning
         when h.morning + h.evening = coalesce(ac.n, c.hk_total) then least(h.morning, c.hk_total)
         else c.hk_total end,
    case when c.hk_total is null then c.evening
         when h.morning + h.evening = coalesce(ac.n, c.hk_total) then c.hk_total - least(h.morning, c.hk_total)
         else 0 end
  from (select distinct on (m.store_code, m.category_id, m.brand) m.*
        from public.manpower m where m.effective_from <= p_date
        order by m.store_code, m.category_id, m.brand, m.effective_from desc, m.id desc) c
  left join lateral (select x.morning, x.evening from public.hk_split x
                     where x.store_code = c.store_code and x.effective_from <= p_date
                     order by x.effective_from desc, x.id desc limit 1) h on c.category_id = 'HK' and c.hk_total is not null
  left join lateral (select y.n from public.actual_count y where y.store_code = c.store_code and y.category_id = 'HK' and y.effective_from <= p_date
                     order by y.effective_from desc, y.id desc limit 1) ac on c.category_id = 'HK' and c.hk_total is not null
$f$;
revoke all on function public._req(date), public._hk_state(date) from public, anon, authenticated;

create or replace function public.actual_get(p_token uuid)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s sessions;
begin
  s := _sess(p_token);
  if s.role <> 'store' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  return json_build_object('ok', true, 'can_edit', _is_mgr(s),
    'rows', (select coalesce(json_agg(json_build_object('c', b.category_id, 'budget', b.budget, 'vendor', b.vendor,
                 'actual', _actual(s.store_code, b.category_id, _ist_today())) order by b.category_id), '[]')
             from (select r.category_id, sum(r.morning + r.evening)::int budget, string_agg(distinct nullif(btrim(r.vendor), ''), ', ') vendor
                   from _req(_ist_today()) r where r.store_code = s.store_code and r.category_id in ('HK','SEC') group by 1) b),
    'history', (select coalesce(json_agg(json_build_object('c', x.category_id, 'n', x.n, 'from', x.effective_from, 'remark', x.remark,
                   'by', coalesce(u.name, x.set_by), 'post', u.post, 'at', to_char(x.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI')) order by x.id desc), '[]')
                from (select * from actual_count where store_code = s.store_code order by id desc limit 20) x left join users u on u.emp_code = x.set_by));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.actual_set(p_token uuid, p_cat text, p_n integer, p_remark text)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s sessions; v_old int; v_rm text := left(nullif(btrim(coalesce(p_remark,'')), ''), 200);
begin
  s := _sess_rw(p_token);
  if not _is_mgr(s) then return json_build_object('ok', false, 'error', 'SM_ASM_ONLY'); end if;
  if p_cat not in ('HK','SEC') or p_n is null or p_n < 0 or p_n > 99 then return json_build_object('ok', false, 'error', 'BAD_VALUE'); end if;
  if length(coalesce(v_rm,'')) < 5 then return json_build_object('ok', false, 'error', 'REASON_REQUIRED'); end if;
  v_old := _actual(s.store_code, p_cat, _ist_today());
  if v_old is not distinct from p_n then return json_build_object('ok', true, 'n', p_n, 'unchanged', true); end if;
  insert into actual_count(store_code, category_id, n, effective_from, set_by, remark) values (s.store_code, p_cat, p_n, _ist_today(), s.emp_code, v_rm);
  perform _log(s.emp_code, s.role, s.store_code, 'actual_count', null, p_cat || ' ' || coalesce(v_old::text, '—') || ' → ' || p_n || ' · ' || v_rm);
  return json_build_object('ok', true, 'n', p_n, 'old', v_old);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
grant execute on function public.actual_get(uuid), public.actual_set(uuid, text, integer, text) to anon;

-- HK split get / set now check against the target (actual if set, else budget)
create or replace function public.hk_split_get(p_token uuid)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s sessions; h record; v_can boolean; v_today boolean; v_act int;
begin
  s := _sess(p_token);
  if s.role <> 'store' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  select * into h from _hk_state(_ist_today()) x where x.store_code = s.store_code;
  v_act := _actual(s.store_code, 'HK', _ist_today());
  v_can := _is_mgr(s);
  v_today := exists (select 1 from hk_split where store_code = s.store_code and (created_at at time zone 'Asia/Kolkata')::date = _ist_today());
  return json_build_object('ok', true, 'store', s.store_code, 'has_hk', h.store_code is not null,
    'total', coalesce(v_act, h.hk_total), 'budget', h.hk_total, 'actual', v_act, 'vendor', h.vendor, 'set', coalesce(h.split_set, false),
    'morning', case when h.split_set then h.morning end, 'evening', case when h.split_set then h.evening end,
    'effective_from', case when h.split_set then h.split_from end,
    'saved_today', v_today, 'need_today', h.store_code is not null and h.hk_total is not null and v_can and not v_today,
    'history', (select coalesce(json_agg(json_build_object('effective_from', x.effective_from, 'morning', x.morning, 'evening', x.evening,
                  'by', x.set_by, 'by_name', u.name, 'at', to_char(x.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI'))
                  order by x.effective_from desc, x.id desc), '[]')
                from (select * from hk_split where store_code = s.store_code order by effective_from desc, id desc limit 20) x
                left join users u on u.emp_code = x.set_by));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.hk_split_set(p_token uuid, p_morning integer, p_evening integer, p_effective date default null)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s sessions; v_eff date := coalesce(p_effective, _ist_today()); v_total int; v_d date;
begin
  s := _sess_rw(p_token);
  if s.role <> 'store' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if v_eff < _ist_today() - 31 or v_eff > _ist_today() + 90 then return json_build_object('ok', false, 'error', 'BAD_DATE'); end if;
  if p_morning is null or p_evening is null or p_morning < 0 or p_evening < 0 then return json_build_object('ok', false, 'error', 'BAD_VALUE'); end if;
  v_d := greatest(v_eff, _ist_today());
  select coalesce(_actual(s.store_code, 'HK', v_d), x.hk_total) into v_total from _hk_state(v_d) x where x.store_code = s.store_code;
  if v_total is null then return json_build_object('ok', false, 'error', 'NO_HK_TOTAL'); end if;
  if p_morning + p_evening <> v_total then return json_build_object('ok', false, 'error', 'SUM_MISMATCH', 'total', v_total); end if;
  insert into hk_split(store_code, effective_from, morning, evening, set_by) values (s.store_code, v_eff, p_morning, p_evening, s.emp_code);
  perform _log(s.emp_code, s.role, s.store_code, 'hk_split', null, 'M ' || p_morning || ' / E ' || p_evening || ' from ' || v_eff);
  return json_build_object('ok', true, 'total', v_total, 'morning', p_morning, 'evening', p_evening, 'effective_from', v_eff);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ---------- B: punch_submit (selfie lock + night shift) — patched in place ----------
do $do$
declare d text := pg_get_functiondef('public.punch_submit(text,text,text,text,text,double precision,double precision,text,uuid,boolean,text)'::regprocedure);
  procedure_rep text[][] := array[
    ['v_cross boolean := false; v_tries int; v_cr change_requests; v_n int;',
     'v_cross boolean := false; v_tries int; v_cr change_requests; v_n int; v_pend punches; v_work date := _ist_today();'],
    ['  -- v5.3: max 4 punches a day (2 IN + 2 OUT)',
     '  -- v5.6: the random audit selfie (10%) of an earlier punch must be taken before the next punch
  select * into v_pend from punches where associate_id = a.id and work_date >= v_today - 1 and photo_status = ''pending''
    and ts > now() - interval ''20 hours'' order by ts desc limit 1;
  if found then
    return json_build_object(''ok'', false, ''error'', ''SELFIE_DUE'', ''photo_token'', v_pend.photo_token, ''kind'', v_pend.kind,
      ''time'', to_char(v_pend.ts at time zone ''Asia/Kolkata'', ''HH24:MI''), ''shift'', v_pend.shift, ''name'', a.name, ''code'', a.code);
  end if;
  -- v5.6: Security night shift. Before 12:00 noon, with no punch yet today and yesterday''s last punch an evening IN
  -- (within 16 h), this punch is the OUT of yesterday''s shift and is counted for yesterday.
  if c.id = ''SEC'' and extract(hour from v_now) < 12
     and not exists (select 1 from punches where associate_id = a.id and work_date = v_today) then
    select * into v_last from punches where associate_id = a.id and work_date = v_today - 1 order by ts desc limit 1;
    if found and v_last.kind = ''IN'' and v_last.shift = ''E'' and v_last.ts > now() - interval ''16 hours'' then v_work := v_today - 1; end if;
  end if;
  v_last := null;
  -- v5.3: max 4 punches a day (2 IN + 2 OUT)'],
    ['select count(*) into v_n from punches where associate_id = a.id and work_date = v_today;',
     'select count(*) into v_n from punches where associate_id = a.id and work_date = v_work;'],
    ['select * into v_last from punches where associate_id = a.id and work_date = v_today order by ts desc limit 1;',
     'select * into v_last from punches where associate_id = a.id and work_date = v_work order by ts desc limit 1;'],
    ['values (a.id, st.store_code, c.id, v_brand, a.vendor, v_today, v_kind,',
     'values (a.id, st.store_code, c.id, v_brand, a.vendor, v_work, v_kind,'],
    ['''punches_today'', v_n + 1, ''left_today'', 4 - (v_n + 1));',
     '''punches_today'', v_n + 1, ''left_today'', 4 - (v_n + 1), ''work_date'', v_work, ''night'', v_work <> v_today);']];
  i int;
begin
  if position('SELFIE_DUE' in d) > 0 then raise notice 'punch_submit already patched'; return; end if;
  for i in 1 .. array_length(procedure_rep, 1) loop
    if position(procedure_rep[i][1] in d) = 0 then raise exception 'punch_submit patch % not found', i; end if;
    d := replace(d, procedure_rep[i][1], procedure_rep[i][2]);
  end loop;
  execute d;
end $do$;

-- ---------- C: break shift ----------
create table if not exists public.break_shift (
  id bigserial primary key, associate_id bigint not null references public.associates(id) on delete cascade,
  from_date date not null, to_date date, set_by text not null, remark text, created_at timestamptz not null default now(), ended_by text);
create index if not exists break_shift_assoc_idx on public.break_shift (associate_id, from_date);
alter table public.break_shift enable row level security;
revoke all on public.break_shift from anon, authenticated;

create or replace function public._bs_on(p_assoc bigint, p_date date) returns boolean language sql stable
as $f$ select exists (select 1 from public.break_shift b where b.associate_id = p_assoc and b.from_date <= p_date and (b.to_date is null or b.to_date >= p_date)) $f$;
revoke all on function public._bs_on(bigint, date) from public, anon, authenticated;

create or replace function public.store_break_shift(p_token uuid, p_associate bigint, p_on boolean, p_remark text)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s sessions; a associates; b break_shift; v_rm text := left(nullif(btrim(coalesce(p_remark,'')), ''), 200); v_today date := _ist_today();
begin
  s := _sess_rw(p_token);
  if not _is_mgr(s) then return json_build_object('ok', false, 'error', 'SM_ASM_ONLY'); end if;
  select * into a from associates where id = p_associate and store_code = s.store_code;
  if not found then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if length(coalesce(v_rm,'')) < 5 then return json_build_object('ok', false, 'error', 'REASON_REQUIRED'); end if;
  select * into b from break_shift where associate_id = a.id and to_date is null order by id desc limit 1;
  if p_on then
    if b.id is not null then return json_build_object('ok', true, 'on', true, 'from', b.from_date); end if;
    insert into break_shift(associate_id, from_date, set_by, remark) values (a.id, v_today, s.emp_code, v_rm) returning * into b;
  else
    if b.id is null then return json_build_object('ok', true, 'on', false); end if;
    if b.from_date >= v_today then delete from break_shift where id = b.id;
    else update break_shift set to_date = v_today - 1, ended_by = s.emp_code, remark = coalesce(remark || ' | ', '') || 'OFF: ' || v_rm where id = b.id; end if;
  end if;
  insert into change_requests(store_code, kind, associate_id, work_date, payload, reason, requested_by, status, decided_by, decided_at, note)
  values (s.store_code, 'break_shift', a.id, v_today, jsonb_build_object('on', p_on, 'direct', true), v_rm, s.emp_code, 'approved', s.emp_code, now(), 'Direct by store (no approval)');
  perform _log(s.emp_code, s.role, s.store_code, 'break_shift', null, a.name || ' (' || a.code || ') break shift ' || case when p_on then 'ON' else 'OFF' end || ' · ' || v_rm);
  return json_build_object('ok', true, 'on', p_on, 'from', case when p_on then v_today end);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ---------- D: week off ----------
alter table public.compoffs add column if not exists kind text not null default 'CO';
alter table public.compoffs add column if not exists remark text;

create or replace function public.store_week_off(p_token uuid, p_associate bigint, p_date date, p_on boolean default true, p_remark text default null)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s sessions; a associates; v_today date := _ist_today(); v_near date; v_rm text := left(nullif(btrim(coalesce(p_remark,'')), ''), 200);
begin
  s := _sess_rw(p_token);
  if not _is_mgr(s) then return json_build_object('ok', false, 'error', 'SM_ASM_ONLY'); end if;
  select * into a from associates where id = p_associate and store_code = s.store_code;
  if not found then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if p_date is null or p_date < v_today - 1 or p_date > v_today + 7 then return json_build_object('ok', false, 'error', 'BAD_DATE'); end if;
  if not coalesce(p_on, true) then
    delete from compoffs where associate_id = a.id and work_date = p_date and kind = 'WO';
    if not found then return json_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  else
    if exists (select 1 from punches where associate_id = a.id and work_date = p_date and kind = 'IN') then
      return json_build_object('ok', false, 'error', 'PUNCHED_THAT_DAY'); end if;
    if exists (select 1 from compoffs where associate_id = a.id and work_date = p_date) then
      return json_build_object('ok', false, 'error', 'ALREADY_OFF'); end if;
    select work_date into v_near from compoffs where associate_id = a.id and kind = 'WO' and work_date between p_date - 6 and p_date + 6 limit 1;
    if v_near is not null then return json_build_object('ok', false, 'error', 'WO_IN_7_DAYS', 'near', v_near); end if;
    insert into compoffs(associate_id, work_date, marked_by, kind, remark) values (a.id, p_date, s.emp_code, 'WO', v_rm);
  end if;
  insert into change_requests(store_code, kind, associate_id, work_date, payload, reason, requested_by, status, decided_by, decided_at, note)
  values (s.store_code, 'week_off', a.id, p_date, jsonb_build_object('on', coalesce(p_on, true), 'direct', true), coalesce(v_rm, 'Week off'), s.emp_code, 'approved', s.emp_code, now(), 'Direct by store (no approval)');
  perform _log(s.emp_code, s.role, s.store_code, 'week_off', null, a.name || ' (' || a.code || ') WO ' || p_date || case when coalesce(p_on, true) then '' else ' removed' end);
  return json_build_object('ok', true);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

-- ---------- E: direct store edits ----------
create or replace function public.store_staff_edit(p_token uuid, p_associate bigint, p_name text, p_vendor text, p_brand text, p_remark text)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s sessions; a associates; c categories; v_name text := regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g');
  v_vendor text := nullif(btrim(coalesce(p_vendor,'')), ''); v_brand text; v_rm text := left(nullif(btrim(coalesce(p_remark,'')), ''), 200);
begin
  s := _sess_rw(p_token);
  if not _is_mgr(s) then return json_build_object('ok', false, 'error', 'SM_ASM_ONLY'); end if;
  select * into a from associates where id = p_associate and store_code = s.store_code for update;
  if not found then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  select * into c from categories where id = a.category_id;
  if length(coalesce(v_rm,'')) < 5 then return json_build_object('ok', false, 'error', 'REASON_REQUIRED'); end if;
  if v_name !~ '^[[:alpha:] .]{2,40}$' then return json_build_object('ok', false, 'error', 'BAD_NAME'); end if;
  v_brand := case when cardinality(c.brands) > 0 then coalesce(nullif(btrim(coalesce(p_brand,'')), ''), a.brand) else '' end;
  if cardinality(c.brands) > 0 and not (v_brand = any (c.brands)) then return json_build_object('ok', false, 'error', 'BRAND_REQUIRED'); end if;
  if v_name = a.name and v_vendor is not distinct from a.vendor and v_brand = a.brand then return json_build_object('ok', true, 'unchanged', true); end if;
  update associates set name = v_name, norm_name = _norm(v_name), vendor = v_vendor, brand = v_brand where id = a.id;
  insert into change_requests(store_code, kind, associate_id, work_date, payload, reason, requested_by, status, decided_by, decided_at, note)
  values (s.store_code, 'staff', a.id, null,
    jsonb_build_object('old', jsonb_build_object('name', a.name, 'vendor', a.vendor, 'brand', a.brand),
                       'new', jsonb_build_object('name', v_name, 'vendor', v_vendor, 'brand', v_brand), 'direct', true),
    v_rm, s.emp_code, 'approved', s.emp_code, now(), 'Direct by store (no approval)');
  perform _log(s.emp_code, s.role, s.store_code, 'staff_edit', null,
    a.code || ': ' || a.name || ' / ' || coalesce(a.vendor,'—') || ' / ' || coalesce(nullif(a.brand,''),'—') || ' → ' || v_name || ' / ' || coalesce(v_vendor,'—') || ' / ' || coalesce(nullif(v_brand,''),'—') || ' · ' || v_rm);
  return json_build_object('ok', true);
exception when unique_violation then return json_build_object('ok', false, 'error', 'DUPLICATE_NAME');
  when others then return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.store_punches(p_token uuid, p_associate bigint, p_date date)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s sessions; a associates;
begin
  s := _sess(p_token);
  if s.role <> 'store' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  select * into a from associates where id = p_associate;
  if not found then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  return json_build_object('ok', true, 'can_delete', _is_mgr(s) and p_date >= _ist_today() - 1,
    'rows', (select coalesce(json_agg(json_build_object('id', p.id, 'k', p.kind, 't', to_char(p.ts at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'),
               'photo', p.photo_status, 'by', um.name, 'src', case when p.device_kind = 'mod' then 'store' else 'own' end) order by p.ts), '[]')
             from punches p left join users um on um.emp_code = p.mod_emp
             where p.associate_id = a.id and p.work_date = p_date and p.store_code = s.store_code));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

create or replace function public.store_punch_delete(p_token uuid, p_punch bigint, p_reason text, p_remark text)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s sessions; p punches; a associates; v_rm text := left(nullif(btrim(coalesce(p_remark,'')), ''), 200); v_left int;
begin
  s := _sess_rw(p_token);
  if not _is_mgr(s) then return json_build_object('ok', false, 'error', 'SM_ASM_ONLY'); end if;
  select * into p from punches where id = p_punch for update;
  if not found or p.store_code <> s.store_code then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if p.work_date < _ist_today() - 1 then return json_build_object('ok', false, 'error', 'TOO_OLD'); end if;
  if length(coalesce(v_rm,'')) < 5 then return json_build_object('ok', false, 'error', 'REASON_REQUIRED'); end if;
  if p.photo_status <> 'none' then return json_build_object('ok', false, 'error', 'SELFIE_PUNCH'); end if;
  select count(*) into v_left from punches where associate_id = p.associate_id and work_date = p.work_date and id <> p.id;
  if v_left = 0 then return json_build_object('ok', false, 'error', 'ONLY_PUNCH'); end if;
  select * into a from associates where id = p.associate_id;
  delete from punches where id = p.id;
  -- keep IN / OUT alternating after the delete
  update punches x set kind = case when y.rn % 2 = 1 then 'IN' else 'OUT' end
  from (select id, row_number() over (order by ts) rn from punches where associate_id = p.associate_id and work_date = p.work_date) y
  where x.id = y.id and x.kind is distinct from case when y.rn % 2 = 1 then 'IN' else 'OUT' end;
  insert into change_requests(store_code, kind, associate_id, work_date, payload, reason, requested_by, status, decided_by, decided_at, note)
  values (s.store_code, 'punch_delete', a.id, p.work_date,
    jsonb_build_object('kind', p.kind, 'time', to_char(p.ts at time zone 'Asia/Kolkata', 'HH24:MI'), 'why', left(coalesce(p_reason,''), 40), 'direct', true),
    v_rm, s.emp_code, 'approved', s.emp_code, now(), 'Direct by store (no approval)');
  perform _log(s.emp_code, s.role, s.store_code, 'punch_delete', null,
    a.name || ' (' || a.code || ') ' || p.kind || ' ' || to_char(p.ts at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') || ' deleted · ' || coalesce(p_reason || ' · ', '') || v_rm);
  return json_build_object('ok', true);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
grant execute on function public.store_break_shift(uuid, bigint, boolean, text), public.store_week_off(uuid, bigint, date, boolean, text),
  public.store_staff_edit(uuid, bigint, text, text, text, text), public.store_punches(uuid, bigint, date),
  public.store_punch_delete(uuid, bigint, text, text) to anon;

-- ---------- F: Admin decides every request; reject needs a remark; bulk ----------
create or replace function public._can_decide(s public.sessions, r public.change_requests) returns boolean language sql stable
as $f$
  select s.view_by is null and r.status = 'pending' and (
    s.role = 'admin'
    or (s.role = 'am' and not public._is_sg_kind(r.kind) and r.kind <> 'cross_store' and exists (select 1 from public.stores x where x.store_code = r.store_code and x.am_emp = s.emp_code))
    or (s.role = 'rlpo' and public._is_sg_kind(r.kind) and exists (select 1 from public.stores x where x.store_code = r.store_code and x.rlpo_emp = s.emp_code))
    or (s.role = 'store' and r.kind = 'cross_store' and s.store_code = r.store_code
        and exists (select 1 from public.users u where u.emp_code = s.emp_code and u.post = 'SM')))
$f$;
revoke all on function public._can_decide(public.sessions, public.change_requests) from public, anon, authenticated;

do $do$
declare d text := pg_get_functiondef('public.cr_decide(uuid,bigint,boolean,text,text)'::regprocedure);
begin
  if position('NOTE_REQUIRED' in d) > 0 then return; end if;
  if position($$if s.role not in ('am','rlpo','store') then$$ in d) = 0 then raise exception 'cr_decide patch 1 not found'; end if;
  d := replace(d, $$if s.role not in ('am','rlpo','store') then$$, $$if s.role not in ('am','rlpo','store','admin') then$$);
  if position($$if not _can_decide(s, r) then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;$$ in d) = 0 then raise exception 'cr_decide patch 2 not found'; end if;
  d := replace(d, $$if not _can_decide(s, r) then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;$$,
    $$if not _can_decide(s, r) then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if s.role = 'admin' and v_note is null and (not coalesce(p_approve, false) or upper(coalesce(p_status, '')) = 'A') then
    return json_build_object('ok', false, 'error', 'NOTE_REQUIRED'); end if;$$);
  execute d;
end $do$;

create or replace function public.cr_decide_bulk(p_token uuid, p_ids bigint[], p_approve boolean, p_note text default null)
returns json language plpgsql security definer set search_path to 'public'
as $function$
declare s sessions; i bigint; r json; n_ok int := 0; fails jsonb := '[]';
begin
  s := _sess_rw(p_token);
  if s.role <> 'admin' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 500 then return json_build_object('ok', false, 'error', 'BAD_INPUT'); end if;
  if not coalesce(p_approve, false) and length(btrim(coalesce(p_note, ''))) = 0 then return json_build_object('ok', false, 'error', 'NOTE_REQUIRED'); end if;
  foreach i in array p_ids loop
    r := cr_decide(p_token, i, p_approve, p_note, case when coalesce(p_approve, false) then 'P' else 'A' end);
    if (r->>'ok')::boolean then n_ok := n_ok + 1; else fails := fails || jsonb_build_object('id', i, 'error', r->>'error'); end if;
  end loop;
  return json_build_object('ok', true, 'done', n_ok, 'failed', fails);
end $function$;
grant execute on function public.cr_decide_bulk(uuid, bigint[], boolean, text) to anon;

do $do$
declare d text := pg_get_functiondef('public.cr_list(uuid,text,integer)'::regprocedure);
begin
  d := replace(d, $$'can_decide', s.role in ('am','rlpo') and s.view_by is null,$$, $$'can_decide', s.role in ('am','rlpo','admin') and s.view_by is null,$$);
  execute d;
end $do$;

-- ---------- G: dash_store / statement / store_range ----------
do $do$
declare d text := replace(pg_get_functiondef('public.dash_store(uuid,text,date,text)'::regprocedure), E'\r', '');
  rep text[][] := array[
    [$$'store_name', st.name, 'date', p_date,$$,
     $$'store_name', st.name, 'date', p_date,
    'mgr', _is_mgr(s),
    'actual', (select json_object_agg(z.category_id, z.n) from (select distinct on (x.category_id) x.category_id, x.n from actual_count x
               where x.store_code = v_store and x.effective_from <= p_date order by x.category_id, x.effective_from desc, x.id desc) z),$$],
    [$$'src', case when p2.device_kind = 'mod'$$, $$'id', p2.id, 'ph', p2.photo_status, 'src', case when p2.device_kind = 'mod'$$],
    [$$and p2.store_code = v_store) src
        from punches p join associates a on a.id = p.associate_id$$,
     $$and p2.store_code = v_store) src,
          _bs_on(a.id, p_date) bs, count(*)::int np,
          exists (select 1 from compoffs w where w.associate_id = a.id and w.work_date = p_date and w.kind = 'WO') wo
        from punches p join associates a on a.id = p.associate_id$$],
    [$$g.st, null::json
        from sgd g$$, $$g.st, null::json, _bs_on(a.id, p_date), 0, false
        from sgd g$$],
    [$$select coalesce(json_agg(json_build_object('id', a.id, 'name', a.name, 'c', a.category_id, 'brand', a.brand, 'days', r.days) order by r.days desc), '[]')$$,
     $$select coalesce(json_agg(json_build_object('id', a.id, 'name', a.name, 'c', a.category_id, 'brand', a.brand, 'vendor', a.vendor, 'days', r.days, 'bs', _bs_on(a.id, p_date)) order by r.days desc), '[]')$$]];
  i int;
begin
  if position('''mgr'', _is_mgr(s)' in d) > 0 then return; end if;
  for i in 1 .. array_length(rep, 1) loop
    if position(rep[i][1] in d) = 0 then raise exception 'dash_store patch % not found', i; end if;
    d := replace(d, rep[i][1], rep[i][2]);
  end loop;
  execute d;
end $do$;

do $do$
declare d text := replace(pg_get_functiondef('public.statement(uuid,bigint,date,date)'::regprocedure), E'\r', '');
  rep text[][] := array[
    [$$'co', cx.co,
        'st', case when cx.co then 'CO'$$,
     $$'co', cx.co, 'wo', cx.k = 'WO', 'bs', bx.bs, 'np', x.np,
        'st', case when cx.k = 'WO' then 'WO' when cx.co then 'CO'
                   when bx.bs and coalesce(x.np, 0) between 1 and 3 and d.d::date < v_today then 'H'$$],
    [$$cross join lateral (select exists (select 1 from compoffs c where c.associate_id = a.id and c.work_date = d.d::date) co) cx$$,
     $$cross join lateral (select c.kind is not null co, c.kind k from (select null) z left join compoffs c on c.associate_id = a.id and c.work_date = d.d::date) cx
      cross join lateral (select _bs_on(a.id, d.d::date) bs) bx$$],
    [$$left join (select work_date, min(ts) filter (where kind = 'IN') fi, max(ts) filter (where kind = 'OUT') lo$$,
     $$left join (select work_date, min(ts) filter (where kind = 'IN') fi, max(ts) filter (where kind = 'OUT') lo, count(*)::int np$$]];
  i int;
begin
  if position('''wo'', cx.k' in d) > 0 then return; end if;
  for i in 1 .. array_length(rep, 1) loop
    if position(rep[i][1] in d) = 0 then raise exception 'statement patch % not found', i; end if;
    d := replace(d, rep[i][1], rep[i][2]);
  end loop;
  execute d;
end $do$;

-- store_range: 'compoff' also counts week offs (kind WO) — unchanged table, nothing to patch. Half days come from the statement.
