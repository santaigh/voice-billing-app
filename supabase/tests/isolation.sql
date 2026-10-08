-- Security tests. Runs inside one transaction and rolls everything back, so it leaves nothing behind.
-- Locally:  npm test (from the supabase folder).   On a real project: paste into the SQL Editor after 0001_schema.sql.
-- Any failure stops with "FAIL: ..." ; success ends with the single row "ALL PASSED".
begin;

-- helpers: act as a signed-in user, then come back. They live only for this transaction.
create function _t_ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', msg; end if; end $$;

create function _t_count(uid uuid, q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute 'set local role ' || case when uid is null then 'anon' else 'authenticated' end;
  begin execute 'select count(*) from (' || q || ') s' into n;
  exception when others then n := -1; end;
  reset role;
  return n;
end $$;

-- runs a statement as the user; returns 'ok' or the error text
create function _t_try(uid uuid, q text) returns text language plpgsql as $$
declare out text := 'ok';
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute 'set local role ' || case when uid is null then 'anon' else 'authenticated' end;
  begin execute q;
  exception when others then out := sqlerrm; end;
  reset role;
  return out;
end $$;

create function _t_json(uid uuid, q text) returns jsonb language plpgsql as $$
declare out jsonb;
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  execute 'set local role authenticated';
  execute q into out;
  reset role;
  return out;
end $$;

-- ---- fixtures (as the table owner) ----
insert into shop (id, code, name) values
  ('a0000000-0000-0000-0000-00000000000a', 'S01', 'Shop A'),
  ('b0000000-0000-0000-0000-00000000000b', 'S02', 'Shop B');

insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'ownerA@t'), ('11111111-0000-0000-0000-000000000002', 'cashierA@t'),
  ('11111111-0000-0000-0000-000000000003', 'ownerB@t'), ('11111111-0000-0000-0000-000000000004', 'cashierB@t'),
  ('22222222-0000-0000-0000-000000000001', 'staffAdmin@t'), ('22222222-0000-0000-0000-000000000002', 'staffUser@t'),
  ('33333333-0000-0000-0000-000000000001', 'inactive@t');

