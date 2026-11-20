-- v5.4: N-day trend (dash_days), punch source in dash_store, live punch feed, web push subscriptions.
create or replace function public.dash_days(p_token uuid, p_end date, p_shift text default 'B', p_days int default 7)
returns json language plpgsql security definer set search_path = public as $$
declare v_s sessions; v_today date := _ist_today(); v_n int := least(greatest(coalesce(p_days, 7), 1), 31);
begin
  v_s := _sess(p_token);
  return json_build_object('ok', true, 'end', p_end, 'days', v_n, 'rows', (
    with sc as (select _scope_stores(v_s) code), cs as (select _scope_cats(v_s) id),
    dd as (select (p_end - g)::date d from generate_series(0, v_n - 1) g),
    rq as (select dd.d, r.store_code sx, r.category_id cx, sum(_shift_req(r.morning, r.evening, p_shift))::int req
           from dd cross join lateral _req(dd.d) r
           where r.store_code in (select code from sc) and r.category_id in (select id from cs) group by 1, 2, 3),
    pr as (select p.work_date d, p.store_code sx, p.category_id cx, count(distinct p.associate_id)::int n
           from punches p where p.work_date between p_end - (v_n - 1) and p_end and p.kind = 'IN'
             and p.store_code in (select code from sc) and p.category_id in (select id from cs)
             and (p_shift = 'B' or p.shift = p_shift)
             and not (p.category_id = 'SEC' and p.work_date < v_today)
           group by 1, 2, 3
           union all
           select g.work_date, g.store_code, 'SEC', count(*)::int
           from _sg_status(p_end - (v_n - 1), least(p_end, v_today - 1)) g
           where 'SEC' in (select id from cs) and g.store_code in (select code from sc) and g.st in ('P','H','P*')
             and (p_shift = 'B' or g.shift = p_shift)
           group by 1, 2),
    co as (select c.work_date d, a.store_code sx, a.category_id cx, count(*)::int n
           from compoffs c join associates a on a.id = c.associate_id
           where c.work_date between p_end - (v_n - 1) and p_end and a.store_code in (select code from sc) group by 1, 2, 3),
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
declare s sessions; v_store text; v_sgday boolean := p_date < _ist_today(); st stores; h record; v_full boolean;
begin
  s := _sess(p_token);
  v_full := s.role not in ('store','hodept');   -- v5.3: store + HO Dept never see OUT time / hours
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
          case when a.category_id <> 'SEC' and v_full then to_char(max(p.ts) filter (where p.kind = 'OUT') at time zone 'Asia/Kolkata', 'HH24:MI') end last_out,
          case when a.category_id <> 'SEC' and v_full then round((extract(epoch from (max(p.ts) filter (where p.kind = 'OUT') - min(p.ts) filter (where p.kind = 'IN'))) / 3600)::numeric, 1) end hours,
          case when a.category_id <> 'SEC' then (array_agg(p.kind order by p.ts desc))[1] = 'OUT' end out_done,
          max(p.shift) filter (where p.kind = 'IN') shift,
          bool_or(p.device_kind = 'mod') via_mod,
          max(p.photo_status) filter (where p.photo_status <> 'none') photo, max(p.live) live,
          max(g.st) st,
          (select json_agg(json_build_object('k', p2.kind, 't', case when p2.kind = 'IN' or v_full then to_char(p2.ts at time zone 'Asia/Kolkata', 'HH24:MI') end,
              'src', case when p2.device_kind = 'mod' then 'store' when p2.store_code <> a.store_code then 'cross' else 'own' end,
              'by', um.name, 'post', um.post, 'dist', p2.dist_m, 'home', a.store_code,
              'appr', (select ux.name || coalesce(' (' || ux.post || ')', '') from cross_store_allow x join users ux on ux.emp_code = x.by_emp
                       where x.associate_id = a.id and x.store_code = p2.store_code and x.work_date = p2.work_date limit 1)) order by p2.ts)
           from punches p2 left join users um on um.emp_code = p2.mod_emp where p2.associate_id = a.id and p2.work_date = p_date and p2.store_code = v_store) src
        from punches p join associates a on a.id = p.associate_id
        left join sgd g on g.associate_id = a.id
        where p.store_code = v_store and p.work_date = p_date and a.category_id in (select _scope_cats(s))
          and (p_shift = 'B' or p.shift = p_shift)
        group by a.id
        union all
        select a.id, a.code, a.name, a.category_id, a.brand, a.vendor, null::text, null::text, null::numeric, null::boolean, g.shift, false, null::text, null::text, g.st, null::json
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




-- live punch feed: newest punches in the caller's scope after p_since (id). p_since null = just return the latest id.
create or replace function public.punch_feed(p_token uuid, p_since bigint default null, p_limit int default 20)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_full boolean; v_max bigint;
begin
  s := _sess(p_token);
  v_full := s.role not in ('store','hodept');
  select max(id) into v_max from punches where work_date >= _ist_today() - 1;
  if p_since is null then return json_build_object('ok', true, 'last', coalesce(v_max, 0), 'rows', '[]'::json); end if;
  return json_build_object('ok', true, 'last', greatest(coalesce(v_max, 0), p_since), 'rows', (
    select coalesce(json_agg(x order by x.id), '[]') from (
      select p.id, p.kind k, case when p.kind = 'IN' or v_full then to_char(p.ts at time zone 'Asia/Kolkata', 'HH24:MI') end t,
        a.name, a.code, c.name cat, coalesce(p.vendor, a.vendor) vendor, p.store_code store, st.name store_name,
        case when p.device_kind = 'mod' then 'store' when p.store_code <> a.store_code then 'cross' else 'own' end src,
        um.name by_name, um.post by_post, p.dist_m dist, a.store_code home
      from punches p join associates a on a.id = p.associate_id join categories c on c.id = p.category_id join stores st on st.store_code = p.store_code
      left join users um on um.emp_code = p.mod_emp
      where p.id > p_since and p.store_code in (select _scope_stores(s)) and p.category_id in (select _scope_cats(s))
      order by p.id limit least(greatest(coalesce(p_limit, 20), 1), 50)) x));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- web push subscriptions (store management only; one row per browser endpoint)
create table if not exists public.push_subs (
  id bigserial primary key, emp_code text not null references public.users(emp_code) on delete cascade, role text not null, store_code text,
  endpoint text not null unique, p256dh text not null, auth text not null, ua text,
  created_at timestamptz not null default now(), last_ok timestamptz, fails int not null default 0);
create index if not exists push_subs_store_idx on public.push_subs (store_code);
alter table public.push_subs enable row level security;
alter table public.punches add column if not exists notified_at timestamptz;
create index if not exists punches_notify_idx on public.punches (store_code, ts) where notified_at is null;
-- server-only secrets (service role reads them; no anon access: RLS on, no policies)
create table if not exists public.app_secrets (name text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
-- VAPID keys for web push: values are filled by the separate paste file (not stored in git)
-- insert into public.app_secrets(name, value) values ('vapid_public','...'),('vapid_private','...'),('vapid_subject','mailto:...') on conflict (name) do update set value = excluded.value;

create or replace function public.push_subscribe(p_token uuid, p_sub jsonb, p_ua text default null)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_ep text := p_sub->>'endpoint';
begin
  s := _sess_rw(p_token);
  if s.role <> 'store' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  if v_ep is null or v_ep !~ '^https://' or p_sub->'keys'->>'p256dh' is null or p_sub->'keys'->>'auth' is null then
    return json_build_object('ok', false, 'error', 'BAD_SUB'); end if;
  insert into push_subs(emp_code, role, store_code, endpoint, p256dh, auth, ua)
  values (s.emp_code, s.role, s.store_code, v_ep, p_sub->'keys'->>'p256dh', p_sub->'keys'->>'auth', left(p_ua, 200))
  on conflict (endpoint) do update set emp_code = excluded.emp_code, role = excluded.role, store_code = excluded.store_code,
    p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua, fails = 0;
  perform _log(s.emp_code, s.role, s.store_code, 'push_on', null, left(p_ua, 120));
  return json_build_object('ok', true);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.push_unsubscribe(p_token uuid, p_endpoint text)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; n int;
begin
  select * into s from sessions where token = p_token;
  delete from push_subs where endpoint = p_endpoint and (s.emp_code is null or emp_code = s.emp_code);
  get diagnostics n = row_count;
  if n > 0 and s.emp_code is not null then perform _log(s.emp_code, s.role, s.store_code, 'push_off', null, null); end if;
  return json_build_object('ok', true, 'removed', n);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

do $$ declare f text; begin
  foreach f in array array['dash_days(uuid,date,text,int)', 'punch_feed(uuid,bigint,int)', 'push_subscribe(uuid,jsonb,text)', 'push_unsubscribe(uuid,text)'] loop
    execute format('revoke execute on function public.%s from public, authenticated', f);
    execute format('grant execute on function public.%s to anon', f);
  end loop; end $$;
notify pgrst, 'reload schema';
