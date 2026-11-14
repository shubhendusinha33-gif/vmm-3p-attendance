alter function public.auth_set_pin(text,text,text,text,bigint,text) set search_path = public, extensions;
alter function public.auth_login(text,text,text,text,bigint,text,text) set search_path = public, extensions;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
