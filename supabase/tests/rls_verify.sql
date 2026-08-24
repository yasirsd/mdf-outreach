-- MDF Outreach — RLS live verification (Tests 2, 5, 6, 6b, 7, 7b + owner isolation).
--
-- PREREQUISITE: create a throwaway Auth user in the Dashboard first, otherwise
-- this script will stop with a clear error message.
--
--   1. Dashboard → Authentication → Users → + Add user → Create new user.
--   2. Email:     rls-test@example.invalid
--      Password:  anything random (do NOT paste it into this chat).
--      Auto Confirm User: ON.
--   3. Click Create user.
--
-- Do NOT add this account to workspace_members from the Dashboard. The script
-- will create a temporary "other workspace" and add this user to it inside
-- a transaction that is fully rolled back at the end.
--
-- After the script finishes, feel free to delete the throwaway Auth user
-- (Dashboard → Users → row → Delete user). Its workspace_members association
-- was already rolled back, so no cleanup on the app side is needed.
--
-- The MDF workspace, MDF owner membership row, and all business rows are
-- untouched.

begin;

do $$
declare
  v_mdf_workspace   uuid;
  v_mdf_owner       uuid;
  v_other_workspace uuid;
  v_other_user      uuid;
  v_non_member      uuid := gen_random_uuid();
  v_seed_buyer      uuid;
  v_seed_campaign   uuid;
  v_row_count       int;
  v_err_state       text;
