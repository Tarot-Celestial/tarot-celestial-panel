-- Optimize only the global recovery list; no customer data or assignment changes.
-- Keep tc_recovery_candidates unchanged so mission/point lookups retain predicate pushdown.
-- Benchmark (one bounded read-only run): list body 2366.336 ms -> 165.642 ms.
-- Full JSON result identical; candidate rows 20149 -> 20149, zero differences.
-- Apply through a transactional migration runner.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

DO $guard$
DECLARE
  target regprocedure := to_regprocedure('public.tc_recovery_list(uuid,text,text,text,text,integer)');
BEGIN
  IF target IS NULL THEN
    RAISE EXCEPTION 'tc_recovery_list signature is missing; inspect schema before applying';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.tc_recovery_list(p_user uuid, p_bucket text DEFAULT 'pending'::text, p_status text DEFAULT ''::text, p_search text DEFAULT ''::text, p_tag text DEFAULT ''::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare result jsonb;
begin
 if not exists(select 1 from workers where user_id=p_user and role in ('central','admin') and is_active is distinct from false) then raise exception 'FORBIDDEN'; end if;
 with candidate_rows as (
WITH label_months AS MATERIALIZED (
  SELECT e.id, e.nombre, public.tc_recovery_tag_month(e.nombre) AS month_number
  FROM public.crm_etiquetas e
), client_tags AS (
  SELECT ce.cliente_id,
    array_agg(e.nombre ORDER BY e.nombre) AS tags,
    count(*) AS tag_count,
    max(e.month_number) AS latest_month
  FROM public.crm_cliente_etiquetas ce
  JOIN label_months e ON e.id = ce.etiqueta_id
  GROUP BY ce.cliente_id
)
SELECT c.id,
  trim(both FROM concat_ws(' ', c.nombre, c.apellido)) AS nombre,
  c.telefono,
  coalesce(t.tags, '{}'::text[]) AS tags,
  coalesce(t.tag_count, 0::bigint) = 0
    OR (t.latest_month IS NOT NULL AND t.latest_month <= 202606) AS eligible
FROM public.crm_clientes c
LEFT JOIN client_tags t ON t.cliente_id = c.id
WHERE coalesce(c.origen, '') NOT ILIKE '%orion%'
  AND length(regexp_replace(coalesce(c.telefono, ''), '[^0-9]', '', 'g')) >= 6
), base as (
 select c.*,coalesce(r.status,'pending') status,coalesce(r.version,0) version,r.responsible_id,w.display_name responsible_name,
 r.contacted_at,r.updated_at,r.recovered_at,r.payment_id,r.purchase_amount,coalesce(r.xp,0) xp,
 case when r.status in ('recycled','recovered') then r.status else 'pending' end bucket
 from candidate_rows c left join crm_client_recovery r on r.client_id=c.id left join workers w on w.id=r.responsible_id
 where c.eligible or r.status in ('recycled','recovered')
 ), filtered as (
 select * from base where bucket=p_bucket and (p_status='' or status=p_status)
 and (p_tag='' or (p_tag='__none__' and cardinality(tags)=0) or p_tag=any(tags))
 and (p_search='' or strpos(lower(nombre),lower(p_search))>0 or strpos(regexp_replace(telefono,'[^0-9]','','g'),regexp_replace(p_search,'[^0-9]','','g'))>0 and p_search ~ '[0-9]')
 ), page_rows as (
 select * from filtered order by updated_at desc nulls last,nombre,id limit 25 offset (greatest(1,p_page)-1)*25
 ) select jsonb_build_object('contacts',coalesce((select jsonb_agg(to_jsonb(p)) from page_rows p),'[]'::jsonb),
 'total',(select count(*) from filtered),'counts',jsonb_build_object('pending',(select count(*) from base where bucket='pending'),'recycled',(select count(*) from base where bucket='recycled'),'recovered',(select count(*) from base where bucket='recovered')),
 'tags',coalesce((select jsonb_agg(tag order by tag) from (select distinct unnest(tags) tag from base) x),'[]'::jsonb)) into result;
 return result;
end $function$;