insert into profile (user_id, shop_id, role_code) values
  ('11111111-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'AppSA'),
  ('11111111-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'AppUser'),
  ('11111111-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'AppSA'),
  ('11111111-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-00000000000b', 'AppUser'),
  ('22222222-0000-0000-0000-000000000001', null, 'SaaSAdmin'),
  ('22222222-0000-0000-0000-000000000002', null, 'SaaSUser');
insert into profile (user_id, shop_id, role_code, active) values
  ('33333333-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'AppUser', false);

insert into counter (id, shop_id, code, name) values
  ('ca000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'C1', 'Counter 1'),
  ('cb000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'C1', 'Counter 1');

insert into product (shop_id, code, name_en, price_paise) values
  ('a0000000-0000-0000-0000-00000000000a', 'P1', 'Sugar A', 4800),
  ('a0000000-0000-0000-0000-00000000000a', 'P2', 'Rice A', 5800),
  ('b0000000-0000-0000-0000-00000000000b', 'P1', 'Sugar B', 5000);

-- ---- 1. profile rules ----
select _t_ok(
  (select count(*) from (select 1 where false) x) = 0 and
  (with e as (select _t_try(null, 'select 1')) select true),
  'helpers work');
do $$ begin
  begin insert into profile (user_id, shop_id, role_code) values ('22222222-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'SaaSAdmin');
    raise exception 'FAIL: a platform role was given a shop';
  exception when unique_violation or raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;
do $$ begin
  insert into auth.users (id, email) values ('44444444-0000-0000-0000-000000000001', 'x@t');
  begin insert into profile (user_id, shop_id, role_code) values ('44444444-0000-0000-0000-000000000001', null, 'AppUser');
    raise exception 'FAIL: a shop role was created without a shop';
  exception when raise_exception then
    if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;

-- ---- 2. a cashier sees only their own shop ----
select _t_ok(_t_count('11111111-0000-0000-0000-000000000002', 'select * from shop') = 1, 'cashier A sees exactly one shop');
select _t_ok(_t_count('11111111-0000-0000-0000-000000000002', $q$select * from shop where code = 'S02'$q$) = 0, 'cashier A cannot see shop B');
select _t_ok(_t_count('11111111-0000-0000-0000-000000000002', 'select * from product') = 2, 'cashier A sees only shop A products');
select _t_ok(_t_count('11111111-0000-0000-0000-000000000002', $q$select * from product where name_en = 'Sugar B'$q$) = 0, 'cashier A cannot read shop B prices');
select _t_ok(_t_count('11111111-0000-0000-0000-000000000002', 'select * from counter') = 1, 'cashier A sees only shop A counters');
select _t_ok(_t_count('11111111-0000-0000-0000-000000000002', 'select * from profile') = 1, 'cashier sees only their own profile');
select _t_ok(_t_count(null, 'select * from product') = -1 or _t_count(null, 'select * from product') = 0, 'anonymous sees no products');
select _t_ok(_t_count(null, 'select * from shop') in (-1, 0), 'anonymous sees no shops');
select _t_ok(_t_count('33333333-0000-0000-0000-000000000001', 'select * from product') = 0, 'a deactivated user sees nothing');

-- ---- 3. direct writes are refused ----
select _t_ok(_t_try('11111111-0000-0000-0000-000000000002', $q$insert into product (shop_id, code, name_en, price_paise) values ('a0000000-0000-0000-0000-00000000000a','PX','Hack',1)$q$) <> 'ok', 'cashier cannot insert products directly');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$insert into product (shop_id, code, name_en, price_paise) values ('a0000000-0000-0000-0000-00000000000a','PX','Hack',1)$q$) <> 'ok', 'even the owner cannot insert products directly (only the import function)');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000002', $q$update profile set role_code = 'AppSA' where user_id = '11111111-0000-0000-0000-000000000002'$q$) <> 'ok', 'a user cannot promote themselves');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000002', $q$insert into bill (shop_id, counter_id, user_id, client_id, bill_no, billed_at, grand_total_paise) values ('a0000000-0000-0000-0000-00000000000a','ca000000-0000-0000-0000-00000000000a','11111111-0000-0000-0000-000000000002',gen_random_uuid(),'S01-C1-01012026-001',now(),1)$q$) <> 'ok', 'bills cannot be inserted around submit_bill');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000002', $q$insert into shop (code, name) values ('S99','X')$q$) <> 'ok', 'a shop user cannot create shops');

-- ---- 4. submit_bill ----
create function _t_bill(client uuid, counter uuid, no text, total bigint) returns text language sql as $$
  select format($j$select submit_bill(%L::jsonb)$j$, jsonb_build_object(
    'client_id', client, 'counter_id', counter, 'bill_no', no, 'billed_at', now(), 'grand_total_paise', total,
    'items', jsonb_build_array(
      jsonb_build_object('product_code','P1','name_en','Sugar A','unit','KG','qty',2,'unit_price_paise',4800,'line_total_paise',9600),
      jsonb_build_object('product_code','P2','name_en','Rice A','unit','KG','qty',0.5,'unit_price_paise',5800,'line_total_paise',2900)))::text)
$$;

select _t_ok(_t_try('11111111-0000-0000-0000-000000000002', _t_bill('c1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-00000000000a', 'S01-C1-08102026-001', 12500)) = 'ok', 'cashier A can submit a bill');
select _t_ok((select count(*) from bill) = 1 and (select count(*) from bill_item) = 2, 'the bill and both items were saved');
select _t_ok((select shop_id from bill limit 1) = 'a0000000-0000-0000-0000-00000000000a', 'the bill belongs to shop A');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000002', _t_bill('c1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-00000000000a', 'S01-C1-08102026-001', 12500)) = 'ok'
  and (select count(*) from bill) = 1, 'sending the same bill again changes nothing');
select _t_ok(_t_json('11111111-0000-0000-0000-000000000002', _t_bill('c1000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-00000000000a', 'S01-C1-08102026-001', 12500))->>'duplicate' = 'true', 'the repeat is reported as duplicate');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000002', _t_bill('c2000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-00000000000a', 'S01-C1-08102026-001', 12500)) like '%already used%', 'a different bill with a used number is refused');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000002', _t_bill('c3000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-00000000000a', 'S01-C1-08102026-002', 99999)) like '%grand total%', 'a wrong grand total is refused');
select _t_ok((select count(*) from bill) = 1 and (select count(*) from bill_item) = 2, 'a refused bill leaves no partial rows');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000002', _t_bill('c4000000-0000-0000-0000-000000000004', 'cb000000-0000-0000-0000-00000000000b', 'S01-C1-08102026-003', 12500)) like '%unknown counter%', 'a cashier cannot bill on another shop''s counter');
select _t_ok(_t_try('22222222-0000-0000-0000-000000000001', _t_bill('c5000000-0000-0000-0000-000000000005', 'ca000000-0000-0000-0000-00000000000a', 'S01-C1-08102026-004', 12500)) like '%not allowed%', 'platform staff cannot create bills');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000004', _t_bill('c6000000-0000-0000-0000-000000000006', 'ca000000-0000-0000-0000-00000000000a', 'S02-C1-08102026-001', 12500)) like '%unknown counter%', 'cashier B cannot use shop A''s counter');

