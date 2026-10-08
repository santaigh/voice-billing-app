-- Shop Billing SaaS: schema, roles, row-level security and the functions the app calls.
-- Run once in the Supabase SQL Editor (or `supabase db push`). Safe to read top to bottom.
-- Money is stored in paise (whole numbers). Every shop-owned table carries shop_id.

-- ---------------------------------------------------------------- roles and permissions (data, not code)
create table app_role (
  code  text primary key,
  scope text not null check (scope in ('platform', 'shop')),
  label text not null
);
create table permission (code text primary key);
create table role_permission (
  role_code       text not null references app_role(code),
  permission_code text not null references permission(code),
  primary key (role_code, permission_code)
);

insert into app_role values
  ('SaaSSA',    'platform', 'Platform super admin'),
  ('SaaSAdmin', 'platform', 'Platform admin'),
  ('SaaSUser',  'platform', 'Platform support (read only)'),
  ('AppSA',     'shop',     'Shop owner'),
  ('AppAdmin',  'shop',     'Shop manager'),
  ('AppUser',   'shop',     'Cashier');

insert into permission values
  ('shop.view'), ('shop.manage'), ('user.manage'), ('counter.manage'), ('product.view'),
  ('product.import'), ('bill.create'), ('bill.view'), ('bill.void'), ('report.view');

insert into role_permission values
  ('SaaSSA','shop.view'), ('SaaSSA','shop.manage'), ('SaaSSA','user.manage'), ('SaaSSA','counter.manage'),
  ('SaaSSA','product.view'), ('SaaSSA','bill.view'), ('SaaSSA','report.view'),
  ('SaaSAdmin','shop.view'), ('SaaSAdmin','shop.manage'), ('SaaSAdmin','user.manage'), ('SaaSAdmin','counter.manage'),
  ('SaaSAdmin','product.view'), ('SaaSAdmin','bill.view'),
  ('SaaSUser','shop.view'), ('SaaSUser','product.view'), ('SaaSUser','bill.view'),
  ('AppSA','shop.view'), ('AppSA','user.manage'), ('AppSA','counter.manage'), ('AppSA','product.view'),
  ('AppSA','product.import'), ('AppSA','bill.create'), ('AppSA','bill.view'), ('AppSA','bill.void'), ('AppSA','report.view'),
  ('AppAdmin','shop.view'), ('AppAdmin','counter.manage'), ('AppAdmin','product.view'), ('AppAdmin','product.import'),
  ('AppAdmin','bill.create'), ('AppAdmin','bill.view'), ('AppAdmin','bill.void'), ('AppAdmin','report.view'),
  ('AppUser','shop.view'), ('AppUser','product.view'), ('AppUser','bill.create'), ('AppUser','bill.view');

