-- Tests for 0002_user_admin.sql. Same rules as isolation.sql: one transaction, rolled back, "ALL PASSED" at the end.
begin;

create function _t_ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; end $$;

-- run a statement as a signed-in user; returns 'ok' or the error text
create function _t_try(uid uuid, q text) returns text language plpgsql as $$
declare out text := 'ok';
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute 'set local role authenticated';
  begin execute q; exception when others then out := sqlerrm; end;
  reset role;
  return out;
end $$;

-- run a statement as the Edge Function (service role); returns 'ok' or the error text
create function _t_svc(q text) returns text language plpgsql as $$
declare out text := 'ok';
begin
  execute 'set local role service_role';
  begin execute q; exception when others then out := sqlerrm; end;
  reset role;
  return out;
end $$;

insert into shop (id, code, name) values
  ('a0000000-0000-0000-0000-00000000000a', 'S01', 'Shop A'),
  ('b0000000-0000-0000-0000-00000000000b', 'S02', 'Shop B');
insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'ownerA@t'), ('11111111-0000-0000-0000-000000000002', 'cashierA@t'),
  ('11111111-0000-0000-0000-000000000003', 'ownerB@t'), ('22222222-0000-0000-0000-000000000009', 'superadmin@t'),
  ('22222222-0000-0000-0000-000000000001', 'staffAdmin@t'), ('22222222-0000-0000-0000-000000000002', 'staffUser@t'),
  ('55555555-0000-0000-0000-000000000001', 'new1@t'), ('55555555-0000-0000-0000-000000000002', 'new2@t'),
  ('55555555-0000-0000-0000-000000000003', 'new3@t'), ('55555555-0000-0000-0000-000000000004', 'new4@t');
