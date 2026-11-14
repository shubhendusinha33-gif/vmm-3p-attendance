insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('selfies', 'selfies', false, 20480, array['image/webp','image/jpeg'])
on conflict (id) do nothing;

create or replace function public._storage_usage()
returns bigint language sql stable security definer set search_path = public, storage as $$
  select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'selfies'
$$;
revoke execute on function public._storage_usage() from public, anon, authenticated;
grant execute on function public._storage_usage() to service_role;

create or replace function public.admin_punch_export(p_token uuid, p_from date, p_to date)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions;
begin
  s := _admin(p_token);
  if p_to - p_from > 62 then return json_build_object('ok', false, 'error', 'RANGE_TOO_LONG'); end if;
  return json_build_object('ok', true, 'rows', (select coalesce(json_agg(json_build_object(
      'date', p.work_date, 'store', p.store_code, 'code', a.code, 'name', a.name, 'category', p.category_id, 'brand', p.brand,
      'vendor', p.vendor, 'kind', p.kind, 'time', to_char(p.ts at time zone 'Asia/Kolkata', 'HH24:MI'), 'shift', p.shift,
      'device', p.device_kind, 'mod_emp', p.mod_emp, 'dist_m', p.dist_m, 'photo', p.photo_status) order by p.work_date, p.store_code, p.ts), '[]')
    from punches p join associates a on a.id = p.associate_id where p.work_date between p_from and p_to));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;
revoke execute on function public.admin_punch_export(uuid,date,date) from public, authenticated;
grant execute on function public.admin_punch_export(uuid,date,date) to anon;
