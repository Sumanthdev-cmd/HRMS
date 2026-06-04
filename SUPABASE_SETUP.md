# Supabase Setup for AI-HRMS

This project can now use Supabase for login. If Supabase keys are missing, the backend keeps using the local development users so the app remains testable.

## 1. Create or Open Your Supabase Project

1. Go to your Supabase dashboard.
2. Open your project.
3. Go to **Project Settings > API**.
4. Copy:
   - Project URL
   - anon/public key
   - service_role key

Keep the `service_role` key private. It must only be used by the Node backend.

## 2. Add Environment Variables

Create a `.env` file in the project root by copying `.env.example`.

```bash
cp .env.example .env
```

Fill these values:

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key

VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key

NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-anon-or-publishable-key
```

For the current app, login is handled by the backend, so the important values are `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
The backend also accepts `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, which are the names Supabase commonly shows for frontend examples.

`SUPABASE_SERVICE_ROLE_KEY` is required for backend data storage. The publishable key is enough for login, but it should not be used for server-side writes to HRMS data.

## 3. Create Tables and Policies

1. In Supabase, open **SQL Editor**.
2. Open this local file: `supabase/schema.sql`.
3. Paste the full SQL into Supabase.
4. Run it.

This creates:

- `profiles` for user role and display name.
- `employees`, `jobs`, `leave_requests`, `announcements`, `notifications`, `salary_slips`, `shortlisted_candidates`, `team_groups`, and team message tables.
- Row Level Security policies.
- A trigger that creates a profile row when a new Supabase Auth user is added.

## 4. Create Login Users

In Supabase, go to **Authentication > Users > Add user**.

Create one user for each role. Set their email and password, then add user metadata:

```json
{
  "full_name": "Management Admin",
  "role": "admin"
}
```

Use these role values exactly:

```text
admin
manager
recruiter
employee
```

Example accounts you can create:

| Role | Email | Metadata role |
| --- | --- | --- |
| Management Admin | admin@yourcompany.com | admin |
| Senior Manager | manager@yourcompany.com | manager |
| HR Recruiter | recruiter@yourcompany.com | recruiter |
| Employee | employee@yourcompany.com | employee |

If metadata was not added during user creation, run this after creating the user:

```sql
update public.profiles
set full_name = 'Management Admin', role = 'admin'
where email = 'admin@yourcompany.com';
```

Repeat for each login.

## 5. Restart the Website

Stop the running dev server and start it again:

```bash
npm run dev
```

Open:

```text
http://localhost:5173/
```

Now login with the Supabase users you created. If the `.env` values are correct, the backend will authenticate using Supabase Auth.

## 6. What Is Connected Now

Connected now:

- Email/password login through Supabase Auth.
- User name and role loaded from the `profiles` table.
- Secure server-only service role access for profile lookup.
- Local login fallback when Supabase is not configured.

Prepared for Supabase database migration:

- HRMS tables and Row Level Security policies are included in `supabase/schema.sql`.
- The existing app screens can be moved from in-memory backend state to these tables step by step.

Recommended next migration order:

1. Employees
2. Leave requests
3. Announcements and notifications
4. Jobs and shortlisted candidates
5. Payroll and salary slips
6. Team-up messages

## 7. Store HRMS Data in Supabase

The backend stores the current HRMS application data in the `public.hrms_app_state` table. This covers employees, attendance, leaves, payroll, recruitment, shortlists, announcements, notifications, documents, and team-up messages.

The backend also mirrors every module into `public.hrms_module_records`, so you can query each module separately instead of opening the full JSON state.

Dashboard analytics seed data lives in `server/data/analytics-seed.csv`. The backend seeds that CSV into `public.hrms_analytics_records` and then reads attendance, performance, payroll, and insight data from Supabase for the dashboard.

If you already ran `supabase/schema.sql`, run only this migration in Supabase SQL Editor:

```text
supabase/app-state-storage.sql
```

Then add the server-only key to `.env`:

```bash
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
```

Restart the app:

```bash
npm run dev
```

Check storage status:

```text
http://localhost:4000/api/auth/status
```

It should show:

```json
{
  "storageProvider": "supabase",
  "storageTable": "hrms_app_state",
  "moduleRecordsTable": "hrms_module_records",
  "analyticsTable": "hrms_analytics_records"
}
```

If it shows `"runtime-only"`, the service role key is missing or the server was not restarted.

Useful Supabase checks:

```sql
select id, updated_at
from public.hrms_app_state;
```

```sql
select module, count(*) as records
from public.hrms_module_records
group by module
order by module;
```

```sql
select record_id, data
from public.hrms_module_records
where module = 'leaveRequests';
```

```sql
select category, record_key, data
from public.hrms_analytics_records
order by category, sort_order;
```
