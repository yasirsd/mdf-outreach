-- MDF Outreach 0028 production-safe verification.
-- Read-only metadata and aggregate inspection. Run manually in Supabase SQL Editor.
-- Result set 1: installation, privileges, and function-definition checks.

with
selection_relation as (
  select c.oid, c.relowner, c.relrowsecurity, c.relacl
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'mdf'
    and c.relname = 'user_workspace_selection'
    and c.relkind in ('r', 'p')
),
switch_function as (
  select p.oid
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'set_current_workspace'
    and p.pronargs = 1
    and p.proargtypes[0] = 'uuid'::regtype
),
current_function as (
  select p.oid, lower(pg_catalog.pg_get_functiondef(p.oid)) as definition
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'mdf'
    and p.proname = 'current_workspace_id'
    and p.pronargs = 0
),
nonread_privilege_kinds as (
  select distinct expanded.privilege_type
  from selection_relation as relation
  cross join lateral pg_catalog.aclexplode(
    pg_catalog.acldefault('r', relation.relowner)
  ) as expanded
  where expanded.privilege_type <> 'SELECT'
),
effective_untrusted_roles(role_name) as (
  values ('anon'::name), ('authenticated'::name)
),
effective_untrusted_nonread_privileges as (
  select count(*)::bigint as finding_count
  from selection_relation as relation
  cross join effective_untrusted_roles as role
  cross join nonread_privilege_kinds as privilege
  where pg_catalog.has_table_privilege(
    role.role_name,
    relation.oid,
    privilege.privilege_type
  )
),
public_nonread_privileges as (
  select count(*)::bigint as finding_count
  from selection_relation as relation
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      relation.relacl,
      pg_catalog.acldefault('r', relation.relowner)
    )
  ) as expanded
  where expanded.grantee = 0
    and expanded.privilege_type <> 'SELECT'
),
untrusted_nonread_privileges as (
  select
    coalesce((select finding_count from effective_untrusted_nonread_privileges), 0)
    + coalesce((select finding_count from public_nonread_privileges), 0)
      as finding_count
),
untrusted_nonread_policies as (
  select count(*)::bigint as finding_count
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'mdf'
    and policy.tablename = 'user_workspace_selection'
    and policy.cmd <> 'SELECT'
    and policy.roles && array['public', 'anon', 'authenticated']::name[]
),
checks(check_name, passed, detail) as (
  select
    'selection_table_exists',
    exists(select 1 from selection_relation),
    case when exists(select 1 from selection_relation)
      then 'mdf.user_workspace_selection is present'
      else 'mdf.user_workspace_selection is missing'
    end
  union all
  select
    'selection_table_rls_enabled',
    coalesce((select relrowsecurity from selection_relation), false),
    case when coalesce((select relrowsecurity from selection_relation), false)
      then 'row security is enabled'
      else 'row security is not enabled'
    end
  union all
  select
    'switch_function_exists',
    exists(select 1 from switch_function),
    case when exists(select 1 from switch_function)
      then 'public switch function with one uuid argument is present'
      else 'public switch function with one uuid argument is missing'
    end
  union all
  select
    'current_workspace_function_exists',
    exists(select 1 from current_function),
    case when exists(select 1 from current_function)
      then 'mdf.current_workspace_id with no arguments is present'
      else 'mdf.current_workspace_id with no arguments is missing'
    end
  union all
  select
    'anon_switch_execution_denied',
    exists(select 1 from switch_function)
      and not coalesce((
        select pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')
        from switch_function
      ), false),
    case when exists(select 1 from switch_function)
      and not coalesce((
        select pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')
        from switch_function
      ), false)
      then 'anon cannot execute the switch function'
      else 'anon can execute the switch function or the function is missing'
    end
  union all
  select
    'authenticated_switch_execution_allowed',
    exists(select 1 from switch_function)
      and coalesce((
        select pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')
        from switch_function
      ), false),
    case when exists(select 1 from switch_function)
      and coalesce((
        select pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')
        from switch_function
      ), false)
      then 'authenticated can execute the switch function'
      else 'authenticated cannot execute the switch function or the function is missing'
    end
  union all
  select
    'selection_untrusted_nonread_privileges_absent',
    exists(select 1 from selection_relation)
      and coalesce((select finding_count from untrusted_nonread_privileges), 0) = 0,
    format(
      'non-read table privileges available to public, anon, or authenticated: %s',
      coalesce((select finding_count from untrusted_nonread_privileges), 0)
    )
  union all
  select
    'selection_untrusted_nonread_policies_absent',
    exists(select 1 from selection_relation)
      and coalesce((select finding_count from untrusted_nonread_policies), 0) = 0,
    format(
      'non-read policies applicable to public, anon, or authenticated: %s',
      coalesce((select finding_count from untrusted_nonread_policies), 0)
    )
  union all
  select
    'current_workspace_has_no_membership_order_fallback',
    exists(select 1 from current_function)
      and coalesce((select definition !~ 'order[[:space:]]+by[[:space:]]+([[:alnum:]_"]+\.)?created_at' from current_function), false)
      and coalesce((select definition !~ 'limit[[:space:]]+1([^0-9]|$)' from current_function), false)
      and coalesce((select position('coalesce(' in definition) = 0 from current_function), false),
    case when exists(select 1 from current_function)
      and coalesce((select definition !~ 'order[[:space:]]+by[[:space:]]+([[:alnum:]_"]+\.)?created_at' from current_function), false)
      and coalesce((select definition !~ 'limit[[:space:]]+1([^0-9]|$)' from current_function), false)
      and coalesce((select position('coalesce(' in definition) = 0 from current_function), false)
      then 'no created-at ordering, one-row membership limit, or fallback coalesce is present'
      else 'a forbidden membership fallback pattern is present or the function is missing'
    end
  union all
  select
    'current_workspace_uses_selection_and_active_membership',
    exists(select 1 from current_function)
      and coalesce((select position('mdf.user_workspace_selection' in definition) > 0 from current_function), false)
      and coalesce((select position('public.workspace_members' in definition) > 0 from current_function), false)
      and coalesce((select position('membership.active = true' in definition) > 0 from current_function), false),
    case when exists(select 1 from current_function)
      and coalesce((select position('mdf.user_workspace_selection' in definition) > 0 from current_function), false)
      and coalesce((select position('public.workspace_members' in definition) > 0 from current_function), false)
      and coalesce((select position('membership.active = true' in definition) > 0 from current_function), false)
      then 'selection is joined to an active workspace membership'
      else 'selection or active-membership validation is absent'
    end
)
select
  check_name,
  case when passed then 'PASS' else 'FAIL' end as result,
  detail
