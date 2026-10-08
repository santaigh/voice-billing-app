-- Every function the app (or an anonymous visitor) could call must be closed unless it was opened on purpose.
begin;
create function _t_ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; end $$;

-- 'closed' when the role may not execute the function at all
create function _t_closed(role_name text, fn text) returns boolean language plpgsql as $$
begin return not has_function_privilege(role_name, fn::regprocedure, 'execute'); end $$;

select _t_ok(_t_closed('anon', 'submit_bill(jsonb)'), 'anonymous cannot execute submit_bill');
select _t_ok(_t_closed('anon', 'void_bill(uuid, text)'), 'anonymous cannot execute void_bill');
select _t_ok(_t_closed('anon', 'replace_price_list(jsonb, uuid)'), 'anonymous cannot execute replace_price_list');
select _t_ok(_t_closed('anon', 'update_user(uuid, text, text, text, boolean)'), 'anonymous cannot execute update_user');
select _t_ok(_t_closed('anon', 'password_changed()'), 'anonymous cannot execute password_changed');
select _t_ok(_t_closed('anon', 'auth_shop_id()') and _t_closed('anon', 'has_perm(text)') and _t_closed('anon', 'is_platform()'), 'anonymous cannot execute the helper functions');
select _t_ok(_t_closed('anon', 'admin_precheck_user(uuid, text, uuid)') and _t_closed('anon', 'admin_create_profile(uuid, uuid, text, uuid, text, text, text)'), 'anonymous cannot execute the admin functions');

select _t_ok(not _t_closed('authenticated', 'submit_bill(jsonb)'), 'signed-in users can execute submit_bill');
select _t_ok(not _t_closed('authenticated', 'void_bill(uuid, text)'), 'signed-in users can execute void_bill');
select _t_ok(not _t_closed('authenticated', 'replace_price_list(jsonb, uuid)'), 'signed-in users can execute replace_price_list');
select _t_ok(not _t_closed('authenticated', 'update_user(uuid, text, text, text, boolean)'), 'signed-in users can execute update_user');

select _t_ok(_t_closed('authenticated', 'admin_precheck_user(uuid, text, uuid)') and _t_closed('authenticated', 'admin_create_profile(uuid, uuid, text, uuid, text, text, text)')
  and _t_closed('authenticated', 'can_assign_role(uuid, text, uuid)'), 'signed-in users cannot execute the admin functions');
select _t_ok(not _t_closed('service_role', 'admin_precheck_user(uuid, text, uuid)') and not _t_closed('service_role', 'admin_create_profile(uuid, uuid, text, uuid, text, text, text)'), 'the Edge Function (service role) can execute them');

-- a function created later starts closed
create function _t_future() returns int language sql as 'select 1';
select _t_ok(_t_closed('anon', '_t_future()'), 'a new function starts closed to anonymous');

select 'ALL PASSED' as result;
rollback;
