create extension if not exists pgcrypto;

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

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text not null,
  role text not null default 'employee'
    check (role in ('admin', 'manager', 'recruiter', 'employee')),
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text unique not null,
  full_name text not null,
  work_email text unique not null,
  job_title text not null,
  department text not null,
  manager_id uuid references public.employees(id),
  annual_ctc numeric(12, 2) not null default 0,
  monthly_cab_charges numeric(10, 2) not null default 0,
  status text not null default 'Active',
  performance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  app_record_id text unique,
  title text not null,
  department text not null,
  skills text[] not null default '{}',
  description text not null default '',
  status text not null default 'Open',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  app_record_id text unique,
  employee_id uuid references public.employees(id),
  requested_by uuid references auth.users(id),
  request_date date not null default current_date,
  start_date date not null,
  end_date date not null,
  leave_type text not null check (leave_type in ('leave', 'work_from_home', 'special_leave')),
  special_category text,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'cancelled', 'withdrawn')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  app_record_id text unique,
  title text not null,
  body text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  app_record_id text unique,
  user_id uuid references auth.users(id),
  title text not null,
  body text not null default '',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.salary_slips (
  id uuid primary key default gen_random_uuid(),
  app_record_id text unique,
  employee_id uuid references public.employees(id),
  month text not null,
  annual_ctc numeric(12, 2) not null,
  salary_breakup jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
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

create table if not exists public.shortlisted_candidates (
  id uuid primary key default gen_random_uuid(),
  app_record_id text unique,
  job_id uuid references public.jobs(id),
  candidate_name text not null,
  candidate_email text not null,
  match_score numeric(5, 2) not null default 0,
  resume_summary jsonb not null default '{}'::jsonb,
  notified_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.team_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.team_group_members (
  team_id uuid references public.team_groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  primary key (team_id, user_id)
);

create table if not exists public.team_messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.team_groups(id) on delete cascade,
  author_id uuid references auth.users(id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.hrms_app_state enable row level security;
alter table public.hrms_module_records enable row level security;
alter table public.hrms_analytics_records enable row level security;
alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.jobs enable row level security;
alter table public.leave_requests enable row level security;
alter table public.announcements enable row level security;
alter table public.notifications enable row level security;
alter table public.salary_slips enable row level security;
alter table public.employee_tasks enable row level security;
alter table public.shortlisted_candidates enable row level security;
alter table public.team_groups enable row level security;
alter table public.team_group_members enable row level security;
alter table public.team_messages enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'employee')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        role = excluded.role;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create policy "profiles_select_own_or_admin"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id or public.current_profile_role() = 'admin');

create policy "admins_read_hrms_app_state"
  on public.hrms_app_state for select
  to authenticated
  using (public.current_profile_role() = 'admin');

create policy "admins_manage_hrms_app_state"
  on public.hrms_app_state for all
  to authenticated
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

create policy "admins_read_hrms_module_records"
  on public.hrms_module_records for select
  to authenticated
  using (public.current_profile_role() = 'admin');

create policy "admins_manage_hrms_module_records"
  on public.hrms_module_records for all
  to authenticated
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

create policy "admins_read_hrms_analytics_records"
  on public.hrms_analytics_records for select
  to authenticated
  using (public.current_profile_role() = 'admin');

create policy "admins_manage_hrms_analytics_records"
  on public.hrms_analytics_records for all
  to authenticated
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

create policy "profiles_update_own_or_admin"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id or public.current_profile_role() = 'admin')
  with check (auth.uid() = id or public.current_profile_role() = 'admin');

create policy "admin_manage_all_profiles"
  on public.profiles for all
  to authenticated
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

create policy "authenticated_read_employees"
  on public.employees for select
  to authenticated
  using (true);

create policy "authenticated_read_employee_tasks"
  on public.employee_tasks for select
  to authenticated
  using (true);

create policy "managers_admins_manage_employee_tasks"
  on public.employee_tasks for all
  to authenticated
  using (public.current_profile_role() in ('admin', 'manager'))
  with check (public.current_profile_role() in ('admin', 'manager'));

create policy "hr_admin_manage_employees"
  on public.employees for all
  to authenticated
  using (public.current_profile_role() in ('admin', 'recruiter'))
  with check (public.current_profile_role() in ('admin', 'recruiter'));

create policy "authenticated_read_jobs"
  on public.jobs for select
  to authenticated
  using (true);

create policy "recruiters_manage_jobs"
  on public.jobs for all
  to authenticated
  using (public.current_profile_role() in ('admin', 'recruiter'))
  with check (public.current_profile_role() in ('admin', 'recruiter'));

create policy "leave_read_relevant"
  on public.leave_requests for select
  to authenticated
  using (
    requested_by = auth.uid()
    or public.current_profile_role() in ('admin', 'manager')
  );

create policy "employees_create_leave"
  on public.leave_requests for insert
  to authenticated
  with check (requested_by = auth.uid());

create policy "managers_decide_leave"
  on public.leave_requests for update
  to authenticated
  using (public.current_profile_role() in ('admin', 'manager') or requested_by = auth.uid())
  with check (public.current_profile_role() in ('admin', 'manager') or requested_by = auth.uid());

create policy "authenticated_read_announcements"
  on public.announcements for select
  to authenticated
  using (true);

create policy "admin_manage_announcements"
  on public.announcements for all
  to authenticated
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

create policy "notifications_own"
  on public.notifications for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "salary_read_own_or_admin"
  on public.salary_slips for select
  to authenticated
  using (public.current_profile_role() in ('admin', 'manager') or employee_id in (
    select id from public.employees where work_email = (select email from public.profiles where id = auth.uid())
  ));

create policy "admin_manage_salary"
  on public.salary_slips for all
  to authenticated
  using (public.current_profile_role() = 'admin')
  with check (public.current_profile_role() = 'admin');

create policy "recruiters_manage_shortlists"
  on public.shortlisted_candidates for all
  to authenticated
  using (public.current_profile_role() in ('admin', 'recruiter'))
  with check (public.current_profile_role() in ('admin', 'recruiter'));

create policy "authenticated_read_team_groups"
  on public.team_groups for select
  to authenticated
  using (true);

create policy "authenticated_create_team_groups"
  on public.team_groups for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "authenticated_manage_team_members"
  on public.team_group_members for all
  to authenticated
  using (true)
  with check (true);

create policy "authenticated_read_team_messages"
  on public.team_messages for select
  to authenticated
  using (true);

create policy "authenticated_create_team_messages"
  on public.team_messages for insert
  to authenticated
  with check (author_id = auth.uid());