from checks
order by check_name;

-- Result set 2: count-only selection and membership health summary.

with
active_membership_counts as (
  select membership.user_id, count(*)::bigint as active_workspace_count
  from public.workspace_members as membership
  where membership.active = true
  group by membership.user_id
),
selection_health as (
  select
    selection.user_id,
    selection.workspace_id,
    membership.user_id is not null as membership_exists,
    coalesce(membership.active, false) as membership_active
  from mdf.user_workspace_selection as selection
  left join public.workspace_members as membership
    on membership.user_id = selection.user_id
   and membership.workspace_id = selection.workspace_id
)
select 'users_with_exactly_one_active_membership' as metric, count(*)::bigint as value
from active_membership_counts where active_workspace_count = 1
union all
select 'users_with_multiple_active_memberships', count(*)::bigint
from active_membership_counts where active_workspace_count > 1
union all
select 'selection_rows', count(*)::bigint
from selection_health
union all
select 'active_selections', count(*)::bigint
from selection_health where membership_exists and membership_active
union all
select 'invalid_selections', count(*)::bigint
from selection_health where not membership_exists or not membership_active
union all
select 'selections_with_missing_membership', count(*)::bigint
from selection_health where not membership_exists
union all
select 'selections_with_inactive_membership', count(*)::bigint
from selection_health where membership_exists and not membership_active
union all
select 'multi_workspace_users_without_selection', count(*)::bigint
from active_membership_counts as membership_count
where membership_count.active_workspace_count > 1
  and not exists (
    select 1
    from mdf.user_workspace_selection as selection
    where selection.user_id = membership_count.user_id
  )
order by metric;

-- Result set 3: expected workspace-owned RLS coverage.

with
expected_tables(table_name) as (
  values
    ('workspaces'::name),
    ('buyers'::name),
    ('campaigns'::name),
    ('campaign_recipients'::name),
    ('email_templates'::name),
    ('email_assets'::name),
    ('activity_events'::name),
    ('workspace_settings'::name),
    ('gmail_connections'::name),
    ('email_test_recipients'::name),
    ('email_send_events'::name),
    ('email_send_idempotency'::name),
    ('buyer_candidates'::name),
    ('buyer_candidate_contacts'::name),
    ('buyer_candidate_product_matches'::name),
    ('buyer_candidate_public_emails'::name),
    ('buyer_finder_search_runs'::name),
    ('buyer_finder_contact_reveal_events'::name),
    ('buyer_finder_free_enrichment_jobs'::name),
    ('buyer_finder_candidate_conversions'::name),
    ('buyer_intelligence_sources'::name),
    ('buyer_intelligence_claims'::name),
    ('buyer_trade_observations'::name),
    ('buyer_trade_metrics'::name),
    ('buyer_intelligence_assessments'::name),
    ('buyer_intelligence_assessment_evidence'::name),
    ('market_analysis_events'::name),
    ('buyer_trade_research_batches'::name),
    ('buyer_trade_research_jobs'::name),
    ('buyer_trade_research_provider_plans'::name),
    ('buyer_trade_research_attempts'::name),
    ('buyer_trade_research_events'::name)
),
policy_counts as (
  select
    expected.table_name,
    count(policy.policyname)::bigint as policy_count,
    count(policy.policyname) filter (
      where lower(coalesce(policy.qual, '') || ' ' || coalesce(policy.with_check, ''))
        like '%mdf.current_workspace_id()%'
    )::bigint as selected_workspace_policy_count
  from expected_tables as expected
  left join pg_catalog.pg_policies as policy
    on policy.schemaname = 'public'
   and policy.tablename = expected.table_name
  group by expected.table_name
)
select
  policy_count.table_name,
  case
    when relation.oid is not null
      and relation.relrowsecurity
      and policy_count.selected_workspace_policy_count > 0
    then 'PASS'
    else 'FAIL'
  end as result,
  coalesce(relation.relrowsecurity, false) as rls_enabled,
  policy_count.policy_count,
  policy_count.selected_workspace_policy_count,
  case
    when relation.oid is null then 'expected table is missing'
    when not relation.relrowsecurity then 'row security is not enabled'
    when policy_count.selected_workspace_policy_count = 0
      then 'no policy references mdf.current_workspace_id()'
    else format(
      '%s of %s policies reference mdf.current_workspace_id()',
      policy_count.selected_workspace_policy_count,
      policy_count.policy_count
    )
  end as detail
from policy_counts as policy_count
left join pg_catalog.pg_class as relation
  on relation.relname = policy_count.table_name
 and relation.relnamespace = 'public'::regnamespace
 and relation.relkind in ('r', 'p')
order by policy_count.table_name;