-- ---------------------------------------------------------------- tenants
create table shop (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[A-Za-z0-9]{2,10}$'),
  name       text not null check (length(trim(name)) > 0),
  city       text,
  status     text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- platform staff have shop_id null; shop users always have one
create table profile (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  shop_id              uuid references shop(id),
  role_code            text not null references app_role(code),
  full_name            text not null default '',
  mobile               text,
  active               boolean not null default true,
  must_change_password boolean not null default true,
  created_at           timestamptz not null default now()
);
create index profile_shop_idx on profile (shop_id);

-- the role's scope decides whether a shop is required
create function profile_scope_check() returns trigger language plpgsql as $$
declare s text;
begin
  select scope into s from app_role where code = new.role_code;
  if s = 'platform' and new.shop_id is not null then raise exception 'platform roles have no shop'; end if;
  if s = 'shop' and new.shop_id is null then raise exception 'shop roles need a shop'; end if;
  return new;
end $$;
create trigger profile_scope before insert or update on profile for each row execute function profile_scope_check();

create table counter (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references shop(id),
  code       text not null check (code ~ '^[A-Za-z0-9]{1,6}$'),
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (shop_id, code)
);

create table counter_session (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references shop(id),
  counter_id uuid not null references counter(id),
  user_id    uuid not null references auth.users(id),
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz
);
create index counter_session_shop_idx on counter_session (shop_id, counter_id);

-- ---------------------------------------------------------------- products (one price list per shop)
create table product (
  shop_id     uuid not null references shop(id),
  code        text not null check (length(trim(code)) > 0),
  name_en     text not null check (length(trim(name_en)) > 0),
  name_ta     text not null default '',
  unit        text not null default 'PCS' check (length(unit) between 1 and 10),
  price_paise integer not null check (price_paise > 0),
  aliases     text[] not null default '{}',
  updated_at  timestamptz not null default now(),
  primary key (shop_id, code)
);

-- a phone keeps the list on the device and re-fetches only when this number changes
create table price_list (
  shop_id    uuid primary key references shop(id),
  version    integer not null default 0,
  updated_at timestamptz not null default now()
);

create table product_import (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references shop(id),
  user_id      uuid not null,
  at           timestamptz not null default now(),
  rows_ok      integer not null,
  rows_skipped integer not null
);
create index product_import_shop_idx on product_import (shop_id, at desc);

-- ---------------------------------------------------------------- bills (append only)
create table bill (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references shop(id),
  counter_id        uuid not null references counter(id),
  user_id           uuid not null references auth.users(id),
  client_id         uuid not null,                         -- made on the device; makes an upload safe to repeat
  bill_no           text not null check (bill_no ~ '^[A-Za-z0-9]+-[A-Za-z0-9]+-[0-9]{8}-[0-9]{3,}$'),
  billed_at         timestamptz not null,
  grand_total_paise bigint not null check (grand_total_paise >= 0),
  status            text not null default 'active' check (status in ('active', 'void')),
  void_reason       text,
  voided_by         uuid,
  voided_at         timestamptz,
  created_at        timestamptz not null default now(),
  unique (shop_id, bill_no),
  unique (shop_id, client_id)
);
create index bill_shop_time_idx on bill (shop_id, billed_at desc);
create index bill_user_idx on bill (shop_id, user_id);

-- name and price are copied in, so changing a product later never changes an old bill
create table bill_item (
  bill_id          uuid not null references bill(id),
  shop_id          uuid not null references shop(id),
  line_no          integer not null,
  product_code     text not null,
  name_en          text not null,
  name_ta          text not null default '',
  unit             text not null,
  qty              numeric(12,3) not null check (qty > 0),
  unit_price_paise integer not null check (unit_price_paise >= 0),
  line_total_paise bigint not null check (line_total_paise >= 0),
  primary key (bill_id, line_no)
);
create index bill_item_shop_idx on bill_item (shop_id, product_code);

create table audit_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  shop_id   uuid,
  user_id   uuid,
  action    text not null,
  entity    text not null,
  entity_id text,
  detail    jsonb
);
create index audit_shop_idx on audit_log (shop_id, at desc);

-- ---------------------------------------------------------------- who is asking (security definer: reads profile without recursing into its own rules)
create function auth_shop_id() returns uuid language sql stable security definer set search_path = public as $$
  select shop_id from profile where user_id = auth.uid() and active
$$;
create function auth_role() returns text language sql stable security definer set search_path = public as $$
  select role_code from profile where user_id = auth.uid() and active
$$;
create function is_platform() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profile p join app_role r on r.code = p.role_code
                 where p.user_id = auth.uid() and p.active and r.scope = 'platform')
$$;
create function has_perm(perm text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profile p join role_permission rp on rp.role_code = p.role_code
                 where p.user_id = auth.uid() and p.active and rp.permission_code = perm)
$$;
-- true when the row's shop is the caller's own, or the caller is platform staff and allowed to act on any shop
create function can_act(row_shop uuid, perm text) returns boolean language sql stable security definer set search_path = public as $$
  select has_perm(perm) and (is_platform() or row_shop = auth_shop_id())
$$;

-- ---------------------------------------------------------------- row-level security
alter table app_role        enable row level security;
alter table permission      enable row level security;
alter table role_permission enable row level security;
alter table shop            enable row level security;
alter table profile         enable row level security;
alter table counter         enable row level security;
alter table counter_session enable row level security;
alter table product         enable row level security;
alter table price_list      enable row level security;
alter table product_import  enable row level security;
alter table bill            enable row level security;
alter table bill_item       enable row level security;
alter table audit_log       enable row level security;

-- reference data: any signed-in user may read it, nobody may change it from the app
create policy app_role_read        on app_role        for select to authenticated using (true);
create policy permission_read      on permission      for select to authenticated using (true);
create policy role_permission_read on role_permission for select to authenticated using (true);

-- shop: platform staff see all, a shop user sees only their own; only platform managers change it
create policy shop_read   on shop for select to authenticated using (is_platform() and has_perm('shop.view') or id = auth_shop_id());
create policy shop_insert on shop for insert to authenticated with check (is_platform() and has_perm('shop.manage'));
create policy shop_update on shop for update to authenticated using (is_platform() and has_perm('shop.manage')) with check (is_platform() and has_perm('shop.manage'));

-- profile: you see yourself; user managers see their shop (platform: everyone). Changes go through admin functions only.
create policy profile_read on profile for select to authenticated using (
  user_id = auth.uid() or (has_perm('user.manage') and (is_platform() or shop_id = auth_shop_id())));

