-- An administrator enables automatic replies from the Office. Discovery and reporting
-- remain available while the sender is paused.
create table public.office_capture_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  actor_user_id uuid references auth.users(id),
  last_round_at timestamptz,
  last_round jsonb,
  check (not enabled or actor_user_id is not null)
);
insert into public.office_capture_settings (id) values (true);

create table public.office_capture_lines (
  country text primary key check (country ~ '^[A-Z]{2}$'),
  phone text not null check (phone ~ '^[+0-9][0-9 ]{6,23}$'),
  enabled boolean not null default true
);
-- The preferred customer numbers plus the other geographic markets marked 'En uso'
-- in B2COM's routing directory on 22 November 2026.
insert into public.office_capture_lines(country, phone) values
  ('PR', '+1 787 945 0710'), ('US', '+1 786 539 4750'), ('ES', '93 050 25 86'),
  ('DO', '+1 829 954 8005'), ('CL', '+56 2 3210 0942');

alter table public.office_capture_settings enable row level security;
alter table public.office_capture_lines enable row level security;
revoke all on public.office_capture_settings, public.office_capture_lines from public, anon, authenticated;
grant select, update on public.office_capture_settings, public.office_capture_lines to service_role;
