-- Keep the original booking and its notes for audit; operational readers exclude deleted_at.
alter table public.reservas add column if not exists deleted_at timestamptz;
alter table public.reservas add column if not exists deleted_by_worker_id uuid references public.workers(id) on delete set null;
create index if not exists reservas_deleted_by_worker_idx on public.reservas(deleted_by_worker_id) where deleted_by_worker_id is not null;
comment on column public.reservas.deleted_at is 'Soft deletion from the operational agenda; booking record and notes are preserved.';
