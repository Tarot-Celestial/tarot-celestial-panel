-- Private, evidence-based companion learning. Apply once in Supabase SQL Editor
-- or through your migration workflow. Safe to rerun; existing episodes are kept.
-- Reads and mutations go through the authenticated application server only.
begin;

create table if not exists public.central_assistant_learning_episodes (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null,
  source_key text not null,
  source_id uuid not null,
  client_id uuid,
  strategy text not null,
  title text not null,
  reason text not null,
  expected_outcome text not null,
  baseline jsonb not null default '{}'::jsonb,
  state text not null default 'suggested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tried_at timestamptz,
  deadline_at timestamptz,
  resolved_at timestamptz,
  evidence jsonb,
  feedback text,
  feedback_note text,
  feedback_at timestamptz
);

-- Resume a partial installation without replacing the table or deleting data.
-- Missing essential identity fields on populated legacy rows intentionally fail
-- the transaction rather than fabricating learning identities or observations.
alter table public.central_assistant_learning_episodes
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists worker_id uuid,
  add column if not exists source_key text,
  add column if not exists source_id uuid,
  add column if not exists client_id uuid,
  add column if not exists strategy text,
  add column if not exists title text,
  add column if not exists reason text,
  add column if not exists expected_outcome text,
  add column if not exists baseline jsonb not null default '{}'::jsonb,
  add column if not exists state text not null default 'suggested',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists tried_at timestamptz,
  add column if not exists deadline_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists evidence jsonb,
  add column if not exists feedback text,
  add column if not exists feedback_note text,
  add column if not exists feedback_at timestamptz;

alter table public.central_assistant_learning_episodes
  alter column id set default gen_random_uuid(),
  alter column id set not null,
  alter column worker_id set not null,
  alter column source_key set not null,
  alter column source_id set not null,
  alter column strategy set not null,
  alter column title set not null,
  alter column reason set not null,
  alter column expected_outcome set not null,
  alter column baseline set default '{}'::jsonb,
  alter column baseline set not null,
  alter column state set default 'suggested',
  alter column state set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $migration$
declare
  constraint_spec record;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.central_assistant_learning_episodes'::regclass
      and contype = 'p'
  ) then
    alter table public.central_assistant_learning_episodes
      add constraint central_assistant_learning_episodes_pkey primary key (id);
  end if;

  for constraint_spec in
    select * from (values
      ('companion_learning_worker_fk',
       'foreign key (worker_id) references public.workers(id) on delete cascade'),
      ('companion_learning_source_unique', 'unique (worker_id, source_key)'),
      ('companion_learning_source_key_check',
       'check (char_length(btrim(source_key)) between 1 and 220 and char_length(source_key) <= 220)'),
      ('companion_learning_strategy_check',
       'check (strategy in (''recovery_loyal'', ''recovery_recent'', ''followup_due'', ''incident_pending''))'),
      ('companion_learning_title_check',
       'check (char_length(btrim(title)) >= 1 and char_length(title) <= 180)'),
      ('companion_learning_reason_check',
       'check (char_length(btrim(reason)) >= 1 and char_length(reason) <= 1600)'),
      ('companion_learning_expected_check',
       'check (char_length(btrim(expected_outcome)) >= 1 and char_length(expected_outcome) <= 800)'),
      ('companion_learning_baseline_check',
       'check (jsonb_typeof(baseline) = ''object'')'),
      ('companion_learning_state_check',
       'check (state in (''suggested'', ''trying'', ''observed'', ''no_result'', ''dismissed'', ''invalidated''))'),
      ('companion_learning_evidence_check',
       'check (evidence is null or jsonb_typeof(evidence) = ''object'')'),
      ('companion_learning_trying_check',
       'check (state <> ''trying'' or (tried_at is not null and deadline_at is not null))'),
      ('companion_learning_deadline_check',
       'check (deadline_at is null or (tried_at is not null and deadline_at > tried_at))'),
      ('companion_learning_observed_check',
       'check (state <> ''observed'' or (resolved_at is not null and evidence is not null and evidence <> ''{}''::jsonb))'),
      ('companion_learning_observed_identity_check',
       'check (state <> ''observed'' or (jsonb_typeof(evidence->''kind'') = ''string'' and jsonb_typeof(evidence->''id'') = ''string'' and length(btrim(coalesce(evidence->>''kind'', ''''))) > 0 and length(btrim(coalesce(evidence->>''id'', ''''))) > 0))'),
      ('companion_learning_no_result_check',
       'check (state <> ''no_result'' or resolved_at is not null)'),
      ('companion_learning_feedback_check',
       'check (feedback is null or feedback in (''helpful'', ''not_helpful''))'),
      ('companion_learning_feedback_time_check',
       'check (feedback is null or feedback_at is not null)'),
      ('companion_learning_feedback_note_check',
       'check (feedback_note is null or char_length(feedback_note) <= 600)')
    ) as definitions(constraint_name, constraint_sql)
  loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.central_assistant_learning_episodes'::regclass
        and conname = constraint_spec.constraint_name
    ) then
      execute format(
        'alter table public.central_assistant_learning_episodes add constraint %I %s',
        constraint_spec.constraint_name, constraint_spec.constraint_sql
      );
    end if;
  end loop;
end;
$migration$;

create index if not exists companion_learning_worker_state_created_idx
  on public.central_assistant_learning_episodes(worker_id, state, created_at);
create index if not exists companion_learning_worker_recent_idx
  on public.central_assistant_learning_episodes(worker_id, created_at desc);
-- One factual event can reward only one mission for the same worker, even when
-- two tabs evaluate related suggestions concurrently.
create unique index if not exists companion_learning_worker_evidence_unique
  on public.central_assistant_learning_episodes(worker_id, (evidence->>'kind'), (evidence->>'id'))
  where state = 'observed' and evidence is not null;

alter table public.central_assistant_learning_episodes enable row level security;
revoke all on table public.central_assistant_learning_episodes from public, anon, authenticated;
grant select, insert, update, delete on table public.central_assistant_learning_episodes to service_role;

comment on table public.central_assistant_learning_episodes is
  'Private companion suggestions, attempts, factual outcomes and human feedback. Service-only access; the server verifies the current worker and client scope on every request. Experience is derived, never written by clients.';

notify pgrst, 'reload schema';
commit;