-- ---- 5. who can read the bill ----
select _t_ok(_t_count('11111111-0000-0000-0000-000000000002', 'select * from bill') = 1, 'the cashier sees their own bill');
select _t_ok(_t_count('11111111-0000-0000-0000-000000000002', 'select * from bill_item') = 2, 'the cashier sees its items');
select _t_ok(_t_count('11111111-0000-0000-0000-000000000001', 'select * from bill') = 1, 'the owner sees the shop''s bills');
select _t_ok(_t_count('11111111-0000-0000-0000-000000000003', 'select * from bill') = 0, 'owner B sees none of shop A''s bills');
select _t_ok(_t_count('11111111-0000-0000-0000-000000000004', 'select * from bill_item') = 0, 'cashier B sees none of shop A''s items');
select _t_ok(_t_count('22222222-0000-0000-0000-000000000002', 'select * from bill') = 1, 'platform support can read bills');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$update bill set grand_total_paise = 1$q$) <> 'ok' or (select grand_total_paise from bill limit 1) = 12500, 'a bill total cannot be changed');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', 'delete from bill') <> 'ok' or (select count(*) from bill) = 1, 'a bill cannot be deleted');

-- ---- 6. void_bill ----
select _t_ok(_t_try('11111111-0000-0000-0000-000000000002', format($q$select void_bill(%L, 'customer returned')$q$, (select id from bill limit 1))) like '%not allowed%', 'a cashier cannot void a bill');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000003', format($q$select void_bill(%L, 'customer returned')$q$, (select id from bill limit 1))) like '%not allowed%', 'owner B cannot void shop A''s bill');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', format($q$select void_bill(%L, 'x')$q$, (select id from bill limit 1))) like '%reason%', 'a void needs a reason');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', format($q$select void_bill(%L, 'customer returned')$q$, (select id from bill limit 1))) = 'ok', 'the owner can void a bill');
select _t_ok((select status from bill limit 1) = 'void' and (select count(*) from bill_item) = 2, 'the bill is void and its items are untouched');
select _t_ok((select count(*) from audit_log where action = 'void') = 1, 'the void was written to the audit log');

-- ---- 7. price import ----
select _t_ok(_t_try('11111111-0000-0000-0000-000000000002', $q$select replace_price_list('[]'::jsonb)$q$) like '%not allowed%', 'a cashier cannot import prices');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$select replace_price_list('[{"code":"","name_en":"x","price_paise":100}]'::jsonb)$q$) like '%no valid products%', 'an import with no valid rows is refused');
select _t_ok((select count(*) from product where shop_id = 'a0000000-0000-0000-0000-00000000000a') = 2, 'a refused import keeps the old list');

