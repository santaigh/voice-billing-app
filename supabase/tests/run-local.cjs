// Runs the schema and the security tests on a real Postgres (PGlite, in memory). Nothing is installed and no server is needed.
//   npm install   (once)    then    npm test
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

(async () => {
  const db = new PGlite();
  await db.exec(read('stubs.sql'));
  await db.exec(read('../migrations/0001_schema.sql'));
  await db.exec(read('../migrations/0002_user_admin.sql'));
  await db.exec(read('../migrations/0003_close_function_access.sql'));
  await db.exec(read('../migrations/0004_profile_login_email.sql'));
  console.log('ok - schema applied (0001 to 0004)');

  for (const file of ['isolation.sql', 'users.sql', 'hardening.sql']) {
    try {
      const results = await db.exec(read(file));
      const said = results.some((r) => r.rows && r.rows[0] && r.rows[0].result === 'ALL PASSED');
      if (!said) throw new Error(file + ' did not finish');
      console.log('ok - ' + file + ': ALL PASSED');
    } catch (e) {
      console.error('FAILED - ' + file + ': ' + e.message);
      process.exit(1);
    }
  }

  // size check: 10 shops x 2000 products, 30 days x 100 bills a day per shop x 5 items
  await db.exec('begin');
  await db.exec(`
    insert into shop (code, name) select 'Z' || lpad(g::text, 2, '0'), 'Shop ' || g from generate_series(1, 10) g;
    insert into counter (shop_id, code, name) select id, 'C1', 'Counter 1' from shop where code like 'Z%';
    insert into product (shop_id, code, name_en, name_ta, unit, price_paise, aliases)
      select s.id, 'P' || lpad(g::text, 5, '0'), 'Product number ' || g, 'பொருள் ' || g, 'KG', 1000 + g, array['alias' || g, 'other' || g]
      from shop s, generate_series(1, 2000) g where s.code like 'Z%';
    insert into auth.users (id, email) select gen_random_uuid(), 'seed@t' where not exists (select 1 from auth.users where email = 'seed@t');
  `);
  const t0 = Date.now();
  await db.exec(`
    with u as (select id as uid from auth.users where email = 'seed@t'),
    b as (
      insert into bill (shop_id, counter_id, user_id, client_id, bill_no, billed_at, grand_total_paise)
      select c.shop_id, c.id, (select uid from u), gen_random_uuid(),
             s.code || '-C1-' || to_char(date '2026-09-01' + d, 'DDMMYYYY') || '-' || lpad(n::text, 3, '0'),
             timestamptz '2026-09-01 10:00+05:30' + d * interval '1 day' + n * interval '3 minutes', 5000
      from counter c join shop s on s.id = c.shop_id, generate_series(0, 29) d, generate_series(1, 100) n
      where s.code like 'Z%' returning id, shop_id)
    insert into bill_item (bill_id, shop_id, line_no, product_code, name_en, name_ta, unit, qty, unit_price_paise, line_total_paise)
      select b.id, b.shop_id, l, 'P' || lpad((l * 7)::text, 5, '0'), 'Product number ' || (l * 7), 'பொருள் ' || (l * 7), 'KG', 1, 1000, 1000
      from b, generate_series(1, 5) l;
  `);
  const q = async (sql) => (await db.query(sql)).rows[0];
  const bills = (await q('select count(*)::int n from bill')).n;
  const items = (await q('select count(*)::int n from bill_item')).n;
  const prods = (await q('select count(*)::int n from product')).n;
  const mb = async (rel) => Math.round((await q(`select pg_total_relation_size('${rel}') / 1048576.0 as m`)).m * 10) / 10;
  const bMB = await mb('bill'), iMB = await mb('bill_item'), pMB = await mb('product');
  console.log(`size check (10 shops, 30 days): ${prods} products = ${pMB} MB | ${bills} bills = ${bMB} MB | ${items} bill items = ${iMB} MB`);
  console.log(`  one month of bills + items = ${Math.round((bMB + iMB) * 10) / 10} MB (inserted in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  await db.exec('rollback');
  console.log('ok - done');
})().catch((e) => { console.error('FAILED -', e.message); process.exit(1); });
