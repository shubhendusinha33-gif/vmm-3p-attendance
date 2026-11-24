-- v5.6b (24 Nov 2026): "Reset phone link" request. SM / ASM ask from the ⋮ menu (reason mandatory),
-- AM of the store or Admin approves → associates.device_id is cleared; the associate's next punch links the new phone.
-- Works even if 'phone_reset' is not in Settings → request types (always on).
begin;

do $do$
declare d text := replace(pg_get_functiondef('public.cr_create(uuid,text,bigint,date,jsonb,text)'::regprocedure), E'\r', '');
begin
  if position('phone_reset' in d) > 0 then return; end if;
  if position($$if not (_is_sg_kind(p_kind) or p_kind = any(cfg.edit_types)) then$$ in d) = 0 then raise exception 'cr_create patch 1 not found'; end if;
  d := replace(d, $$if not (_is_sg_kind(p_kind) or p_kind = any(cfg.edit_types)) then$$,
                  $$if not (_is_sg_kind(p_kind) or p_kind = any(cfg.edit_types) or p_kind = 'phone_reset') then$$);
  if position($$  if exists (select 1 from change_requests where status = 'pending' and kind = p_kind$$ in d) = 0 then raise exception 'cr_create patch 2 not found'; end if;
  d := replace(d, $$  if exists (select 1 from change_requests where status = 'pending' and kind = p_kind$$,
    $$  if p_kind = 'phone_reset' then
    if a.device_id is null then return json_build_object('ok', false, 'error', 'NO_PHONE_LINK'); end if;
    v_payload := jsonb_build_object('had_phone', true, 'device', right(a.device_id, 6));
  end if;
  if exists (select 1 from change_requests where status = 'pending' and kind = p_kind$$);
  execute d;
end $do$;

do $do$
declare sig text; d text;
begin
  foreach sig in array array['public.cr_decide(uuid,bigint,boolean,text,text)', 'public.cr_decide(uuid,bigint,boolean,text)'] loop
    d := replace(pg_get_functiondef(sig::regprocedure), E'\r', '');
    if position('phone_reset' in d) > 0 then continue; end if;
    if position($$    elsif r.kind = 'staff' then$$ in d) = 0 then raise exception 'cr_decide patch not found in %', sig; end if;
    d := replace(d, $$    elsif r.kind = 'staff' then$$, $$    elsif r.kind = 'phone_reset' then
      update associates set device_id = null where id = r.associate_id;
    elsif r.kind = 'staff' then$$);
    execute d;
  end loop;
end $do$;

commit;
-- check: both true
select position('phone_reset' in pg_get_functiondef('public.cr_create(uuid,text,bigint,date,jsonb,text)'::regprocedure)) > 0 create_ok,
       position('phone_reset' in pg_get_functiondef('public.cr_decide(uuid,bigint,boolean,text,text)'::regprocedure)) > 0 decide_ok;
