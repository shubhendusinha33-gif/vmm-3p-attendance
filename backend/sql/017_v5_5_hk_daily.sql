-- v5.5: SM / ASM confirm HK Morning / Evening split once a day (prompt after login until saved today)
create or replace function public.hk_split_get(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; h record; v_post text; v_can boolean; v_today boolean;
begin
  s := _sess(p_token);
  if s.role <> 'store' then return json_build_object('ok', false, 'error', 'FORBIDDEN'); end if;
  select * into h from _hk_state(_ist_today()) x where x.store_code = s.store_code;
  select post into v_post from users where emp_code = s.emp_code;
  v_can := upper(btrim(coalesce(v_post, ''))) in ('SM', 'ASM') and s.view_by is null;
  v_today := exists (select 1 from hk_split where store_code = s.store_code and (created_at at time zone 'Asia/Kolkata')::date = _ist_today());
  return json_build_object('ok', true, 'store', s.store_code, 'has_hk', h.store_code is not null,
    'total', h.hk_total, 'vendor', h.vendor, 'set', coalesce(h.split_set, false),
    'morning', case when h.split_set then h.morning end, 'evening', case when h.split_set then h.evening end,
    'effective_from', case when h.split_set then h.split_from end,
    'saved_today', v_today, 'need_today', h.store_code is not null and h.hk_total is not null and v_can and not v_today,
    'history', (select coalesce(json_agg(json_build_object('effective_from', x.effective_from, 'morning', x.morning, 'evening', x.evening,
                  'by', x.set_by, 'by_name', u.name, 'at', to_char(x.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI'))
                  order by x.effective_from desc, x.id desc), '[]')
                from (select * from hk_split where store_code = s.store_code order by effective_from desc, id desc limit 20) x
                left join users u on u.emp_code = x.set_by));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;
revoke all on function public.hk_split_get(uuid) from public, authenticated;
grant execute on function public.hk_split_get(uuid) to anon;
notify pgrst, 'reload schema';
