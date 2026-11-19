-- v5.3: Settings "Delete all consents" fix (Supabase safe-update needs a WHERE clause) + Settings "Clear trial data" (admin_trial_reset).
-- Paste in Supabase → SQL Editor → Run (or approve the Supabase prompt when Claude applies it).

create or replace function public.admin_consent_reset(p_token uuid, p_scope text)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; n int := 0; v_test int; v_all int; v_ep int;
begin
  s := _admin(p_token);
  select count(*) into v_all from consent_log;
  select count(*) into v_test from consent_log c
   where c.store_code in (select store_code from stores where is_test) or c.emp_code in (select emp_code from users where is_test);
  if p_scope = 'count' then
    return json_build_object('ok', true, 'all', v_all, 'test', v_test, 'epoch', (select consent_epoch from settings where id = 1)); end if;
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  if p_scope = 'test' then
    delete from consent_log c where c.store_code in (select store_code from stores where is_test) or c.emp_code in (select emp_code from users where is_test);
    get diagnostics n = row_count;
  elsif p_scope = 'all' then
    delete from consent_log where id is not null; get diagnostics n = row_count;
    update settings set consent_epoch = consent_epoch + 1 where id = 1;
  else return json_build_object('ok', false, 'error', 'BAD_SCOPE'); end if;
  select consent_epoch into v_ep from settings where id = 1;
  perform _log(s.emp_code, s.role, null, 'settings', null, 'consents deleted (' || p_scope || '): ' || n || case when p_scope = 'all' then ' · everyone asked again' else '' end);
  return json_build_object('ok', true, 'deleted', n, 'epoch', v_ep);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;

create or replace function public.admin_trial_reset(p_token uuid, p_stores text[] default null, p_confirm text default null)
returns json language plpgsql security definer set search_path = public as $$
declare s sessions; v_st text[]; v_all boolean; n jsonb := '{}'; k int;
begin
  s := _admin(p_token);
  v_all := p_stores is null or cardinality(p_stores) = 0;
  v_st := case when v_all then (select array_agg(store_code) from stores)
               else (select array_agg(distinct upper(btrim(x))) from unnest(p_stores) x where btrim(x) <> '') end;
  if coalesce(p_confirm, '') <> 'DELETE' then
    return json_build_object('ok', true, 'preview', true, 'all', v_all, 'stores', cardinality(v_st),
      'punches', (select count(*) from punches where store_code = any(v_st)),
      'staff', (select count(*) from associates where store_code = any(v_st)),
      'requests', (select count(*) from change_requests where store_code = any(v_st)),
      'consents', (select count(*) from consent_log where v_all or store_code = any(v_st)),
      'photos', (select count(*) from punches where store_code = any(v_st) and photo_status = 'done'));
  end if;
  if s.view_by is not null then raise exception 'READ_ONLY'; end if;
  delete from cross_store_allow where store_code = any(v_st) or associate_id in (select id from associates where store_code = any(v_st));
  delete from cross_store_tries where try_store = any(v_st) or home_store = any(v_st);
  delete from sg_exceptions where associate_id in (select id from associates where store_code = any(v_st));
  delete from compoffs where associate_id in (select id from associates where store_code = any(v_st));
  delete from change_requests where store_code = any(v_st) or associate_id in (select id from associates where store_code = any(v_st));
  get diagnostics k = row_count; n := n || jsonb_build_object('requests', k);
  delete from punches where store_code = any(v_st) or associate_id in (select id from associates where store_code = any(v_st));
  get diagnostics k = row_count; n := n || jsonb_build_object('punches', k);
  delete from photo_slots where store_code = any(v_st);
  delete from hk_split where store_code = any(v_st);
  delete from consent_log where (v_all and id is not null) or store_code = any(v_st);
  get diagnostics k = row_count; n := n || jsonb_build_object('consents', k);
  delete from associates where store_code = any(v_st);
  get diagnostics k = row_count; n := n || jsonb_build_object('staff', k);
  if v_all then update settings set consent_epoch = consent_epoch + 1 where id = 1; end if;
  perform _log(s.emp_code, s.role, null, 'trial_reset', null,
    case when v_all then 'ALL stores' else array_to_string(v_st, ',') end || ' · ' || n::text);
  return json_build_object('ok', true, 'deleted', n, 'all', v_all);
exception when others then return json_build_object('ok', false, 'error', SQLERRM);
end $$;
revoke execute on function public.admin_trial_reset(uuid, text[], text) from public, authenticated;
grant execute on function public.admin_trial_reset(uuid, text[], text) to anon;
notify pgrst, 'reload schema';
