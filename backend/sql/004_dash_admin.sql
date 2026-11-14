-- required counts effective on a date (latest version per store/category/brand)
create or replace function public._req(p_date date)
returns table(store_code text, category_id text, brand text, vendor text, morning int, evening int)
language sql stable security definer set search_path = public as $$
  select distinct on (m.store_code, m.category_id, m.brand) m.store_code, m.category_id, m.brand, m.vendor, m.morning, m.evening
  from manpower m where m.effective_from <= p_date
  order by m.store_code, m.category_id, m.brand, m.effective_from desc, m.id desc
$$;

create or replace function public._shift_req(m int, e int, p_shift text) returns int language sql immutable
as $$ select case p_shift when 'M' then m when 'E' then e else m + e end $$;

-- ---------- network / scope overview: one row per store x category ----------
create or replace function public.dash_overview(p_token uuid, p_date date, p_shift text default 'B', p_upto time default null)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  s := _sess(p_token);
  return json_build_object('ok', true,
    'date', p_date, 'shift', p_shift,
    'categories', (select coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'name_hi', c.name_hi) order by c.sort), '[]')
                   from categories c where c.id in (select _scope_cats(s))),
    'stores', (select coalesce(json_agg(json_build_object('code', st.store_code, 'name', st.name,
                 'am', st.am_emp, 'am_name', ua.name, 'zfm', st.zfm_emp, 'zfm_name', uz.name) order by st.store_code), '[]')
               from stores st left join users ua on ua.emp_code = st.am_emp left join users uz on uz.emp_code = st.zfm_emp
               where st.store_code in (select _scope_stores(s))),
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

-- ---------- one store, one day: slots, present list, missing, regulars ----------
create or replace function public.dash_store(p_token uuid, p_store text, p_date date, p_shift text default 'B')
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_store text;
begin
  s := _sess(p_token);
  v_store := case when s.role = 'store' then s.store_code else upper(p_store) end;
  if v_store not in (select _scope_stores(s)) then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  return json_build_object('ok', true, 'store', v_store,
    'store_name', (select name from stores where store_code = v_store), 'date', p_date,
    'slots', (
      with rq as (select r.category_id, r.brand, r.vendor, _shift_req(r.morning, r.evening, p_shift) req
                  from _req(p_date) r where r.store_code = v_store and r.category_id in (select _scope_cats(s))),
      pr as (select p.category_id, p.brand, count(distinct p.associate_id)::int present
             from punches p where p.store_code = v_store and p.work_date = p_date and p.kind = 'IN'
               and (p_shift = 'B' or p.shift = p_shift) group by 1, 2),
      co as (select a.category_id, a.brand, count(*)::int compoff from compoffs c join associates a on a.id = c.associate_id
             where a.store_code = v_store and c.work_date = p_date group by 1, 2)
      select coalesce(json_agg(json_build_object('c', coalesce(rq.category_id, pr.category_id), 'brand', coalesce(rq.brand, pr.brand),
               'vendor', rq.vendor, 'req', greatest(coalesce(rq.req,0) - coalesce(co.compoff,0), 0), 'p', coalesce(pr.present,0),
               'co', coalesce(co.compoff,0)) order by coalesce(rq.category_id, pr.category_id), coalesce(rq.brand, pr.brand)), '[]')
      from rq full join pr on pr.category_id = rq.category_id and pr.brand = rq.brand
      left join co on co.category_id = coalesce(rq.category_id, pr.category_id) and co.brand = coalesce(rq.brand, pr.brand)),
    'present', (
      select coalesce(json_agg(x order by x.first_in), '[]') from (
        select a.id, a.code, a.name, a.category_id c, a.brand, a.vendor,
          to_char(min(p.ts) filter (where p.kind = 'IN') at time zone 'Asia/Kolkata', 'HH24:MI') first_in,
          to_char(max(p.ts) filter (where p.kind = 'OUT') at time zone 'Asia/Kolkata', 'HH24:MI') last_out,
          round((extract(epoch from (max(p.ts) filter (where p.kind = 'OUT') - min(p.ts) filter (where p.kind = 'IN'))) / 3600)::numeric, 1) hours,
          max(p.shift) filter (where p.kind = 'IN') shift,
          bool_or(p.device_kind = 'mod') via_mod,
          max(p.photo_status) filter (where p.photo_status <> 'none') photo
        from punches p join associates a on a.id = p.associate_id
        where p.store_code = v_store and p.work_date = p_date and a.category_id in (select _scope_cats(s))
          and (p_shift = 'B' or p.shift = p_shift)
        group by a.id) x),
    'regulars_missing', (
      select coalesce(json_agg(json_build_object('id', a.id, 'name', a.name, 'c', a.category_id, 'brand', a.brand, 'days', r.days) order by r.days desc), '[]')
      from (select p.associate_id, count(distinct p.work_date)::int days from punches p
            where p.store_code = v_store and p.kind = 'IN' and p.work_date between p_date - 7 and p_date - 1
            group by 1 having count(distinct p.work_date) >= 4) r
      join associates a on a.id = r.associate_id
      where a.category_id in (select _scope_cats(s))
        and not exists (select 1 from punches p where p.associate_id = a.id and p.work_date = p_date)
        and not exists (select 1 from compoffs c where c.associate_id = a.id and c.work_date = p_date)));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------- one store, date range (month to date) ----------
