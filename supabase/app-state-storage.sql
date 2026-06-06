create table if not exists public.hrms_app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.hrms_module_records (
  company_id text not null,
  module text not null,
  record_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, module, record_id)
);

create table if not exists public.hrms_analytics_records (
  company_id text not null,
  category text not null,
  record_key text not null,
  sort_order integer not null default 0,
  data jsonb not null,
  source text not null default 'supabase',
  updated_at timestamptz not null default now(),
  primary key (company_id, category, record_key)
);

create table if not exists public.employee_tasks (
  id uuid primary key default gen_random_uuid(),
  app_record_id text unique not null,
  employee_code text,
  assigned_to text not null,
  assigned_by text not null,
  department text not null,
  title text not null,
  description text not null default '',
  priority text not null default 'Medium',
  status text not null default 'Pending',
  due_date date,
  completed_at date,
  estimated_hours numeric(8, 2) not null default 0,
  actual_hours numeric(8, 2) not null default 0,
  quality_score numeric(5, 2) not null default 0,
  productivity_score numeric(5, 2) not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leave_requests
  add column if not exists app_record_id text unique;

alter table public.shortlisted_candidates
  add column if not exists app_record_id text unique;

alter table public.announcements
  add column if not exists app_record_id text unique;

alter table public.notifications
  add column if not exists app_record_id text unique;

alter table public.jobs
  add column if not exists app_record_id text unique;

alter table public.salary_slips
  add column if not exists app_record_id text unique;

alter table public.hrms_app_state enable row level security;
alter table public.hrms_module_records enable row level security;
alter table public.hrms_analytics_records enable row level security;
alter table public.employee_tasks enable row level security;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

drop policy if exists "admins_read_hrms_app_state" on public.hrms_app_state;
create policy "admins_read_hrms_app_state"
  on public.hrms_app_state for select
  to authenticated
  using (public.current_profile_role() = 'admin');

drop policy if exists "admins_manage_hrms_app_state" on public.hrms_app_state;
create policy "admins_manage_hrms_app_state"
  on public.hrms_app_state for all
  to authenticated
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

drop policy if exists "admins_read_hrms_module_records" on public.hrms_module_records;
create policy "admins_read_hrms_module_records"
  on public.hrms_module_records for select
  to authenticated
  using (public.current_profile_role() = 'admin');

drop policy if exists "admins_manage_hrms_module_records" on public.hrms_module_records;
create policy "admins_manage_hrms_module_records"
  on public.hrms_module_records for all
  to authenticated
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

drop policy if exists "admins_read_hrms_analytics_records" on public.hrms_analytics_records;
create policy "admins_read_hrms_analytics_records"
  on public.hrms_analytics_records for select
  to authenticated
  using (public.current_profile_role() = 'admin');

drop policy if exists "admins_manage_hrms_analytics_records" on public.hrms_analytics_records;
create policy "admins_manage_hrms_analytics_records"
  on public.hrms_analytics_records for all
  to authenticated
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

drop policy if exists "authenticated_read_employee_tasks" on public.employee_tasks;
create policy "authenticated_read_employee_tasks"
  on public.employee_tasks for select
  to authenticated
  using (true);

drop policy if exists "managers_admins_manage_employee_tasks" on public.employee_tasks;
create policy "managers_admins_manage_employee_tasks"
  on public.employee_tasks for all
  to authenticated
  using (public.current_profile_role() in ('admin', 'manager'))
  with check (public.current_profile_role() in ('admin', 'manager'));
