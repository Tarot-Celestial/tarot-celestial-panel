-- Personal chat visibility for administrators, centrals and tarotists.
-- No message or thread is deleted when a user hides a contact.
create table if not exists public.staff_chat_hidden_contacts (
  worker_id uuid not null references public.workers(id) on delete cascade,
  contact_worker_id uuid not null references public.workers(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (worker_id, contact_worker_id),
  constraint staff_chat_hidden_contacts_not_self check (worker_id <> contact_worker_id)
);
create index if not exists staff_chat_hidden_contacts_contact_idx
  on public.staff_chat_hidden_contacts (contact_worker_id);
alter table public.staff_chat_hidden_contacts enable row level security;
revoke all on public.staff_chat_hidden_contacts from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.staff_chat_hidden_contacts to service_role;