create or replace function public.store_range(p_token uuid, p_store text, p_from date, p_to date)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_store text; v_to date := least(p_to, _ist_today());
begin
  s := _sess(p_token);
  v_store := case when s.role = 'store' then s.store_code else upper(p_store) end;
  if v_store not in (select _scope_stores(s)) then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if p_to - p_from > 62 then return json_build_object('ok', false, 'error', 'RANGE_TOO_LONG'); end if;
  return json_build_object('ok', true, 'store', v_store, 'from', p_from, 'to', v_to,
    'by_category', (
      with days as (select d::date d from generate_series(p_from, v_to, interval '1 day') d),
      rq as (select r.category_id, sum(r.morning + r.evening)::int req
             from days cross join lateral _req(days.d) r where r.store_code = v_store group by 1),
      pr as (select p.category_id, count(*)::int present from (
               select distinct category_id, associate_id, work_date from punches
               where store_code = v_store and kind = 'IN' and work_date between p_from and v_to) p group by 1)
      select coalesce(json_agg(json_build_object('c', c.id, 'req', coalesce(rq.req,0), 'p', coalesce(pr.present,0)) order by c.sort), '[]')
      from categories c left join rq on rq.category_id = c.id left join pr on pr.category_id = c.id
      where c.id in (select _scope_cats(s)) and (rq.req is not null or pr.present is not null)),
    'associates', (
      select coalesce(json_agg(x order by x.c, x.name), '[]') from (
        select a.id, a.code, a.name, a.category_id c, a.brand, a.vendor,
          count(distinct d.work_date)::int present,
          (select count(*)::int from compoffs co where co.associate_id = a.id and co.work_date between p_from and v_to) compoff,
          greatest((v_to - greatest(p_from, min(d.work_date)) + 1) - count(distinct d.work_date)
                   - (select count(*)::int from compoffs co where co.associate_id = a.id and co.work_date between p_from and v_to), 0)::int absent,
          round(coalesce(sum(d.hrs), 0)::numeric, 1) hours
        from associates a
        join (select associate_id, work_date,
                extract(epoch from (max(ts) filter (where kind = 'OUT') - min(ts) filter (where kind = 'IN'))) / 3600 hrs
              from punches where store_code = v_store and work_date between p_from and v_to group by 1, 2) d on d.associate_id = a.id
        where a.category_id in (select _scope_cats(s))
        group by a.id) x));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------- staff churn ----------
create or replace function public.churn(p_token uuid, p_days int default 30)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_today date := _ist_today();
begin
  s := _sess(p_token);
  if s.role = 'store' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  return json_build_object('ok', true, 'days', p_days, 'rows', (
    with sc as (select _scope_stores(s) code), cs as (select _scope_cats(s) id),
    rq as (select r.store_code, r.category_id, r.brand, r.vendor, (r.morning + r.evening) req from _req(v_today) r
           where r.store_code in (select code from sc) and r.category_id in (select id from cs)),
    nm as (select a.store_code, a.category_id, a.brand, count(distinct a.id)::int names, max(a.vendor) vendor
           from associates a where a.store_code in (select code from sc) and a.category_id in (select id from cs)
             and exists (select 1 from punches p where p.associate_id = a.id and p.work_date > v_today - p_days)
           group by 1, 2, 3)
    select coalesce(json_agg(json_build_object('s', coalesce(rq.store_code, nm.store_code), 'c', coalesce(rq.category_id, nm.category_id),
             'brand', coalesce(rq.brand, nm.brand), 'vendor', coalesce(rq.vendor, nm.vendor),
             'req', coalesce(rq.req, 0), 'names', coalesce(nm.names, 0))), '[]')
    from rq full join nm on nm.store_code = rq.store_code and nm.category_id = rq.category_id and nm.brand = rq.brand));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------- associates list + monthly statement ----------
