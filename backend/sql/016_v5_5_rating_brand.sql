-- v5.5: daily staff rating (SM/ASM, previous day, 1 per staff per day, reason for 1–2 ★),
--       brand / vendor-wise dashboard rows, light "vs yesterday" totals, statement with rating.

-- ---------- rating table ----------
create table if not exists public.staff_rating (
  id bigserial primary key,
  associate_id bigint not null references associates(id) on delete cascade,
  store_code text not null,
  work_date date not null,
  stars smallint not null check (stars between 1 and 5),
  reason_tag text,
  reason text,
  rated_by text not null,
  rated_post text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  updated_by text,
  unique (associate_id, work_date)
);
create index if not exists staff_rating_store_day on staff_rating(store_code, work_date);
alter table staff_rating enable row level security;
revoke all on staff_rating from anon, authenticated;

alter table settings add column if not exists rating_from date;
update settings set rating_from = coalesce(rating_from, _ist_today() - 1) where id = 1;

create or replace function public._bkey(b text, v text) returns text language sql immutable as $$
  select coalesce(nullif(btrim(b), ''), nullif(regexp_replace(btrim(v), '\s+', ' ', 'g'), ''), '—') $$;

-- ---------- store: what must be rated (yesterday) ----------
create or replace function public.rating_pending(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_post text; v_d date := _ist_today() - 1; v_can boolean; v_rows json; v_left int;
begin
  s := _sess(p_token);
  if s.role <> 'store' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  select post into v_post from users where emp_code = s.emp_code;
  v_can := upper(btrim(coalesce(v_post, ''))) in ('SM', 'ASM') and s.view_by is null;
  select coalesce(json_agg(json_build_object('id', a.id, 'code', a.code, 'name', a.name, 'c', a.category_id,
           'brand', a.brand, 'vendor', a.vendor, 'stars', r.stars, 'tag', r.reason_tag, 'note', r.reason) order by c.sort, a.name), '[]'),
         count(*) filter (where r.id is null)
    into v_rows, v_left
  from (select distinct associate_id from punches where store_code = s.store_code and work_date = v_d and kind = 'IN') x
  join associates a on a.id = x.associate_id
  left join categories c on c.id = a.category_id
  left join staff_rating r on r.associate_id = a.id and r.work_date = v_d;
  return json_build_object('ok', true, 'date', v_d, 'post', v_post, 'can_rate', v_can,
    'need', v_can and v_left > 0 and v_d >= coalesce((select rating_from from settings where id = 1), v_d),
    'left', v_left, 'rows', v_rows,
    'tags', json_build_array('Late', 'Not at post', 'Uniform', 'Behaviour', 'Mobile use', 'Other'));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.rating_submit(p_token uuid, p_items json)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_post text; v_d date := _ist_today() - 1; it json; v_a bigint; v_s int; v_tag text; v_note text; n int := 0; k int; v_left int;
begin
  s := _sess(p_token);
  if s.role <> 'store' or s.view_by is not null then raise exception 'FORBIDDEN'; end if;
  select post into v_post from users where emp_code = s.emp_code;
  if upper(btrim(coalesce(v_post, ''))) not in ('SM', 'ASM') then raise exception 'ONLY_SM_ASM'; end if;
  for it in select * from json_array_elements(coalesce(p_items, '[]'::json)) loop
    v_a := (it->>'a')::bigint; v_s := (it->>'s')::int;
    v_tag := nullif(btrim(coalesce(it->>'tag', '')), ''); v_note := nullif(btrim(coalesce(it->>'note', '')), '');
    if v_s is null or v_s not between 1 and 5 then raise exception 'BAD_STARS'; end if;
    if v_s <= 2 and (v_tag is null or v_note is null or length(v_note) < 3) then raise exception 'REASON_REQUIRED'; end if;
    if not exists (select 1 from punches where associate_id = v_a and store_code = s.store_code and work_date = v_d and kind = 'IN') then
      raise exception 'NOT_PRESENT'; end if;
    insert into staff_rating(associate_id, store_code, work_date, stars, reason_tag, reason, rated_by, rated_post)
    values (v_a, s.store_code, v_d, v_s, case when v_s <= 2 then v_tag end, case when v_s <= 2 then left(v_note, 300) end, s.emp_code, v_post)
    on conflict (associate_id, work_date) do nothing;
    get diagnostics k = row_count; n := n + k;
  end loop;
  select count(*) into v_left
  from (select distinct associate_id from punches where store_code = s.store_code and work_date = v_d and kind = 'IN') x
  where not exists (select 1 from staff_rating r where r.associate_id = x.associate_id and r.work_date = v_d);
  perform _log(s.emp_code, s.role, s.store_code, 'rating', null, 'rated ' || n || ' for ' || v_d || ' · left ' || v_left);
  return json_build_object('ok', true, 'saved', n, 'left', v_left);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- admin may correct / remove a rating
create or replace function public.rating_admin_set(p_token uuid, p_associate bigint, p_date date, p_stars int, p_tag text default null, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_store text;
begin
  s := _admin(p_token);
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  if p_stars is null then
    delete from staff_rating where associate_id = p_associate and work_date = p_date;
  else
    if p_stars not between 1 and 5 then raise exception 'BAD_STARS'; end if;
    if p_stars <= 2 and (nullif(btrim(coalesce(p_tag, '')), '') is null or length(btrim(coalesce(p_note, ''))) < 3) then raise exception 'REASON_REQUIRED'; end if;
    select store_code into v_store from punches where associate_id = p_associate and work_date = p_date and kind = 'IN' order by ts limit 1;
    if v_store is null then raise exception 'NOT_PRESENT'; end if;
    insert into staff_rating(associate_id, store_code, work_date, stars, reason_tag, reason, rated_by, rated_post)
    values (p_associate, v_store, p_date, p_stars, case when p_stars <= 2 then p_tag end, case when p_stars <= 2 then left(p_note, 300) end, s.emp_code, 'Admin')
    on conflict (associate_id, work_date) do update set stars = excluded.stars, reason_tag = excluded.reason_tag, reason = excluded.reason,
      updated_at = now(), updated_by = s.emp_code;
  end if;
  perform _log(s.emp_code, s.role, null, 'rating_edit', null, p_associate || ' ' || p_date || ' → ' || coalesce(p_stars::text, 'removed'));
  return json_build_object('ok', true);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------- AM / ZFM / Admin / HO Dept: tasks + summary ----------
create or replace function public.rating_tasks(p_token uuid, p_from date, p_to date)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_today date := _ist_today(); f date; t date;
begin
  s := _sess(p_token);
  t := least(coalesce(p_to, v_today - 1), v_today - 1);
  f := greatest(coalesce(p_from, t), t - 61, coalesce((select rating_from from settings where id = 1), t));
  return (
  with sc as (select _scope_stores(s) code), cs as (select _scope_cats(s) id),
  pr as (select distinct p.store_code, p.work_date d, p.associate_id from punches p
         where p.work_date between f and t and p.kind = 'IN' and p.store_code in (select code from sc) and p.category_id in (select id from cs)),
  j as (select pr.store_code, pr.d, pr.associate_id, a.name, a.category_id c, _bkey(a.brand, a.vendor) b,
               r.stars, r.reason_tag, r.reason, r.rated_by, r.rated_post
        from pr join associates a on a.id = pr.associate_id
        left join staff_rating r on r.associate_id = pr.associate_id and r.work_date = pr.d),
  mg as (select u.store_code, string_agg(u.name || ' (' || u.post || ')', ', ' order by u.post desc, u.name) who
         from users u where u.role = 'store' and u.active and upper(coalesce(u.post, '')) in ('SM', 'ASM') group by 1),
  st as (select j.store_code, j.d, count(*)::int n, count(j.stars)::int rated, round(avg(j.stars), 1) avg,
                count(*) filter (where j.stars <= 2)::int low from j group by 1, 2)
  select json_build_object('ok', true, 'from', f, 'to', t, 'yesterday', v_today - 1,
    'stores', (select coalesce(json_agg(json_build_object('s', st.store_code, 'name', so.name, 'am', so.am_emp, 'am_name', ua.name, 'zfm', so.zfm_emp, 'zfm_name', uz.name,
                 'd', st.d, 'n', st.n, 'rated', st.rated, 'avg', st.avg, 'low', st.low, 'who', mg.who,
                 'st', case when st.rated >= st.n then 'done' when st.d = v_today - 1 then 'pending' else 'missed' end)
                 order by case when st.rated >= st.n then 2 when st.d = v_today - 1 then 0 else 1 end, st.d desc, st.store_code), '[]')
               from st join stores so on so.store_code = st.store_code left join users ua on ua.emp_code = so.am_emp
               left join users uz on uz.emp_code = so.zfm_emp left join mg on mg.store_code = st.store_code),
    'brands', (select coalesce(json_agg(json_build_object('c', x.c, 'b', x.b, 'n', x.n, 'rated', x.rated, 'avg', x.avg, 'low', x.low) order by x.c, x.n desc), '[]')
               from (select j.c, j.b, count(*)::int n, count(j.stars)::int rated, round(avg(j.stars), 1) avg, count(*) filter (where j.stars <= 2)::int low
                     from j group by 1, 2) x),
    'low', (select coalesce(json_agg(json_build_object('s', j.store_code, 'd', j.d, 'id', j.associate_id, 'name', j.name, 'c', j.c, 'b', j.b, 'stars', j.stars,
                 'tag', j.reason_tag, 'note', j.reason, 'by', coalesce(u.name, j.rated_by), 'post', j.rated_post) order by j.d desc, j.stars, j.store_code), '[]')
            from (select * from j where j.stars <= 2 order by j.d desc limit 400) j left join users u on u.emp_code = j.rated_by)));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.rating_detail(p_token uuid, p_store text, p_date date)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  s := _sess(p_token);
  if upper(p_store) not in (select _scope_stores(s)) then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  return json_build_object('ok', true, 'store', upper(p_store), 'date', p_date, 'can_edit', s.role = 'admin' and s.view_by is null,
    'rows', (select coalesce(json_agg(json_build_object('id', a.id, 'code', a.code, 'name', a.name, 'c', a.category_id, 'brand', a.brand, 'vendor', a.vendor,
               'stars', r.stars, 'tag', r.reason_tag, 'note', r.reason, 'by', coalesce(u.name, r.rated_by), 'post', r.rated_post, 'at', r.created_at, 'edited', r.updated_at is not null)
               order by a.category_id, a.name), '[]')
             from (select distinct associate_id from punches where store_code = upper(p_store) and work_date = p_date and kind = 'IN') x
             join associates a on a.id = x.associate_id
             left join staff_rating r on r.associate_id = a.id and r.work_date = p_date
             left join users u on u.emp_code = r.rated_by
             where a.category_id in (select _scope_cats(s))));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------- dashboard: brand (Travel/CDIT) / vendor (HK/Security) rows, loaded only when a dept is picked ----------
create or replace function public.dash_brands(p_token uuid, p_date date, p_shift text, p_upto time default null, p_cat text default null)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_today date := _ist_today(); v_sgday boolean;
begin
  s := _sess(p_token);
  v_sgday := p_date < v_today and p_upto is null;
  return (
  with sc as (select _scope_stores(s) code),
  cs as (select id from (select _scope_cats(s) id) z where p_cat is null or z.id = p_cat),
  rq as (select r.store_code sx, r.category_id cx, _bkey(r.brand, r.vendor) bx, sum(_shift_req(r.morning, r.evening, p_shift))::int req
         from _req(p_date) r where r.store_code in (select code from sc) and r.category_id in (select id from cs) group by 1, 2, 3),
  pr as (select p.store_code sx, p.category_id cx, _bkey(coalesce(nullif(p.brand, ''), a.brand), coalesce(nullif(p.vendor, ''), a.vendor)) bx, count(distinct p.associate_id)::int n
         from punches p join associates a on a.id = p.associate_id
         where p.work_date = p_date and p.kind = 'IN' and p.store_code in (select code from sc) and p.category_id in (select id from cs)
           and (p_shift = 'B' or p.shift = p_shift)
           and (p_upto is null or (p.ts at time zone 'Asia/Kolkata')::time <= p_upto)
           and not (v_sgday and p.category_id = 'SEC')
         group by 1, 2, 3
         union all
         select g.store_code, 'SEC', _bkey(a.brand, a.vendor), count(*)::int
         from _sg_status(p_date, p_date) g join associates a on a.id = g.associate_id
         where v_sgday and 'SEC' in (select id from cs) and g.store_code in (select code from sc) and g.st in ('P', 'H', 'P*')
           and (p_shift = 'B' or g.shift = p_shift)
         group by 1, 3),
  co as (select a.store_code sx, a.category_id cx, _bkey(a.brand, a.vendor) bx, count(*)::int n
         from compoffs c join associates a on a.id = c.associate_id
         where c.work_date = p_date and a.store_code in (select code from sc) group by 1, 2, 3),
  j as (select coalesce(rq.sx, pr.sx) sx, coalesce(rq.cx, pr.cx) cx, coalesce(rq.bx, pr.bx) bx,
               greatest(coalesce(rq.req, 0) - coalesce(co.n, 0), 0) req, coalesce(pr.n, 0) pn
        from rq full join pr on pr.sx = rq.sx and pr.cx = rq.cx and lower(pr.bx) = lower(rq.bx)
        left join co on co.sx = coalesce(rq.sx, pr.sx) and co.cx = coalesce(rq.cx, pr.cx) and lower(co.bx) = lower(coalesce(rq.bx, pr.bx)))
  select json_build_object('ok', true, 'date', p_date, 'shift', p_shift, 'cat', p_cat,
    'rows', (select coalesce(json_agg(json_build_array(j.sx, j.cx, j.bx, j.req, j.pn)), '[]') from j where j.req > 0 or j.pn > 0)));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ---------- dashboard: light totals for "vs yesterday" ----------
create or replace function public.dash_ytot(p_token uuid, p_date date, p_shift text, p_upto time default null)
returns json language plpgsql security definer set search_path = public as $$
declare v json;
begin
  v := dash_overview(p_token, p_date, p_shift, p_upto);
  if not coalesce((v->>'ok')::boolean, false) then return v; end if;
  return json_build_object('ok', true, 'date', p_date,
    'rows', (select coalesce(json_agg(json_build_array(r->>'s', r->>'c', (r->>'req')::int, (r->>'p')::int)), '[]') from json_array_elements(v->'rows') r));
end $$;

-- ---------- statement: + rating per day ----------
create or replace function public.statement(p_token uuid, p_associate bigint, p_from date, p_to date)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; a associates; v_today date := _ist_today(); v_full boolean; v_rf date;
begin
  s := _sess(p_token);
  v_full := s.role not in ('store','hodept');
  v_rf := coalesce((select rating_from from settings where id = 1), v_today);
  select * into a from associates where id = p_associate;
  if not found or a.store_code not in (select _scope_stores(s)) or a.category_id not in (select _scope_cats(s)) then
    return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  return json_build_object('ok', true,
    'associate', json_build_object('id', a.id, 'code', a.code, 'name', a.name, 'c', a.category_id, 'brand', a.brand, 'vendor', a.vendor,
       'cat_name', (select name from categories where id = a.category_id)),
    'store', json_build_object('code', a.store_code, 'name', (select name from stores where store_code = a.store_code),
       'sg_set', (select sg_set from stores where store_code = a.store_code)),
    'from', p_from, 'to', p_to, 'rating_from', v_rf,
    'days', (select coalesce(json_agg(json_build_object('d', d.d::date,
        'in', to_char(x.fi at time zone 'Asia/Kolkata', 'HH24:MI'), 'out', case when v_full then to_char(x.lo at time zone 'Asia/Kolkata', 'HH24:MI') end,
        'hours', case when v_full then round((extract(epoch from (x.lo - x.fi)) / 3600)::numeric, 1) end,
        'co', cx.co,
        'st', case when cx.co then 'CO'
                   when a.category_id = 'SEC' then case when g.st in ('P','P*','IN') then 'P' when g.st = 'H' then 'H'
                                                        when g.st in ('A','MP') then 'A' when d.d::date >= v_today then '' else 'A' end
                   when x.fi is not null then 'P'
                   when d.d::date >= v_today then '' else 'A' end,
        'sg', g.st,
        'rs', rt.stars, 'rtag', rt.reason_tag, 'rnote', rt.reason, 'rby', rt.who,
        'rmiss', rt.stars is null and x.fi is not null and d.d::date >= v_rf and d.d::date < v_today) order by d.d), '[]')
      from generate_series(p_from, p_to, interval '1 day') d(d)
      cross join lateral (select exists (select 1 from compoffs c where c.associate_id = a.id and c.work_date = d.d::date) co) cx
      left join (select work_date, min(ts) filter (where kind = 'IN') fi, max(ts) filter (where kind = 'OUT') lo
                 from punches where associate_id = a.id and work_date between p_from and p_to group by 1) x on x.work_date = d.d::date
      left join (select y.work_date, y.st from _sg_status(p_from, p_to) y where a.category_id = 'SEC' and y.associate_id = a.id) g
        on g.work_date = d.d::date
      left join (select r.work_date, r.stars, r.reason_tag, r.reason, coalesce(u.name, r.rated_by) || coalesce(' (' || r.rated_post || ')', '') who
                 from staff_rating r left join users u on u.emp_code = r.rated_by
                 where r.associate_id = a.id and r.work_date between p_from and p_to) rt on rt.work_date = d.d::date));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

do $$ declare f text; begin
  foreach f in array array['rating_pending(uuid)', 'rating_submit(uuid, json)', 'rating_admin_set(uuid, bigint, date, integer, text, text)',
    'rating_tasks(uuid, date, date)', 'rating_detail(uuid, text, date)', 'dash_brands(uuid, date, text, time, text)', 'dash_ytot(uuid, date, text, time)'] loop
    execute format('revoke execute on function public.%s from public, authenticated', f);
    execute format('grant execute on function public.%s to anon', f);
  end loop;
end $$;
notify pgrst, 'reload schema';
