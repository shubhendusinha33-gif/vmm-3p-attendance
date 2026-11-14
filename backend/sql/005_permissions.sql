-- lock down: only the listed API functions are callable, and only by anon (the app); helpers are private
alter function public._ist_now() set search_path = public;
alter function public._ist_today() set search_path = public;
alter function public._norm(text) set search_path = public;
alter function public._dist_m(double precision,double precision,double precision,double precision) set search_path = public;
alter function public._shift_req(int,int,text) set search_path = public;

revoke execute on all functions in schema public from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'login_options()', 'auth_check(text,text,text,text,bigint)', 'auth_set_pin(text,text,text,text,bigint,text)',
    'auth_login(text,text,text,text,bigint,text,text)', 'auth_me(uuid)', 'auth_logout(uuid)',
    'punch_context(text)', 'punch_lookup(text,text,text,text)', 'store_roster(uuid,text)',
    'punch_submit(text,text,text,text,text,double precision,double precision,text,uuid)',
    'dash_overview(uuid,date,text,time)', 'dash_store(uuid,text,date,text)', 'store_range(uuid,text,date,date)',
    'churn(uuid,int)', 'associates_list(uuid,text)', 'statement(uuid,bigint,date,date)', 'mark_compoff(uuid,bigint,date,boolean)',
    'admin_get(uuid,text)', 'admin_stores_upsert(uuid,jsonb)', 'admin_users_upsert(uuid,jsonb)',
    'admin_manpower_upload(uuid,jsonb,date)', 'admin_dept_add(uuid,text,text[])', 'admin_settings_set(uuid,jsonb)',
    'reset_pin(uuid,text)', 'zone_users(uuid)', 'access_view(uuid,text,date)']
  loop
    execute format('grant execute on function public.%s to anon', f);
  end loop;
end $$;
