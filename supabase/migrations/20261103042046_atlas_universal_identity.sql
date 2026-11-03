-- Atlas is the public identity everywhere. Preserve account ownership, preferences,
-- messages, memories, tasks, deliveries and learning. Old sessions remain writable.
begin;
alter table public.central_assistant_profiles drop constraint if exists central_assistant_profiles_pet_check;
alter table public.central_assistant_profiles add constraint central_assistant_profiles_pet_check
  check (pet in ('atlas','sol','draco','ambar'));
alter table public.central_assistant_profiles alter column pet set default 'atlas';
update public.central_assistant_profiles set pet='atlas' where pet is distinct from 'atlas';
commit;