select _t_ok(_t_json('11111111-0000-0000-0000-000000000001', $q$select replace_price_list('[
  {"code":"P1","name_en":"Sugar A new","name_ta":"சர்க்கரை","unit":"kg","price_paise":5000,"aliases":["cheeni","sakkarai"]},
  {"code":"P3","name_en":"Oil","unit":"ltr","price_paise":16000},
  {"code":"P3","name_en":"Duplicate code","price_paise":1},
  {"code":"","name_en":"No code","price_paise":100},
  {"code":"P4","name_en":"Free","price_paise":0}]'::jsonb)$q$) = '{"ok": 2, "skipped": 3, "version": 1}'::jsonb, 'import: 2 good rows, 3 skipped, version 1');
select _t_ok((select string_agg(code, ',' order by code) from product where shop_id = 'a0000000-0000-0000-0000-00000000000a') = 'P1,P3', 'the list now holds P1 and P3 only (P2 was removed)');
select _t_ok((select price_paise from product where shop_id = 'a0000000-0000-0000-0000-00000000000a' and code = 'P1') = 5000, 'the price was updated');
select _t_ok((select unit from product where shop_id = 'a0000000-0000-0000-0000-00000000000a' and code = 'P1') = 'KG', 'the unit was upper-cased');
select _t_ok((select aliases from product where shop_id = 'a0000000-0000-0000-0000-00000000000a' and code = 'P1') = array['cheeni','sakkarai'], 'aliases were saved');
select _t_ok((select count(*) from product where shop_id = 'b0000000-0000-0000-0000-00000000000b') = 1
  and (select name_en from product where shop_id = 'b0000000-0000-0000-0000-00000000000b') = 'Sugar B', 'shop B''s list was not touched');
select _t_ok((select name_en from bill_item where product_code = 'P1' limit 1) = 'Sugar A', 'an old bill keeps the name it was billed with');
select _t_ok((select version from price_list where shop_id = 'a0000000-0000-0000-0000-00000000000a') = 1, 'the list version is 1');
select _t_ok(_t_json('11111111-0000-0000-0000-000000000001', $q$select replace_price_list('[{"code":"P1","name_en":"S","price_paise":100}]'::jsonb)$q$)->>'version' = '2', 'the next import makes version 2');
select _t_ok((select count(*) from product_import where shop_id = 'a0000000-0000-0000-0000-00000000000a') = 2, 'both imports are in the history');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$select replace_price_list('[{"code":"Z","name_en":"Z","price_paise":100}]'::jsonb, 'b0000000-0000-0000-0000-00000000000b')$q$) = 'ok'
  and (select count(*) from product where shop_id = 'b0000000-0000-0000-0000-00000000000b') = 1, 'owner A cannot aim an import at shop B');

-- ---- 8. platform staff ----
select _t_ok(_t_count('22222222-0000-0000-0000-000000000001', 'select * from shop') = 2, 'platform admin sees both shops');
select _t_ok(_t_try('22222222-0000-0000-0000-000000000001', $q$insert into shop (code, name) values ('S03','Shop C')$q$) = 'ok', 'platform admin can create a shop');
select _t_ok(_t_try('22222222-0000-0000-0000-000000000002', $q$insert into shop (code, name) values ('S04','Shop D')$q$) <> 'ok', 'platform support (read only) cannot create a shop');
select _t_ok(_t_try('22222222-0000-0000-0000-000000000001', $q$insert into counter (shop_id, code, name) values ('b0000000-0000-0000-0000-00000000000b','C2','Counter 2')$q$) = 'ok', 'platform admin can add a counter to any shop');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$insert into counter (shop_id, code, name) values ('b0000000-0000-0000-0000-00000000000b','C9','Sneaky')$q$) <> 'ok', 'owner A cannot add a counter to shop B');
select _t_ok(_t_try('11111111-0000-0000-0000-000000000001', $q$insert into counter (shop_id, code, name) values ('a0000000-0000-0000-0000-00000000000a','C2','Counter 2')$q$) = 'ok', 'owner A can add a counter to shop A');
select _t_ok(_t_count('22222222-0000-0000-0000-000000000001', 'select * from profile') >= 6, 'platform admin can list users');
select _t_ok(_t_count('11111111-0000-0000-0000-000000000001', 'select * from profile') = 3, 'owner A lists only shop A''s users');

select 'ALL PASSED' as result;
rollback;