create or replace function public.associates_list(p_token uuid, p_store text)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_store text;
begin
  s := _sess(p_token);
  v_store := case when s.role = 'store' then s.store_code else upper(p_store) end;
  if v_store not in (select _scope_stores(s)) then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  return json_build_object('ok', true, 'rows', (select coalesce(json_agg(json_build_object('id', id, 'code', code, 'name', name,
      'c', category_id, 'brand', brand, 'vendor', vendor) order by category_id, name), '[]')
    from associates where store_code = v_store and category_id in (select _scope_cats(s))));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.statement(p_token uuid, p_associate bigint, p_from date, p_to date)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; a associates;
begin
  s := _sess(p_token);
  select * into a from associates where id = p_associate;
  if not found or a.store_code not in (select _scope_stores(s)) or a.category_id not in (select _scope_cats(s)) then
    return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  return json_build_object('ok', true,
    'associate', json_build_object('code', a.code, 'name', a.name, 'c', a.category_id, 'brand', a.brand, 'vendor', a.vendor,
       'cat_name', (select name from categories where id = a.category_id)),
    'store', json_build_object('code', a.store_code, 'name', (select name from stores where store_code = a.store_code)),
    'from', p_from, 'to', p_to,
    'days', (select coalesce(json_agg(json_build_object('d', d.d::date,
        'in', to_char(x.fi at time zone 'Asia/Kolkata', 'HH24:MI'), 'out', to_char(x.lo at time zone 'Asia/Kolkata', 'HH24:MI'),
        'hours', round((extract(epoch from (x.lo - x.fi)) / 3600)::numeric, 1),
        'co', exists (select 1 from compoffs c where c.associate_id = a.id and c.work_date = d.d)) order by d.d), '[]')
      from generate_series(p_from, p_to, interval '1 day') d(d)
      left join (select work_date, min(ts) filter (where kind = 'IN') fi, max(ts) filter (where kind = 'OUT') lo
                 from punches where associate_id = a.id and work_date between p_from and p_to group by 1) x on x.work_date = d.d::date));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.mark_compoff(p_token uuid, p_associate bigint, p_date date, p_on boolean default true)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; a associates;
begin
  s := _sess(p_token);
  select * into a from associates where id = p_associate;
  if not found or a.store_code not in (select _scope_stores(s)) or s.role not in ('store','admin') then
    return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if p_on then
    insert into compoffs(associate_id, work_date, marked_by) values (a.id, p_date, s.emp_code) on conflict do nothing;
  else
    delete from compoffs where associate_id = a.id and work_date = p_date;
  end if;
  return json_build_object('ok', true);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------- admin ----------
create or replace function public._admin(p_token uuid) returns sessions language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  s := _sess(p_token);
  if s.role <> 'admin' then raise exception 'FORBIDDEN'; end if;
  return s;
end $$;

