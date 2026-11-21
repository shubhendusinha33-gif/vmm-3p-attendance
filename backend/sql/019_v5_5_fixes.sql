-- v5.5 fixes (applied as v5_5_g_bot_log_err, v5_5_h_bot_feedback, v5_5_i_subs_ts_fix)
alter table bot_log add column if not exists err text;
alter table bot_log add column if not exists a text;
alter table bot_log add column if not exists fb smallint check (fb in (-1, 1));
alter table bot_log add column if not exists fb_at timestamptz;

-- Submissions: two columns were both called "ts" (display time + raw timestamp) → "ambiguous" error
CREATE OR REPLACE FUNCTION public.admin_punches_list(p_token uuid, p_date date, p_zfm text DEFAULT NULL::text, p_am text DEFAULT NULL::text, p_q text DEFAULT NULL::text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare s sessions; v_q text := upper(btrim(coalesce(p_q, '')));
begin
  s := _admin(p_token);
  return json_build_object('ok', true, 'date', p_date,
    'rows', (select coalesce(json_agg(x order by x.store, x.ts_at), '[]') from (
      select p.id, p.store_code store, st.name store_name, uz.name zfm_name, ua.name am_name, a.name, a.code, p.category_id c,
             coalesce(nullif(p.brand, ''), a.brand) brand, coalesce(nullif(p.vendor, ''), a.vendor) vendor, p.kind,
             to_char(p.ts at time zone 'Asia/Kolkata', 'HH24:MI') ts, p.ts ts_at, p.device_kind, p.mod_emp, p.dist_m, p.shift
      from punches p join associates a on a.id = p.associate_id join stores st on st.store_code = p.store_code
      left join users uz on uz.emp_code = st.zfm_emp left join users ua on ua.emp_code = st.am_emp
      where p.work_date = p_date
        and (p_zfm is null or p_zfm = '' or st.zfm_emp = p_zfm)
        and (p_am is null or p_am = '' or st.am_emp = p_am)
        and (v_q = '' or p.store_code like v_q || '%' or upper(st.name) like '%' || v_q || '%')
      order by p.store_code, p.ts limit 1000) x));
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $function$;
revoke all on function public.admin_punches_list(uuid, date, text, text, text) from public, authenticated;
grant execute on function public.admin_punches_list(uuid, date, text, text, text) to anon;
notify pgrst, 'reload schema';