insert into profile (user_id, shop_id, role_code) values
  ('11111111-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'AppSA'),
  ('11111111-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'AppUser'),
  ('11111111-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'AppSA'),
  ('22222222-0000-0000-0000-000000000009', null, 'SaaSSA'),
  ('22222222-0000-0000-0000-000000000001', null, 'SaaSAdmin'),
  ('22222222-0000-0000-0000-000000000002', null, 'SaaSUser');

-- ---- who may assign which role ----
select _t_ok(can_assign_role('11111111-0000-0000-0000-000000000001', 'AppUser', 'a0000000-0000-0000-0000-00000000000a'), 'owner A may add a cashier to shop A');
select _t_ok(can_assign_role('11111111-0000-0000-0000-000000000001', 'AppAdmin', 'a0000000-0000-0000-0000-00000000000a'), 'owner A may add a manager to shop A');
select _t_ok(not can_assign_role('11111111-0000-0000-0000-000000000001', 'AppUser', 'b0000000-0000-0000-0000-00000000000b'), 'owner A may NOT add anyone to shop B');
select _t_ok(not can_assign_role('11111111-0000-0000-0000-000000000001', 'SaaSAdmin', null), 'owner A may NOT create platform staff');
select _t_ok(not can_assign_role('11111111-0000-0000-0000-000000000001', 'SaaSSA', null), 'owner A may NOT create a platform super admin');
select _t_ok(not can_assign_role('11111111-0000-0000-0000-000000000002', 'AppUser', 'a0000000-0000-0000-0000-00000000000a'), 'a cashier may NOT add users');
select _t_ok(can_assign_role('22222222-0000-0000-0000-000000000001', 'AppSA', 'b0000000-0000-0000-0000-00000000000b'), 'platform admin may create an owner for any shop');
select _t_ok(not can_assign_role('22222222-0000-0000-0000-000000000001', 'SaaSAdmin', null), 'platform admin may NOT create platform staff');
select _t_ok(can_assign_role('22222222-0000-0000-0000-000000000009', 'SaaSAdmin', null), 'platform super admin may create platform staff');
select _t_ok(not can_assign_role('22222222-0000-0000-0000-000000000009', 'SaaSAdmin', 'a0000000-0000-0000-0000-00000000000a'), 'a platform role never carries a shop');
select _t_ok(not can_assign_role('22222222-0000-0000-0000-000000000009', 'AppUser', null), 'a shop role needs a shop');
select _t_ok(not can_assign_role('22222222-0000-0000-0000-000000000002', 'AppUser', 'a0000000-0000-0000-0000-00000000000a'), 'read-only platform support may NOT add users');
select _t_ok(not can_assign_role('11111111-0000-0000-0000-000000000001', 'NoSuchRole', 'a0000000-0000-0000-0000-00000000000a'), 'an unknown role is refused');

-- ---- these functions are not callable from the app (browser), only by the Edge Function ----
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$select admin_precheck_user('11111111-0000-0000-0000-000000000001', 'AppUser', 'a0000000-0000-0000-0000-00000000000a')$q$) <> 'ok', 'a signed-in user cannot call admin_precheck_user');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$select admin_create_profile('11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'AppUser', 'a0000000-0000-0000-0000-00000000000a', 'X', null)$q$) <> 'ok', 'a signed-in user cannot call admin_create_profile');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$select can_assign_role('11111111-0000-0000-0000-000000000001', 'AppUser', 'a0000000-0000-0000-0000-00000000000a')$q$) <> 'ok', 'a signed-in user cannot call can_assign_role');

-- ---- the Edge Function path ----
select _t_ok(_t_svc($q$select admin_precheck_user('11111111-0000-0000-0000-000000000001', 'AppUser', 'a0000000-0000-0000-0000-00000000000a')$q$) = 'ok', 'precheck passes for an allowed request');
select _t_ok(_t_svc($q$select admin_precheck_user('11111111-0000-0000-0000-000000000001', 'AppUser', 'b0000000-0000-0000-0000-00000000000b')$q$) like '%not allowed%', 'precheck refuses a request for another shop');
select _t_ok(_t_svc($q$select admin_create_profile('11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'AppUser', 'a0000000-0000-0000-0000-00000000000a', ' Ravi ', '+919876543210')$q$) = 'ok', 'owner A creates a cashier for shop A');
select _t_ok((select full_name from profile where user_id = '55555555-0000-0000-0000-000000000001') = 'Ravi', 'the name was trimmed');
select _t_ok((select must_change_password from profile where user_id = '55555555-0000-0000-0000-000000000001'), 'a new user must change the password');
select _t_ok(_t_svc($q$select admin_create_profile('11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002', 'AppUser', 'b0000000-0000-0000-0000-00000000000b', 'Sneaky', null)$q$) like '%not allowed%', 'owner A cannot create a user in shop B');
select _t_ok(_t_svc($q$select admin_create_profile('11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002', 'AppUser', 'a0000000-0000-0000-0000-00000000000a', 'Dup', '+919876543210')$q$) <> 'ok', 'the same mobile cannot belong to two logins');
select _t_ok(_t_svc($q$select admin_create_profile('11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002', 'AppUser', 'a0000000-0000-0000-0000-00000000000a', 'Bad', '98765')$q$) like '%mobile%', 'a malformed mobile is refused');
select _t_ok(_t_svc($q$select admin_create_profile('22222222-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000003', 'AppSA', 'b0000000-0000-0000-0000-00000000000b', 'Owner B2', null)$q$) = 'ok', 'platform admin creates an owner for shop B');
select _t_ok((select count(*) from audit_log where action = 'create' and entity = 'user') = 2, 'both creations are in the audit log');

-- ---- update_user ----
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$select update_user('11111111-0000-0000-0000-000000000002', 'Cashier One', null, 'AppUser', true)$q$) = 'ok', 'owner A may rename a cashier');
select _t_ok((select full_name from profile where user_id = '11111111-0000-0000-0000-000000000002') = 'Cashier One', 'the new name was saved');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$select update_user('11111111-0000-0000-0000-000000000002', 'Cashier One', null, 'AppAdmin', true)$q$) = 'ok', 'owner A may promote a cashier to manager');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$select update_user('11111111-0000-0000-0000-000000000002', 'Cashier One', null, 'SaaSSA', true)$q$) like '%not allowed%', 'owner A may NOT turn a user into a platform super admin');
select _t_ok((select role_code from profile where user_id = '11111111-0000-0000-0000-000000000002') = 'AppAdmin', 'the refused promotion changed nothing');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$select update_user('11111111-0000-0000-0000-000000000003', 'Hijack', null, 'AppUser', false)$q$) like '%not allowed%', 'owner A may NOT touch shop B''s owner');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$select update_user('22222222-0000-0000-0000-000000000001', 'Hijack', null, 'AppUser', false)$q$) like '%not allowed%', 'owner A may NOT touch platform staff');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$select update_user('11111111-0000-0000-0000-000000000001', 'Me', null, 'AppSA', false)$q$) like '%yourself%', 'nobody can deactivate themselves');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$select update_user('11111111-0000-0000-0000-000000000001', 'Me', null, 'AppUser', true)$q$) like '%yourself%', 'nobody can change their own role');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000002', $q$select update_user('11111111-0000-0000-0000-000000000002', 'Me', null, 'AppSA', true)$q$) like '%not allowed%', 'a manager cannot make themselves owner');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$select update_user('55555555-0000-0000-0000-000000000001', 'Ravi', null, 'AppUser', false)$q$) = 'ok', 'owner A may deactivate a cashier');
select _t_ok(not (select active from profile where user_id = '55555555-0000-0000-0000-000000000001'), 'the cashier is now inactive');
select _t_ok(not can_assign_role('55555555-0000-0000-0000-000000000001', 'AppUser', 'a0000000-0000-0000-0000-00000000000a'), 'an inactive user can no longer manage anyone');
select _t_ok(_t_try('22222222-0000-0000-0000-000000000009', $q$select update_user('22222222-0000-0000-0000-000000000001', 'Admin One', null, 'SaaSAdmin', true)$q$) = 'ok', 'the super admin may edit platform staff');
select _t_ok(_t_try('22222222-0000-0000-0000-000000000001', $q$select update_user('22222222-0000-0000-0000-000000000002', 'Support', null, 'SaaSUser', false)$q$) like '%not allowed%', 'a platform admin may NOT edit platform staff');