create policy counter_read   on counter for select to authenticated using (is_platform() or shop_id = auth_shop_id());
create policy counter_insert on counter for insert to authenticated with check (can_act(shop_id, 'counter.manage'));
create policy counter_update on counter for update to authenticated using (can_act(shop_id, 'counter.manage')) with check (can_act(shop_id, 'counter.manage'));

create policy counter_session_read   on counter_session for select to authenticated using (is_platform() or shop_id = auth_shop_id());
create policy counter_session_insert on counter_session for insert to authenticated
  with check (shop_id = auth_shop_id() and user_id = auth.uid() and has_perm('bill.create'));
create policy counter_session_update on counter_session for update to authenticated
  using (shop_id = auth_shop_id() and user_id = auth.uid()) with check (shop_id = auth_shop_id() and user_id = auth.uid());

create policy product_read on product for select to authenticated using (has_perm('product.view') and (is_platform() or shop_id = auth_shop_id()));
create policy price_list_read on price_list for select to authenticated using (has_perm('product.view') and (is_platform() or shop_id = auth_shop_id()));
create policy product_import_read on product_import for select to authenticated using (can_act(shop_id, 'product.import') or can_act(shop_id, 'report.view'));
-- products and price_list are written only by replace_price_list() below

-- bills: a cashier sees their own, managers see the shop. Nobody updates or deletes from the app (void_bill() does the one allowed change).
create policy bill_read on bill for select to authenticated using (
  has_perm('bill.view') and (is_platform() or (shop_id = auth_shop_id() and (user_id = auth.uid() or has_perm('report.view')))));
create policy bill_item_read on bill_item for select to authenticated using (
  exists (select 1 from bill b where b.id = bill_item.bill_id));      -- inherits the bill rule above
-- bills and items are inserted only by submit_bill() below

create policy audit_read on audit_log for select to authenticated using (can_act(shop_id, 'report.view'));

-- ---------------------------------------------------------------- grants: be explicit, do not rely on defaults
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon;
grant usage on schema public to authenticated;
grant select on app_role, permission, role_permission, shop, profile, counter, counter_session, product, price_list,
                product_import, bill, bill_item, audit_log to authenticated;
grant insert, update on shop, counter to authenticated;
grant insert, update on counter_session to authenticated;
grant execute on function auth_shop_id(), auth_role(), is_platform(), has_perm(text), can_act(uuid, text) to authenticated;