begin
  ------------------------------------------------------------------
  -- Preflight: resolve MDF workspace + owner, and require the
  -- throwaway Auth user to exist. Fail fast otherwise.
  ------------------------------------------------------------------
  select id into v_mdf_workspace from public.workspaces where slug = 'mdf';
  if v_mdf_workspace is null then
    raise exception 'No workspace with slug=mdf. Did bootstrap.sql run?';
  end if;

  select user_id into v_mdf_owner
    from public.workspace_members
    where workspace_id = v_mdf_workspace and role = 'owner' and active = true
    limit 1;
  if v_mdf_owner is null then
    raise exception 'No owner membership row in MDF workspace.';
  end if;

  select id into v_other_user
    from auth.users
    where lower(email) = lower('rls-test@example.invalid')
    limit 1;
  if v_other_user is null then
    raise exception E'Auth user rls-test@example.invalid not found.\n'
      'Create it first: Dashboard → Authentication → Users → + Add user\n'
      'Email: rls-test@example.invalid  |  Random password  |  Auto Confirm ON\n'
      'Then re-run this script.';
  end if;

  -- Do not accidentally reuse the real MDF owner as the "other" user.
  if v_other_user = v_mdf_owner then
    raise exception 'rls-test@example.invalid resolved to the MDF owner. Choose a different throwaway email.';
  end if;

  ------------------------------------------------------------------
  -- In-transaction fixtures — all rolled back at the end.
  ------------------------------------------------------------------
  insert into public.workspaces (name, slug) values ('RLS Test — Other', 'rls-test-other')
  returning id into v_other_workspace;

  insert into public.workspace_members (workspace_id, user_id, role, active)
    values (v_other_workspace, v_other_user, 'member', true);

  insert into public.buyers (workspace_id, email, company, country, status)
    values (v_mdf_workspace, 'rls-test@example.invalid', 'RLS Test Co', 'India', 'new')
  returning id into v_seed_buyer;

  insert into public.campaigns (workspace_id, name)
    values (v_mdf_workspace, 'RLS Test Campaign')
  returning id into v_seed_campaign;

  ------------------------------------------------------------------
  -- Simulate role=authenticated with different auth.uid() values.
  -- Supabase reads auth.uid() from request.jwt.claim.sub.
  ------------------------------------------------------------------

  -- Test 2 (DB layer): authenticated user with NO membership sees nothing.
  -- v_non_member is a random UUID never inserted anywhere; RLS doesn't
  -- require it to exist in auth.users to evaluate the policy.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_non_member::text, true);
  select count(*) into v_row_count from public.buyers;
  raise notice 'Test 2 (non-member SELECT buyers, expect 0): %  %',
    v_row_count, case when v_row_count = 0 then 'PASS' else 'FAIL' end;

  -- Test 5: authenticated user of ANOTHER workspace cannot see MDF buyers.
  perform set_config('request.jwt.claim.sub', v_other_user::text, true);
  select count(*) into v_row_count from public.buyers where workspace_id = v_mdf_workspace;
  raise notice 'Test 5 (cross-workspace SELECT, expect 0): %  %',
    v_row_count, case when v_row_count = 0 then 'PASS' else 'FAIL' end;

  -- Test 6: cross-workspace UPDATE denied (0 rows updated).
  update public.buyers set company = 'attacker' where id = v_seed_buyer;
  get diagnostics v_row_count = row_count;
  raise notice 'Test 6 (cross-workspace UPDATE, expect 0 rows updated): %  %',
    v_row_count, case when v_row_count = 0 then 'PASS' else 'FAIL' end;

  -- Test 6b: workspace reassignment attack — even as a legitimate member,
  -- I must not be able to update a row's workspace_id to a workspace I do
  -- NOT belong to. Switch to MDF owner, try to move the buyer to the
  -- other workspace, expect the WITH CHECK clause to block it.
  perform set_config('request.jwt.claim.sub', v_mdf_owner::text, true);
  v_err_state := null;
  begin
    update public.buyers set workspace_id = v_other_workspace where id = v_seed_buyer;
    get diagnostics v_row_count = row_count;
    if v_row_count > 0 then
      raise notice 'Test 6b (workspace reassignment, expect blocked): FAIL (updated % rows)', v_row_count;
    else
      raise notice 'Test 6b (workspace reassignment, expect blocked): PASS (WITH CHECK filtered)';
    end if;
  exception when others then
    v_err_state := sqlstate;
    raise notice 'Test 6b (workspace reassignment, expect blocked): PASS (error %) ', v_err_state;
  end;

  -- Test 7: cross-workspace INSERT denied.
  perform set_config('request.jwt.claim.sub', v_other_user::text, true);
  v_err_state := null;
  begin
    insert into public.buyers (workspace_id, email, company, country, status)
      values (v_mdf_workspace, 'attacker@example.invalid', 'Attacker', 'India', 'new');
    raise notice 'Test 7 (cross-workspace INSERT, expect blocked): FAIL (row inserted)';
  exception when others then
    v_err_state := sqlstate;
    raise notice 'Test 7 (cross-workspace INSERT, expect blocked): PASS (error %) ', v_err_state;
  end;

  -- Test 7b: non-member INSERT denied.
  perform set_config('request.jwt.claim.sub', v_non_member::text, true);
  v_err_state := null;
  begin
    insert into public.buyers (workspace_id, email, company, country, status)
      values (v_mdf_workspace, 'nonmember@example.invalid', 'NonMember', 'India', 'new');
    raise notice 'Test 7b (non-member INSERT, expect blocked): FAIL (row inserted)';
  exception when others then
    v_err_state := sqlstate;
    raise notice 'Test 7b (non-member INSERT, expect blocked): PASS (error %) ', v_err_state;
  end;

  -- MDF owner CAN see the seeded buyer inside their own workspace.
  perform set_config('request.jwt.claim.sub', v_mdf_owner::text, true);
  select count(*) into v_row_count from public.buyers where id = v_seed_buyer;
  raise notice 'Owner in-workspace SELECT (expect 1): %  %',
    v_row_count, case when v_row_count = 1 then 'PASS' else 'FAIL' end;

  -- Owner cannot see the other workspace's rows either — proves isolation
  -- is symmetric.
  select count(*) into v_row_count from public.workspaces where id = v_other_workspace;
  raise notice 'Owner does NOT see other workspace (expect 0): %  %',
    v_row_count, case when v_row_count = 0 then 'PASS' else 'FAIL' end;
end;
$$;

-- Return to superuser role so ROLLBACK works cleanly.
reset role;
rollback;

-- Confirm nothing persisted. Expected: workspaces=1, workspace_members=1,
-- buyers=0, campaigns=0.
select
  (select count(*) from public.workspaces)         as workspaces_after,
  (select count(*) from public.workspace_members)  as members_after,
  (select count(*) from public.buyers)             as buyers_after,
  (select count(*) from public.campaigns)          as campaigns_after;
