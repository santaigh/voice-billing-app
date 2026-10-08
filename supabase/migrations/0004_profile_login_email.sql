-- Phase 1, step 4: the people list must show how each person signs in. The mobile is already on the profile; add the email
-- (only a REAL email: a mobile-only login stores none, its identifier is the mobile).
alter table profile add column login_email text;
create unique index profile_login_email_uidx on profile (lower(login_email)) where login_email is not null;

-- new signature: p_email is optional, so the old six-argument calls still work
drop function admin_create_profile(uuid, uuid, text, uuid, text, text);
create function admin_create_profile(p_caller uuid, p_user uuid, p_role text, p_shop uuid, p_name text, p_mobile text, p_email text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');   -- tidy first, then check
begin
  if not can_assign_role(p_caller, p_role, p_shop) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_mobile is not null and p_mobile !~ '^\+91[0-9]{10}$' then raise exception 'mobile must look like +919876543210'; end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'that email does not look right'; end if;
  insert into profile (user_id, shop_id, role_code, full_name, mobile, login_email)
    values (p_user, p_shop, p_role, coalesce(trim(p_name), ''), p_mobile, v_email);
  insert into audit_log (shop_id, user_id, action, entity, entity_id, detail)
    values (p_shop, p_caller, 'create', 'user', p_user::text, jsonb_build_object('role', p_role));
end $$;

revoke all on function admin_create_profile(uuid, uuid, text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function admin_create_profile(uuid, uuid, text, uuid, text, text, text) to service_role;
