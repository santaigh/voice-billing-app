-- 0001 revoked default function access BEFORE it created submit_bill, void_bill and replace_price_list, so those three
-- stayed callable by the anonymous role (they refused inside, but the door should be shut too). Safe to run more than once.
revoke all on function submit_bill(jsonb), void_bill(uuid, text), replace_price_list(jsonb, uuid) from public, anon;
grant execute on function submit_bill(jsonb), void_bill(uuid, text), replace_price_list(jsonb, uuid) to authenticated;

-- belt and braces: any function created later in this schema starts closed, and must be granted on purpose
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