-- ---- password change flag ----
select _t_ok(_t_try('55555555-0000-0000-0000-000000000003', $q$select password_changed()$q$) = 'ok', 'a user can call password_changed');
select _t_ok(not (select must_change_password from profile where user_id = '55555555-0000-0000-0000-000000000003'), 'their own flag was cleared');
select _t_ok((select must_change_password from profile where user_id = '55555555-0000-0000-0000-000000000001'), 'it did not touch anyone else');

-- ---- login email on the profile (0004) ----
select _t_ok(_t_svc($q$select admin_create_profile('11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000004', 'AppAdmin', 'a0000000-0000-0000-0000-00000000000a', 'Mgr', null, ' Mgr@Shop.COM ')$q$) = 'ok', 'a profile can carry a real email');
select _t_ok((select login_email from profile where user_id = '55555555-0000-0000-0000-000000000004') = 'mgr@shop.com', 'the email is stored trimmed and lower case');
select _t_ok((select login_email from profile where user_id = '55555555-0000-0000-0000-000000000001') is null, 'a mobile-only login stores no email');
select _t_ok(_t_svc($q$select admin_create_profile('11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002', 'AppUser', 'a0000000-0000-0000-0000-00000000000a', 'Dup', null, 'MGR@shop.com')$q$) <> 'ok', 'the same email cannot belong to two profiles');
select _t_ok(_t_svc($q$select admin_create_profile('11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002', 'AppUser', 'a0000000-0000-0000-0000-00000000000a', 'Bad', null, 'not-an-email')$q$) like '%email%', 'a malformed email is refused');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000002', $q$select admin_create_profile('11111111-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002', 'AppUser', 'a0000000-0000-0000-0000-00000000000a', 'X', null, null)$q$) <> 'ok', 'a signed-in user still cannot call the new admin_create_profile');

select 'ALL PASSED' as result;
rollback;
