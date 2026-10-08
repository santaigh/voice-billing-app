-- Phase 1, step 1: who may create and change which users. The rules live here, in SQL, so they are tested and cannot be
-- bypassed by a screen. The Edge Function (step 2) only creates the login and then calls admin_create_profile().

-- one mobile number, one login (mobile is how shop staff may sign in later)
create unique index profile_mobile_uidx on profile (mobile) where mobile is not null;

-- May `p_caller` give someone this role in this shop?
--   platform super admin : any role; shop roles need a shop
--   platform admin       : shop roles only (never platform roles)
--   shop owner (AppSA)   : shop roles, own shop only
--   everyone else        : no
create function can_assign_role(p_caller uuid, p_role text, p_shop uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare c profile%rowtype; r app_role%rowtype; perm boolean;
begin
  select * into c from profile where user_id = p_caller and active;
  if not found then return false; end if;
  select exists (select 1 from role_permission where role_code = c.role_code and permission_code = 'user.manage') into perm;
  if not perm then return false; end if;
  select * into r from app_role where code = p_role;
  if not found then return false; end if;

  if r.scope = 'platform' then
    return c.role_code = 'SaaSSA' and p_shop is null;
  end if;
  -- a shop role: a shop is required, and it must be one the caller may manage
  if p_shop is null or not exists (select 1 from shop where id = p_shop and deleted_at is null) then return false; end if;
  if c.role_code in ('SaaSSA', 'SaaSAdmin') then return true; end if;
  return c.shop_id = p_shop;              -- AppSA: own shop only
end $$;

-- Called by the Edge Function BEFORE it creates the login, so nothing is created for a request that would be refused.
create function admin_precheck_user(p_caller uuid, p_role text, p_shop uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_assign_role(p_caller, p_role, p_shop) then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

-- Called by the Edge Function AFTER it created the login.
create function admin_create_profile(p_caller uuid, p_user uuid, p_role text, p_shop uuid, p_name text, p_mobile text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_assign_role(p_caller, p_role, p_shop) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_mobile is not null and p_mobile !~ '^\+91[0-9]{10}$' then raise exception 'mobile must look like +919876543210'; end if;
  insert into profile (user_id, shop_id, role_code, full_name, mobile) values (p_user, p_shop, p_role, coalesce(trim(p_name), ''), p_mobile);
  insert into audit_log (shop_id, user_id, action, entity, entity_id, detail)
    values (p_shop, p_caller, 'create', 'user', p_user::text, jsonb_build_object('role', p_role));
end $$;

-- A signed-in manager changes name, mobile, role or active flag of a user they may manage.
create function update_user(p_user uuid, p_name text, p_mobile text, p_role text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare t profile%rowtype;
begin
  select * into t from profile where user_id = p_user;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  -- the caller must be allowed to manage the user's CURRENT role and shop, and the NEW role
  if not can_assign_role(auth.uid(), t.role_code, t.shop_id) or not can_assign_role(auth.uid(), p_role, t.shop_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_user = auth.uid() and (p_active is not true or p_role <> t.role_code) then
    raise exception 'you cannot deactivate yourself or change your own role';
  end if;
  if p_mobile is not null and p_mobile !~ '^\+91[0-9]{10}$' then raise exception 'mobile must look like +919876543210'; end if;
  update profile set full_name = coalesce(trim(p_name), full_name), mobile = p_mobile, role_code = p_role, active = coalesce(p_active, active)
    where user_id = p_user;
  insert into audit_log (shop_id, user_id, action, entity, entity_id, detail)
    values (t.shop_id, auth.uid(), 'update', 'user', p_user::text,
            jsonb_build_object('role', p_role, 'active', coalesce(p_active, t.active)));
end $$;

-- A user marks their own password change as done (the forced change on first sign-in).
create function password_changed() returns void language sql security definer set search_path = public as $$
  update profile set must_change_password = false where user_id = auth.uid()
$$;

-- who may call what
revoke all on function can_assign_role(uuid, text, uuid), admin_precheck_user(uuid, text, uuid),
  admin_create_profile(uuid, uuid, text, uuid, text, text), update_user(uuid, text, text, text, boolean), password_changed()
  from public, anon, authenticated;
grant execute on function update_user(uuid, text, text, text, boolean), password_changed() to authenticated;
grant execute on function can_assign_role(uuid, text, uuid), admin_precheck_user(uuid, text, uuid),
  admin_create_profile(uuid, uuid, text, uuid, text, text) to service_role;
