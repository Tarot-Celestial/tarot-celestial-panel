-- Extend the existing companion catalog. Keep all profiles and private memories.
-- Assignment to a worker is performed separately after deploying the matching UI.
begin;
alter table public.central_assistant_profiles drop constraint if exists central_assistant_profiles_pet_check;
alter table public.central_assistant_profiles add constraint central_assistant_profiles_pet_check check (pet in ('sol','draco','ambar'));
commit;
