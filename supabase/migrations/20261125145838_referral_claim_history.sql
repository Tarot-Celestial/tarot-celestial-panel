begin;

-- The admin history pages through all clients, optionally within one prize.
-- Existing indexes begin with cliente_id/reward_id and cannot serve the global
-- chronological page or the stable created_at/id ordering for a prize.
create index client_referral_claims_created_idx
  on public.client_referral_claims(created_at desc,id desc);
create index client_referral_claims_reward_created_idx
  on public.client_referral_claims(reward_id,created_at desc,id desc);

-- Read-only RPC, called by the server only after requireAdmin succeeds. Keep
-- browser roles excluded: names and telephone numbers are internal CRM data.
-- p_to is exclusive; the API converts an inclusive calendar end day into the
-- next midnight in the configured reporting timezone before calling this RPC.
create function public.tc_admin_referral_claim_history(
  p_query text default null,
  p_reward_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_offset integer default 0,
  p_limit integer default 25
) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
  v_query text := lower(regexp_replace(btrim(coalesce(p_query,'')),'[[:space:]]+',' ','g'));
  v_phone_query text;
  v_result jsonb;
begin
  if p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 100
    or length(v_query)>200 or (p_from is not null and p_to is not null and p_to<=p_from)
  then raise exception 'REFERRAL_INVALID_HISTORY_FILTER'; end if;

  -- A name containing a digit must not accidentally match every telephone with
  -- that digit. Telephone search accepts punctuation/spacing but no letters.
  v_phone_query:=case when v_query !~ '[[:alpha:]]' then regexp_replace(v_query,'[^0-9]','','g') else '' end;

  with matching as materialized (
    select h.id,h.created_at
    from public.client_referral_claims h
    join public.crm_clientes c on c.id=h.cliente_id
    where (p_reward_id is null or h.reward_id=p_reward_id)
      and (p_from is null or h.created_at>=p_from)
      and (p_to is null or h.created_at<p_to)
      and (v_query=''
        or strpos(lower(regexp_replace(btrim(concat_ws(' ',c.nombre,c.apellido)),'[[:space:]]+',' ','g')),v_query)>0
        or (v_phone_query<>'' and strpos(regexp_replace(coalesce(nullif(c.telefono_normalizado,''),c.telefono,''),'[^0-9]','','g'),v_phone_query)>0)
      )
  ), selected as (
    select m.id,m.created_at from matching m
    order by m.created_at desc,m.id desc
    offset p_offset limit p_limit
  ), page as (
    select h.id,h.created_at,h.cliente_id,
      coalesce(nullif(btrim(concat_ws(' ',c.nombre,c.apellido)),''),'Cliente') as client_name,
      coalesce(nullif(c.telefono,''),c.telefono_normalizado,'') as client_phone,
      h.reward_id,h.reward_snapshot,h.receipt,
      case when coalesce(h.reward_snapshot->>'referrals_required','') ~ '^[1-9][0-9]{0,3}$'
        then (h.reward_snapshot->>'referrals_required')::integer
        else cardinality(h.referral_ids) end as referrals_used
    from selected s
    join public.client_referral_claims h on h.id=s.id
    join public.crm_clientes c on c.id=h.cliente_id
  )
  select jsonb_build_object(
    'claims',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc) from page p),'[]'::jsonb),
    'total',(select count(*) from matching),
    'offset',p_offset,
    'limit',p_limit
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.tc_admin_referral_claim_history(text,uuid,timestamptz,timestamptz,integer,integer)
  from public,anon,authenticated;
grant execute on function public.tc_admin_referral_claim_history(text,uuid,timestamptz,timestamptz,integer,integer)
  to service_role;
comment on function public.tc_admin_referral_claim_history(text,uuid,timestamptz,timestamptz,integer,integer)
  is 'Admin-gated, service-only history of delivered referral rewards. Reads immutable reward snapshots; calendar upper bound is exclusive.';

notify pgrst,'reload schema';
commit;
