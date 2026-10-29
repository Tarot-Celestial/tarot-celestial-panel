-- Production preflight found Supabase default privileges had granted ALL to
-- service_role. Reset only the six new tables to their intended capabilities.
-- CLI unavailable on this host; filename uses verified UTC time 2026-10-28 23:58:48.
revoke all on public.attendance_panel_sessions,
 public.central_statistics_activation,
 public.central_work_config_versions,
 public.central_workday_overrides,
 public.central_time_adjustments,
 public.central_statistics_operations from service_role;

grant select,insert,update on public.attendance_panel_sessions to service_role;
grant select on public.central_statistics_activation to service_role;
grant select,insert on public.central_work_config_versions,
 public.central_workday_overrides,
 public.central_time_adjustments,
 public.central_statistics_operations to service_role;

-- Verified absent covering indexes for the new audit foreign keys only.
create index if not exists central_statistics_operations_actor
 on public.central_statistics_operations(actor_id);
create index if not exists central_statistics_operations_worker
 on public.central_statistics_operations(worker_id);
create index if not exists central_time_adjustments_author
 on public.central_time_adjustments(created_by);
create index if not exists central_work_config_versions_author
 on public.central_work_config_versions(created_by);
create index if not exists central_workday_overrides_author
 on public.central_workday_overrides(created_by);
