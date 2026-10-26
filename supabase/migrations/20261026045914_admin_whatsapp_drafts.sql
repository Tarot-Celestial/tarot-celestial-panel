-- Private preparation only: this migration creates no send queue, trigger or WhatsApp session.
create table public.tc_admin_whatsapp_drafts (
  actor_user_id uuid primary key,
  version bigint not null check (version between 1 and 9007199254740991),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  updated_at timestamptz not null default now()
);

-- A response snapshot makes retrying a saved request safe even after a newer edit.
create table public.tc_admin_whatsapp_draft_requests (
  actor_user_id uuid not null,
  request_id uuid not null,
  expected_version bigint not null check (expected_version between 0 and 9007199254740990),
  result_snapshot jsonb not null check (jsonb_typeof(result_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  primary key (actor_user_id, request_id)
);

alter table public.tc_admin_whatsapp_drafts enable row level security;
alter table public.tc_admin_whatsapp_draft_requests enable row level security;
revoke all on public.tc_admin_whatsapp_drafts, public.tc_admin_whatsapp_draft_requests from public, anon, authenticated, service_role;
grant select, insert, update on public.tc_admin_whatsapp_drafts to service_role;
grant select, insert on public.tc_admin_whatsapp_draft_requests to service_role;

create function public.tc_admin_whatsapp_draft_phone(p_phone text)
returns text language plpgsql immutable security invoker set search_path = public, pg_temp
as $$
declare v_phone text;
begin
  if p_phone is null or length(p_phone) > 80 then raise exception 'INVALID_PHONE'; end if;
  v_phone := regexp_replace(btrim(p_phone), '[[:space:]().-]', '', 'g');
  if left(v_phone, 2) = '00' then v_phone := '+' || substr(v_phone, 3);
  elsif left(v_phone, 1) <> '+' then v_phone := '+' || v_phone; end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'INVALID_PHONE'; end if;
  return v_phone;
end;
$$;

create function public.tc_admin_whatsapp_draft_normalize(p_document jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = public, pg_temp
as $$
declare
  v_slot jsonb; v_contact jsonb; v_slots jsonb := '[]'::jsonb; v_contacts jsonb;
  v_seen_phones text[] := '{}'::text[]; v_seen_ids uuid[] := '{}'::uuid[];
  v_seen_slots integer[] := '{}'::integer[]; v_senders text[] := '{}'::text[];
  v_number integer; v_id uuid; v_phone text; v_sender text;
  v_name text; v_note text; v_status text; v_label text; v_message text; v_image text;
begin
  if p_document is null or jsonb_typeof(p_document) <> 'object'
     or p_document - 'slots' <> '{}'::jsonb
     or jsonb_typeof(p_document->'slots') is distinct from 'array'
     or octet_length(p_document::text) > 1048576 then raise exception 'INVALID_DOCUMENT'; end if;
  if jsonb_array_length(p_document->'slots') <> 2 then raise exception 'INVALID_DOCUMENT'; end if;
  for v_slot in select value from jsonb_array_elements(p_document->'slots') loop
    if jsonb_typeof(v_slot) <> 'object'
       or v_slot - array['slot','label','sender_phone','message','image_url','contacts'] <> '{}'::jsonb
       or jsonb_typeof(v_slot->'slot') is distinct from 'number'
       or v_slot->>'slot' not in ('1','2')
       or jsonb_typeof(v_slot->'label') is distinct from 'string'
       or jsonb_typeof(v_slot->'sender_phone') is distinct from 'string'
       or jsonb_typeof(v_slot->'message') is distinct from 'string'
       or jsonb_typeof(v_slot->'image_url') is distinct from 'string'
       or jsonb_typeof(v_slot->'contacts') is distinct from 'array' then raise exception 'INVALID_DOCUMENT'; end if;
    v_number := (v_slot->>'slot')::integer;
    if v_number = any(v_seen_slots) then raise exception 'INVALID_DOCUMENT'; end if;
    v_seen_slots := array_append(v_seen_slots, v_number);
    v_label := btrim(v_slot->>'label'); v_message := btrim(v_slot->>'message'); v_image := btrim(v_slot->>'image_url');
    if length(v_label) > 80 or length(v_message) > 1500 or length(v_image) > 2000 then raise exception 'INVALID_DOCUMENT'; end if;
    if replace(v_message, '{{nombre}}', '') like '%{{%' or replace(v_message, '{{nombre}}', '') like '%}}%' then raise exception 'INVALID_PLACEHOLDER'; end if;
    if v_image <> '' and (v_image !~ '^https://[^[:space:]]+$' or v_image ~ '[<>"\\]') then raise exception 'INVALID_IMAGE_URL'; end if;
    v_sender := btrim(v_slot->>'sender_phone');
    if v_sender <> '' then
      v_sender := public.tc_admin_whatsapp_draft_phone(v_sender);
      if v_sender = any(v_senders) then raise exception 'DUPLICATE_SENDER'; end if;
      v_senders := array_append(v_senders, v_sender);
    end if;
    if jsonb_array_length(v_slot->'contacts') > 300 then raise exception 'TOO_MANY_CONTACTS'; end if;
    v_contacts := '[]'::jsonb;
    for v_contact in select value from jsonb_array_elements(v_slot->'contacts') loop
      if jsonb_typeof(v_contact) <> 'object'
         or v_contact - array['id','name','phone','consent_status','consent_note'] <> '{}'::jsonb
         or jsonb_typeof(v_contact->'id') is distinct from 'string'
         or jsonb_typeof(v_contact->'name') is distinct from 'string'
         or jsonb_typeof(v_contact->'phone') is distinct from 'string'
         or jsonb_typeof(v_contact->'consent_status') is distinct from 'string'
         or jsonb_typeof(v_contact->'consent_note') is distinct from 'string' then raise exception 'INVALID_DOCUMENT'; end if;
      begin v_id := (v_contact->>'id')::uuid;
      exception when invalid_text_representation then raise exception 'INVALID_DOCUMENT'; end;
      if v_id = any(v_seen_ids) then raise exception 'DUPLICATE_CONTACT'; end if;
      v_seen_ids := array_append(v_seen_ids, v_id);
      v_phone := public.tc_admin_whatsapp_draft_phone(v_contact->>'phone');
      if v_phone = any(v_seen_phones) then raise exception 'DUPLICATE_PHONE'; end if;
      v_seen_phones := array_append(v_seen_phones, v_phone);
      v_name := btrim(v_contact->>'name'); v_note := btrim(v_contact->>'consent_note'); v_status := v_contact->>'consent_status';
      if length(v_name) > 160 or length(v_note) > 500 then raise exception 'INVALID_DOCUMENT'; end if;
      if v_status not in ('pending','confirmed','withdrawn') then raise exception 'INVALID_CONSENT'; end if;
      if v_status = 'confirmed' and length(v_note) < 3 then raise exception 'CONSENT_NOTE_REQUIRED'; end if;
      v_contacts := v_contacts || jsonb_build_array(jsonb_build_object('id',v_id,'name',v_name,'phone',v_phone,'consent_status',v_status,'consent_note',v_note));
    end loop;
    v_slots := v_slots || jsonb_build_array(jsonb_build_object('slot',v_number,'label',v_label,'sender_phone',v_sender,'message',v_message,'image_url',v_image,'contacts',v_contacts));
  end loop;
  select jsonb_agg(value order by (value->>'slot')::integer) into v_slots from jsonb_array_elements(v_slots);
  return jsonb_build_object('slots',v_slots);
end;
$$;

create function public.tc_admin_whatsapp_draft_get(p_actor_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  perform 1 from public.workers w where w.user_id=p_actor_user_id and w.is_active is true and lower(w.role)='admin' for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object('version',d.version,'updated_at',d.updated_at,'slots',d.document->'slots') into v_result
  from public.tc_admin_whatsapp_drafts d where d.actor_user_id=p_actor_user_id;
  return coalesce(v_result, jsonb_build_object('version',0,'updated_at',null,'slots',jsonb_build_array(
    jsonb_build_object('slot',1,'label','WhatsApp 1','sender_phone','','message','','image_url','','contacts','[]'::jsonb),
    jsonb_build_object('slot',2,'label','WhatsApp 2','sender_phone','','message','','image_url','','contacts','[]'::jsonb))));
end;
$$;

create function public.tc_admin_whatsapp_draft_save(p_actor_user_id uuid,p_request_id uuid,p_expected_version bigint,p_document jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_document jsonb; v_request public.tc_admin_whatsapp_draft_requests%rowtype;
  v_version bigint := 0; v_updated_at timestamptz; v_result jsonb;
begin
  perform 1 from public.workers w where w.user_id=p_actor_user_id and w.is_active is true and lower(w.role)='admin' for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  if p_request_id is null then raise exception 'INVALID_REQUEST_ID'; end if;
  if p_expected_version is null or p_expected_version < 0 or p_expected_version > 9007199254740990 then raise exception 'INVALID_VERSION'; end if;
  v_document := public.tc_admin_whatsapp_draft_normalize(p_document);
  -- Serializes first-save and existing-draft edits for this actor only.
  perform pg_advisory_xact_lock(hashtextextended('admin-whatsapp-draft:' || p_actor_user_id::text,0));
  select * into v_request from public.tc_admin_whatsapp_draft_requests r where r.actor_user_id=p_actor_user_id and r.request_id=p_request_id;
  if found then
    if v_request.expected_version <> p_expected_version or v_request.result_snapshot->'slots' <> v_document->'slots' then raise exception 'OPERATION_CONFLICT'; end if;
    return v_request.result_snapshot || jsonb_build_object('replayed',true);
  end if;
  select d.version into v_version from public.tc_admin_whatsapp_drafts d where d.actor_user_id=p_actor_user_id for update;
  v_version := coalesce(v_version,0);
  if v_version <> p_expected_version then raise exception 'VERSION_CONFLICT' using detail=jsonb_build_object('current_version',v_version)::text; end if;
  v_updated_at := clock_timestamp();
  v_result := jsonb_build_object('version',v_version+1,'updated_at',v_updated_at,'slots',v_document->'slots');
  insert into public.tc_admin_whatsapp_drafts(actor_user_id,version,document,updated_at) values(p_actor_user_id,v_version+1,v_document,v_updated_at)
  on conflict(actor_user_id) do update set version=excluded.version,document=excluded.document,updated_at=excluded.updated_at;
  insert into public.tc_admin_whatsapp_draft_requests(actor_user_id,request_id,expected_version,result_snapshot) values(p_actor_user_id,p_request_id,p_expected_version,v_result);
  return v_result || jsonb_build_object('replayed',false);
end;
$$;

create function public.tc_admin_whatsapp_draft_resolve(p_actor_user_id uuid,p_phones text[])
returns jsonb language plpgsql security invoker set search_path = public, pg_temp
as $$
declare v_phones text[] := '{}'::text[]; v_phone text; v_result jsonb;
begin
  perform 1 from public.workers w where w.user_id=p_actor_user_id and w.is_active is true and lower(w.role)='admin' for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  if p_phones is null or cardinality(p_phones)>600 then raise exception 'TOO_MANY_CONTACTS'; end if;
  foreach v_phone in array p_phones loop
    v_phone := public.tc_admin_whatsapp_draft_phone(v_phone);
    if not (v_phone=any(v_phones)) then v_phones := array_append(v_phones,v_phone); end if;
  end loop;
  -- Exact indexed comparisons only. No suffix matching, broad export, or country inference.
  -- CRM currently has no canonical WhatsApp blocklist/opt-out field. A web-login ban is not marketing consent.
  select coalesce(jsonb_agg(jsonb_build_object('phone',r.phone,'match',case when m.n=0 then 'none' when m.n=1 then 'unique' else 'ambiguous' end,
    'name',case when m.n=1 then m.name else '' end) order by r.ordinality),'[]'::jsonb) into v_result
  from unnest(v_phones) with ordinality r(phone,ordinality)
  cross join lateral (
    select count(*) n,min(c.name) name from (
      select left(btrim(concat_ws(' ',cl.nombre,nullif(btrim(cl.apellido),''))),160) name
      from public.crm_clientes cl where cl.telefono_normalizado=any(array[r.phone,substr(r.phone,2),'00'||substr(r.phone,2)]) limit 2
    ) c
  ) m;
  return v_result;
end;
$$;

revoke all on function public.tc_admin_whatsapp_draft_phone(text), public.tc_admin_whatsapp_draft_normalize(jsonb), public.tc_admin_whatsapp_draft_get(uuid), public.tc_admin_whatsapp_draft_save(uuid,uuid,bigint,jsonb), public.tc_admin_whatsapp_draft_resolve(uuid,text[]) from public,anon,authenticated,service_role;
grant execute on function public.tc_admin_whatsapp_draft_phone(text), public.tc_admin_whatsapp_draft_normalize(jsonb), public.tc_admin_whatsapp_draft_get(uuid), public.tc_admin_whatsapp_draft_save(uuid,uuid,bigint,jsonb), public.tc_admin_whatsapp_draft_resolve(uuid,text[]) to service_role;

-- Static campaign pictures only. No uploads are performed by this migration.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('admin-whatsapp-campaign-images','admin-whatsapp-campaign-images',true,3145728,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
do $$ begin
  if not exists(select 1 from storage.buckets where id='admin-whatsapp-campaign-images' and public is true and file_size_limit=3145728
    and allowed_mime_types @> array['image/jpeg','image/png','image/webp'] and allowed_mime_types <@ array['image/jpeg','image/png','image/webp']) then
    raise exception 'CAMPAIGN_IMAGE_BUCKET_CONFLICT';
  end if;
end $$;
-- Restrictive policies leave existing buckets unchanged, and prevent future broad browser policies from opening this one.
create policy admin_whatsapp_images_no_browser_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id <> 'admin-whatsapp-campaign-images');
create policy admin_whatsapp_images_no_browser_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id <> 'admin-whatsapp-campaign-images') with check(bucket_id <> 'admin-whatsapp-campaign-images');
create policy admin_whatsapp_images_no_browser_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id <> 'admin-whatsapp-campaign-images');

comment on table public.tc_admin_whatsapp_drafts is 'Private admin preparation only. Contact consent is a declaration, not authorization to send or evidence of WhatsApp connectivity.';
comment on table public.tc_admin_whatsapp_draft_requests is 'Idempotent draft-save receipts; contains private contact snapshots. No send job or delivery status.';