create or replace function public.admin_get(p_token uuid, p_kind text)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  s := _admin(p_token);
  return json_build_object('ok', true, 'rows', case p_kind
    when 'stores' then (select coalesce(json_agg(to_jsonb(t) order by store_code), '[]') from stores t)
    when 'users' then (select coalesce(json_agg(json_build_object('emp_code', u.emp_code, 'name', u.name, 'role', u.role, 'post', u.post,
        'store_code', u.store_code, 'dept', d.name, 'active', u.active, 'pin_set', u.pin_hash is not null,
        'locked', u.locked_until > now(), 'last_login', to_char(u.last_login_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')) order by u.role, u.emp_code), '[]')
        from users u left join departments d on d.id = u.dept_id)
    when 'manpower' then (select coalesce(json_agg(json_build_object('store_code', r.store_code, 'category_id', r.category_id, 'brand', r.brand,
        'vendor', r.vendor, 'morning', r.morning, 'evening', r.evening,
        'effective_from', (select max(effective_from) from manpower m where m.store_code = r.store_code and m.category_id = r.category_id and m.brand = r.brand and m.effective_from <= _ist_today())
        ) order by r.store_code, r.category_id, r.brand), '[]') from _req(_ist_today()) r)
    when 'departments' then (select coalesce(json_agg(to_jsonb(t) order by name), '[]') from departments t)
    when 'categories' then (select coalesce(json_agg(to_jsonb(t) order by sort), '[]') from categories t)
    when 'settings' then (select to_json(t) from settings t where id = 1)
    else null end);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.admin_stores_upsert(p_token uuid, p_rows jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; n int;
begin
  s := _admin(p_token);
  insert into stores(store_code, name, city, am_emp, zfm_emp, lat, lng, active)
  select upper(btrim(r->>'store_code')), btrim(r->>'name'), nullif(btrim(r->>'city'),''), nullif(btrim(r->>'am_emp'),''), nullif(btrim(r->>'zfm_emp'),''),
         nullif(r->>'lat','')::double precision, nullif(r->>'lng','')::double precision, coalesce((r->>'active')::boolean, true)
  from jsonb_array_elements(p_rows) r
  on conflict (store_code) do update set name = excluded.name, city = excluded.city, am_emp = excluded.am_emp, zfm_emp = excluded.zfm_emp,
     lat = coalesce(excluded.lat, stores.lat), lng = coalesce(excluded.lng, stores.lng), active = excluded.active;
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'count', n);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.admin_users_upsert(p_token uuid, p_rows jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; n int;
begin
  s := _admin(p_token);
  insert into users(emp_code, name, role, post, store_code, dept_id, active)
  select btrim(r->>'emp_code'), btrim(r->>'name'), lower(btrim(r->>'role')), nullif(upper(btrim(r->>'post')),''),
         nullif(upper(btrim(r->>'store_code')),''), (select id from departments where lower(name) = lower(btrim(r->>'dept'))),
         coalesce((r->>'active')::boolean, true)
  from jsonb_array_elements(p_rows) r
  on conflict (emp_code) do update set name = excluded.name, role = excluded.role, post = excluded.post,
     store_code = excluded.store_code, dept_id = excluded.dept_id, active = excluded.active;
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'count', n);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- append a new version of required counts (never overwrites history)
create or replace function public.admin_manpower_upload(p_token uuid, p_rows jsonb, p_effective date)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; n int;
begin
  s := _admin(p_token);
  insert into manpower(store_code, category_id, brand, vendor, morning, evening, effective_from, uploaded_by)
  select upper(btrim(r->>'store_code')), c.id, coalesce(btrim(r->>'brand'), ''), nullif(btrim(r->>'vendor'),''),
         coalesce((r->>'morning')::int, 0), coalesce((r->>'evening')::int, 0),
         coalesce(nullif(r->>'effective_from','')::date, p_effective), s.emp_code
  from jsonb_array_elements(p_rows) r
  join categories c on lower(c.id) = lower(btrim(r->>'category')) or lower(c.name) = lower(btrim(r->>'category'));
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'count', n, 'skipped', jsonb_array_length(p_rows) - n);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.admin_dept_add(p_token uuid, p_name text, p_cats text[])
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  s := _admin(p_token);
  insert into departments(name, category_ids) values (btrim(p_name), coalesce(p_cats, '{}'))
  on conflict (name) do update set category_ids = excluded.category_ids;
  return json_build_object('ok', true);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.admin_settings_set(p_token uuid, p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  s := _admin(p_token);
  update settings set
    test_mode = coalesce((p->>'test_mode')::boolean, test_mode),
    radius_m = coalesce((p->>'radius_m')::int, radius_m),
    store_idle_min = coalesce((p->>'store_idle_min')::int, store_idle_min),
    pin_max_tries = coalesce((p->>'pin_max_tries')::int, pin_max_tries),
    pin_lock_min = coalesce((p->>'pin_lock_min')::int, pin_lock_min),
    storage_alert_pct = coalesce((p->>'storage_alert_pct')::int, storage_alert_pct),
    alert_email = coalesce(p->>'alert_email', alert_email)
  where id = 1;
  perform _log(s.emp_code, s.role, null, 'settings', null, p::text);
  return json_build_object('ok', true);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- PIN reset: admin = anyone; ZFM = users in their zone (store users + AMs)
create or replace function public.reset_pin(p_token uuid, p_emp text)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; u users;
begin
  s := _sess(p_token);
  select * into u from users where emp_code = btrim(p_emp);
  if not found then return json_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
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

-- users a ZFM may reset (for the ZFM's own screen)
create or replace function public.zone_users(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  s := _sess(p_token);
  if s.role not in ('zfm','admin') then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  return json_build_object('ok', true, 'rows', (select coalesce(json_agg(json_build_object('emp_code', u.emp_code, 'name', u.name,
      'role', u.role, 'post', u.post, 'store_code', u.store_code, 'pin_set', u.pin_hash is not null, 'locked', u.locked_until > now()) order by u.role, u.store_code, u.emp_code), '[]')
    from users u where u.active and ((u.role = 'store' and u.store_code in (select _scope_stores(s)))
       or (u.role = 'am' and u.emp_code in (select am_emp from stores where store_code in (select _scope_stores(s)))))));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- access log, per role tab
create or replace function public.access_view(p_token uuid, p_role text, p_date date)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; d0 timestamptz; d1 timestamptz;
begin
  s := _admin(p_token);
  d0 := (p_date::timestamp) at time zone 'Asia/Kolkata'; d1 := d0 + interval '1 day';
  return json_build_object('ok', true,
    'counts', (select json_object_agg(role, n) from (select role, count(*) n from users where active group by role) x),
    'kpi', json_build_object(
      'total', (select count(*) from users where active and role = p_role),
      'today', (select count(distinct emp_code) from access_log where role = p_role and event = 'login' and ts >= d0 and ts < d1),
      'ever', (select count(*) from users where active and role = p_role and first_login_at is not null),
      'auto_logout', (select count(*) from access_log where role = p_role and event = 'auto_logout' and ts >= d0 and ts < d1),
      'pin_resets', (select count(*) from access_log where role = p_role and event = 'pin_reset' and ts >= d0 and ts < d1)),
    'users', (select coalesce(json_agg(x order by x.last_login_ts desc nulls last), '[]') from (
        select u.emp_code, u.name, u.post, u.store_code, d.name dept, u.last_login_at last_login_ts,
          to_char(u.last_login_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') last_login,
          u.first_login_at is not null ever,
          (select json_build_object('event', l.event, 'at', to_char(l.ts at time zone 'Asia/Kolkata', 'HH24:MI'))
             from access_log l where l.emp_code = u.emp_code and l.ts >= d0 and l.ts < d1 order by l.ts desc limit 1) last_event,
          exists (select 1 from sessions se where se.emp_code = u.emp_code and se.ended_at is null) active_now
        from users u left join departments d on d.id = u.dept_id where u.active and u.role = p_role) x),
    'resets', (select coalesce(json_agg(json_build_object('emp', l.emp_code, 'name', u.name, 'store', l.store_code, 'role', l.role,
         'by', l.by_emp, 'by_name', b.name, 'at', to_char(l.ts at time zone 'Asia/Kolkata', 'HH24:MI')) order by l.ts desc), '[]')
       from access_log l left join users u on u.emp_code = l.emp_code left join users b on b.emp_code = l.by_emp
       where l.event = 'pin_reset' and l.ts >= d0 and l.ts < d1));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

grant execute on function public.dash_overview(uuid,date,text,time) to anon;
grant execute on function public.dash_store(uuid,text,date,text) to anon;
grant execute on function public.store_range(uuid,text,date,date) to anon;
grant execute on function public.churn(uuid,int) to anon;
grant execute on function public.associates_list(uuid,text) to anon;
grant execute on function public.statement(uuid,bigint,date,date) to anon;
grant execute on function public.mark_compoff(uuid,bigint,date,boolean) to anon;
grant execute on function public.admin_get(uuid,text) to anon;
grant execute on function public.admin_stores_upsert(uuid,jsonb) to anon;
grant execute on function public.admin_users_upsert(uuid,jsonb) to anon;
grant execute on function public.admin_manpower_upload(uuid,jsonb,date) to anon;
grant execute on function public.admin_dept_add(uuid,text,text[]) to anon;
grant execute on function public.admin_settings_set(uuid,jsonb) to anon;
grant execute on function public.reset_pin(uuid,text) to anon;
grant execute on function public.zone_users(uuid) to anon;
grant execute on function public.access_view(uuid,text,date) to anon;
