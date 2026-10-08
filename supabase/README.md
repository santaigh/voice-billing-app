# Shop Billing backend (Supabase): schema, security rules, tests

Phase 0 of the shop SaaS. Nothing here touches the existing Voice Billing app.

| File | What it is |
|---|---|
| `migrations/0001_schema.sql` | Tables, roles as data, row-level security, and the three functions the app calls: `submit_bill`, `void_bill`, `replace_price_list` |
| `tests/isolation.sql` | 60-odd security checks (shop A can never read or change shop B, who may do what). Runs in one transaction and rolls back |
| `migrations/0002_user_admin.sql`, `0003_close_function_access.sql` | Who may create and change users; closes the function permissions that 0001 left open |
| `tests/stubs.sql` | Local stand-ins for Supabase's roles and `auth` schema. **Local use only** |
| `tests/run-local.cjs` | Runs all of the above on a real Postgres (PGlite) and prints a size estimate |

## Run the tests locally (no server, no account)
```bash
cd supabase
npm install     # once
npm test
```
Expect: `schema applied`, `isolation tests: ALL PASSED`, then the size check.

## Apply it to your Supabase project
1. Dashboard -> **SQL Editor** -> **New query**.
2. Paste all of `migrations/0001_schema.sql` and **Run**. Run it once only.
3. New query, paste all of `tests/isolation.sql` and **Run**. The last row must read `ALL PASSED`. It rolls back, so it leaves no data.
3b. Then run `migrations/0002_user_admin.sql` and `migrations/0003_close_function_access.sql` (each once), and after them `tests/users.sql` and `tests/hardening.sql` (each must end in `ALL PASSED`). Running a migration a second time fails with "already exists"; that is harmless and means it was already applied.
4. Dashboard -> **Authentication** -> turn **off** public sign-ups ("Allow new users to sign up"). Accounts will be created by administrators, not by strangers.

## How a bill and a price list get in
- `submit_bill(p)` saves a bill and all its items in one transaction. The shop and the user come from the signed-in profile, never from the request. The same `client_id` sent twice saves once; a different bill using a used number is refused; totals are re-checked.
- `replace_price_list(rows)` replaces one shop's whole list in one call, skips bad rows and counts them, and keeps the old list if nothing in the upload is valid.
- `void_bill(id, reason)` is the only change a bill ever gets.

## Create the first super admin (once, by hand)
Nobody can create the very first platform account through the app, so do it once yourself:
1. Dashboard -> **Authentication -> Users -> Add user -> Create new user**. Enter your email and a password and tick **Auto Confirm User**.
2. Copy that user's **UID** from the list.
3. SQL Editor, run this with your UID in place of the placeholder:
```sql
insert into profile (user_id, shop_id, role_code, full_name, must_change_password)
values ('PASTE-THE-UID-HERE', null, 'SaaSSA', 'Your name', false);
```

## Deploy the create-user function (step 2)
Run `migrations/0002_user_admin.sql` first. Then either way:
- **Dashboard:** **Edge Functions -> Deploy a new function -> Via Editor**, name it exactly `create-user`, paste all of `functions/create-user/index.ts`, **Deploy**. Leave "Verify JWT" on.
- **Or CLI:** `npx supabase functions deploy create-user --project-ref mihshkhjzzmiymhfvebj`
Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the function itself. Never paste the service key anywhere else.

The function's logic is tested with `npm test` (12 checks). What the tests cannot prove is the real connection to your project, so after deploying, create one test cashier from the app (step 4) or tell me and we check together.

## Not built yet (later phases)
- Creating users (needs a privileged call; see the note in the plan), shop/user/counter screens, the login and counter screens in the app, and the offline upload queue.
- GST fields (the tables leave room; no behaviour yet).
