-- v5.3: Store + HO Dept never see OUT time / hours (IN time + 'out_done' flag only). Security already shows status only.
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
          max(g.st) st
        from punches p join associates a on a.id = p.associate_id
        left join sgd g on g.associate_id = a.id
        where p.store_code = v_store and p.work_date = p_date and a.category_id in (select _scope_cats(s))
          and (p_shift = 'B' or p.shift = p_shift)
        group by a.id
        union all
        select a.id, a.code, a.name, a.category_id, a.brand, a.vendor, null::text, null::text, null::numeric, null::boolean, g.shift, false, null::text, null::text, g.st
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


create or replace function public.statement(p_token uuid, p_associate bigint, p_from date, p_to date)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; a associates; v_today date := _ist_today(); v_full boolean;
begin
  s := _sess(p_token);
  v_full := s.role not in ('store','hodept');
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
        'in', to_char(x.fi at time zone 'Asia/Kolkata', 'HH24:MI'), 'out', case when v_full then to_char(x.lo at time zone 'Asia/Kolkata', 'HH24:MI') end,
        'hours', case when v_full then round((extract(epoch from (x.lo - x.fi)) / 3600)::numeric, 1) end,
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


create or replace function public.store_range(p_token uuid, p_store text, p_from date, p_to date)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare s sessions; v_store text; v_to date := least(p_to, _ist_today()); v_full boolean;
begin
  s := _sess(p_token);
  v_full := s.role not in ('store','hodept');
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
          case when v_full then round(coalesce(sum(d.hrs), 0)::numeric, 1) end hours
        from associates a
        join (select associate_id, work_date,
                extract(epoch from (max(ts) filter (where kind = 'OUT') - min(ts) filter (where kind = 'IN'))) / 3600 hrs
              from punches where store_code = v_store and work_date between p_from and v_to group by 1, 2) d on d.associate_id = a.id
        where a.category_id in (select _scope_cats(s))
        group by a.id) x));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $function$;

notify pgrst, 'reload schema';
