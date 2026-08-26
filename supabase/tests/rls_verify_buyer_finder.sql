-- MDF Outreach — Buyer Finder RLS verification.
--
-- DO NOT RUN against the production MDF database from application tooling.
-- If executed, it must be in a throwaway transaction that ROLLS BACK.
--
-- PREREQUISITE (same as supabase/tests/rls_verify.sql):
--   throwaway Auth user rls-test@example.invalid, NOT a workspace member of MDF.
--
-- This script does not modify historical rls_verify.sql.

begin;

do $$
declare
  v_mdf_workspace   uuid;
  v_mdf_owner       uuid;
  v_other_workspace uuid;
  v_other_user      uuid;
  v_non_member      uuid := gen_random_uuid();
  v_seed_candidate  uuid;
  v_seed_contact    uuid;
  v_seed_match      uuid;
  v_row_count       int;
  v_err_state       text;
begin
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
    raise exception E'Auth user rls-test@example.invalid not found.';
  end if;

  if v_other_user = v_mdf_owner then
    raise exception 'rls-test@example.invalid resolved to the MDF owner.';
  end if;

  insert into public.workspaces (name, slug) values ('RLS Test — BF Other', 'rls-test-bf-other')
  returning id into v_other_workspace;

  insert into public.workspace_members (workspace_id, user_id, role, active)
    values (v_other_workspace, v_other_user, 'member', true);

  insert into public.buyer_candidates (workspace_id, company_name, country, domain, discovery_status, review_status)
    values (v_mdf_workspace, 'RLS Candidate Co', 'Thailand', 'rls-candidate.example', 'ready', 'pending')
  returning id into v_seed_candidate;

  insert into public.buyer_candidate_contacts (workspace_id, candidate_id, full_name, business_email, is_primary)
    values (v_mdf_workspace, v_seed_candidate, 'RLS Contact', 'rls-contact@rls-candidate.example', true)
  returning id into v_seed_contact;

  insert into public.buyer_candidate_product_matches (workspace_id, candidate_id, product_key, relevance)
    values (v_mdf_workspace, v_seed_candidate, 'guntur-chilli', 80)
  returning id into v_seed_match;

  perform set_config('role', 'authenticated', true);

  -- 1 / 10. anon is tested after reset; non-member sees nothing.
  perform set_config('request.jwt.claim.sub', v_non_member::text, true);
  select count(*) into v_row_count from public.buyer_candidates;
  raise notice 'BF1 non-member SELECT candidates (expect 0): %  %',
    v_row_count, case when v_row_count = 0 then 'PASS' else 'FAIL' end;

  -- 2. Workspace B cannot see Workspace A candidate.
  perform set_config('request.jwt.claim.sub', v_other_user::text, true);
  select count(*) into v_row_count from public.buyer_candidates where id = v_seed_candidate;
  raise notice 'BF2 cross-workspace SELECT candidate (expect 0): %  %',
    v_row_count, case when v_row_count = 0 then 'PASS' else 'FAIL' end;

  -- 3. Workspace B cannot update Workspace A candidate.
  update public.buyer_candidates set company_name = 'attacker' where id = v_seed_candidate;
  get diagnostics v_row_count = row_count;
  raise notice 'BF3 cross-workspace UPDATE candidate (expect 0): %  %',
    v_row_count, case when v_row_count = 0 then 'PASS' else 'FAIL' end;

  -- 4. Workspace B cannot delete Workspace A candidate.
  delete from public.buyer_candidates where id = v_seed_candidate;
  get diagnostics v_row_count = row_count;
  raise notice 'BF4 cross-workspace DELETE candidate (expect 0): %  %',
    v_row_count, case when v_row_count = 0 then 'PASS' else 'FAIL' end;

  -- 5. Client cannot reassign workspace_id (WITH CHECK).
  perform set_config('request.jwt.claim.sub', v_mdf_owner::text, true);
  begin
    update public.buyer_candidates set workspace_id = v_other_workspace where id = v_seed_candidate;
    get diagnostics v_row_count = row_count;
    if v_row_count > 0 then
      raise notice 'BF5 workspace reassignment (expect blocked): FAIL';
    else
      raise notice 'BF5 workspace reassignment (expect blocked): PASS';
    end if;
  exception when others then
    raise notice 'BF5 workspace reassignment (expect blocked): PASS (error %)', sqlstate;
  end;

  -- 6. Contact isolation — other workspace cannot see A's contact.
  perform set_config('request.jwt.claim.sub', v_other_user::text, true);
  select count(*) into v_row_count from public.buyer_candidate_contacts where id = v_seed_contact;
  raise notice 'BF6 cross-workspace SELECT contact (expect 0): %  %',
    v_row_count, case when v_row_count = 0 then 'PASS' else 'FAIL' end;

  -- 7. Product-match isolation.
  select count(*) into v_row_count from public.buyer_candidate_product_matches where id = v_seed_match;
  raise notice 'BF7 cross-workspace SELECT product match (expect 0): %  %',
    v_row_count, case when v_row_count = 0 then 'PASS' else 'FAIL' end;

  -- 8. Cross-workspace candidate/contact linkage rejected (composite FK + RLS).
  begin
    insert into public.buyer_candidate_contacts (workspace_id, candidate_id, full_name)
      values (v_other_workspace, v_seed_candidate, 'Attacker contact');
    raise notice 'BF8 cross-workspace contact linkage (expect blocked): FAIL';
  exception when others then
    raise notice 'BF8 cross-workspace contact linkage (expect blocked): PASS (error %)', sqlstate;
  end;

  -- 9. Cross-workspace candidate/product-match linkage rejected.
  begin
    insert into public.buyer_candidate_product_matches (workspace_id, candidate_id, product_key)
      values (v_other_workspace, v_seed_candidate, 'guntur-chilli');
    raise notice 'BF9 cross-workspace product-match linkage (expect blocked): FAIL';
  exception when others then
    raise notice 'BF9 cross-workspace product-match linkage (expect blocked): PASS (error %)', sqlstate;
  end;

  -- Owner can see own rows.
  perform set_config('request.jwt.claim.sub', v_mdf_owner::text, true);
  select count(*) into v_row_count from public.buyer_candidates where id = v_seed_candidate;
  raise notice 'BF owner SELECT candidate (expect 1): %  %',
    v_row_count, case when v_row_count = 1 then 'PASS' else 'FAIL' end;
end;
$$;

reset role;

-- 10. anon has no access (table privileges revoked).
do $$
declare
  v_err text;
begin
  perform set_config('role', 'anon', true);
  begin
    perform 1 from public.buyer_candidates limit 1;
    raise notice 'BF10 anon SELECT candidates (expect denied): FAIL';
  exception when others then
    raise notice 'BF10 anon SELECT candidates (expect denied): PASS (error %)', sqlstate;
  end;
end;
$$;

reset role;
rollback;