-- ---------------------------------------------------------------- submit_bill: save a bill and all its items once, in one transaction
-- p = { client_id, counter_id, bill_no, billed_at, grand_total_paise,
--       items: [{ product_code, name_en, name_ta, unit, qty, unit_price_paise, line_total_paise }] }
-- Returns { id, duplicate }. The shop and user always come from the signed-in profile, never from the request.
create function submit_bill(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := auth_shop_id();
  v_user uuid := auth.uid();
  v_client uuid; v_counter uuid; v_no text; v_at timestamptz; v_total bigint;
  v_id uuid; v_sum bigint := 0; it jsonb; n int := 0; v_qty numeric; v_price int; v_line bigint;
begin
  if v_shop is null or not has_perm('bill.create') then raise exception 'not allowed' using errcode = '42501'; end if;
  v_client := (p->>'client_id')::uuid;
  v_counter := (p->>'counter_id')::uuid;
  v_no := p->>'bill_no';
  v_at := (p->>'billed_at')::timestamptz;
  v_total := (p->>'grand_total_paise')::bigint;
  if v_client is null or v_counter is null or v_no is null or v_at is null or v_total is null then raise exception 'incomplete bill'; end if;
  if v_at > now() + interval '1 day' then raise exception 'bill time is in the future'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'a bill needs items'; end if;
  if jsonb_array_length(p->'items') > 500 then raise exception 'too many items'; end if;

  -- the same upload again: report it, change nothing
  select id into v_id from bill where shop_id = v_shop and client_id = v_client;
  if found then return jsonb_build_object('id', v_id, 'duplicate', true); end if;
  if exists (select 1 from bill where shop_id = v_shop and bill_no = v_no) then
    raise exception 'bill number % is already used by a different bill', v_no using errcode = '23505';
  end if;
  if not exists (select 1 from counter where id = v_counter and shop_id = v_shop and active) then raise exception 'unknown counter'; end if;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_qty := (it->>'qty')::numeric; v_price := (it->>'unit_price_paise')::int; v_line := (it->>'line_total_paise')::bigint;
    if v_qty is null or v_qty <= 0 or v_price is null or v_price < 0 or v_line is null or v_line < 0 then raise exception 'bad item'; end if;
    if v_line <> round(v_qty * v_price) then raise exception 'line total does not match quantity x price'; end if;
    v_sum := v_sum + v_line;
  end loop;
  if v_sum <> v_total then raise exception 'grand total does not match the items'; end if;

  insert into bill (shop_id, counter_id, user_id, client_id, bill_no, billed_at, grand_total_paise)
    values (v_shop, v_counter, v_user, v_client, v_no, v_at, v_total) returning id into v_id;
  for it in select * from jsonb_array_elements(p->'items') loop
    n := n + 1;
    insert into bill_item (bill_id, shop_id, line_no, product_code, name_en, name_ta, unit, qty, unit_price_paise, line_total_paise)
      values (v_id, v_shop, n, it->>'product_code', it->>'name_en', coalesce(it->>'name_ta', ''), it->>'unit',
              (it->>'qty')::numeric, (it->>'unit_price_paise')::int, (it->>'line_total_paise')::bigint);
  end loop;
  return jsonb_build_object('id', v_id, 'duplicate', false);
end $$;

-- ---------------------------------------------------------------- void_bill: the only change a bill ever gets; items stay as they were
create function void_bill(p_bill_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare b bill%rowtype;
begin
  select * into b from bill where id = p_bill_id;
  if not found or not can_act(b.shop_id, 'bill.void') then raise exception 'not allowed' using errcode = '42501'; end if;
  if b.status = 'void' then return; end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'a reason is required'; end if;
  update bill set status = 'void', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now() where id = p_bill_id;
  insert into audit_log (shop_id, user_id, action, entity, entity_id, detail)
    values (b.shop_id, auth.uid(), 'void', 'bill', p_bill_id::text, jsonb_build_object('bill_no', b.bill_no, 'reason', trim(p_reason)));
end $$;

-- ---------------------------------------------------------------- replace_price_list: one shop's whole list in one call
-- p_rows = [{ code, name_en, name_ta, unit, price_paise, aliases: [..] }]. Bad rows are skipped and counted, never half-applied.
-- p_shop is only honoured for platform staff; a shop user always gets their own shop.
create function replace_price_list(p_rows jsonb, p_shop uuid default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_shop uuid := coalesce(case when is_platform() then p_shop end, auth_shop_id());
  r jsonb; v_ok int := 0; v_skip int := 0; v_ver int; v_code text; v_price int; v_seen text[] := '{}';
begin
  if v_shop is null or not can_act(v_shop, 'product.import') and not (is_platform() and has_perm('shop.manage')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a list'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'at most 20000 products per upload'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_code := trim(coalesce(r->>'code', ''));
    begin
      v_price := (r->>'price_paise')::int;
    exception when others then v_price := null;
    end;
    if v_code = '' or trim(coalesce(r->>'name_en', '')) = '' or v_price is null or v_price <= 0 or v_code = any (v_seen) then
      v_skip := v_skip + 1; continue;
    end if;
    v_seen := v_seen || v_code;
    insert into product (shop_id, code, name_en, name_ta, unit, price_paise, aliases, updated_at)
      values (v_shop, v_code, trim(r->>'name_en'), coalesce(r->>'name_ta', ''),
              upper(coalesce(nullif(trim(r->>'unit'), ''), 'PCS')), v_price,
              coalesce(array(select jsonb_array_elements_text(coalesce(r->'aliases', '[]'::jsonb))), '{}'), now())
      on conflict (shop_id, code) do update set name_en = excluded.name_en, name_ta = excluded.name_ta, unit = excluded.unit,
        price_paise = excluded.price_paise, aliases = excluded.aliases, updated_at = now();
    v_ok := v_ok + 1;
  end loop;
  if v_ok = 0 then raise exception 'no valid products in the upload; the old list was kept'; end if;

  delete from product where shop_id = v_shop and code <> all (v_seen);
  insert into price_list (shop_id, version) values (v_shop, 1)
    on conflict (shop_id) do update set version = price_list.version + 1, updated_at = now() returning version into v_ver;
  insert into product_import (shop_id, user_id, rows_ok, rows_skipped) values (v_shop, auth.uid(), v_ok, v_skip);
  insert into audit_log (shop_id, user_id, action, entity, detail)
    values (v_shop, auth.uid(), 'import', 'product', jsonb_build_object('ok', v_ok, 'skipped', v_skip, 'version', v_ver));
  return jsonb_build_object('ok', v_ok, 'skipped', v_skip, 'version', v_ver);
end $$;

grant execute on function submit_bill(jsonb), void_bill(uuid, text), replace_price_list(jsonb, uuid) to authenticated;
