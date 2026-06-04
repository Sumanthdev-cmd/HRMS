# AI-HRMS SaaS

A React + Vite + Express full-stack prototype for an AI-enabled HRMS SaaS product.

## Included Modules

- Role-aware dashboards for Management Admin, Senior Manager, HR Recruiter, and Employee.
- Core HRMS surfaces backed by API data: employee profiles, attendance, leave approvals, payroll, salary slips, departments, documents, announcements, and notifications.
- Functional backend actions: add employee, sync attendance, create/approve/reject leave, generate/download salary slips, mark notifications read, export dashboard data.
- Leave workflow: employees can create and withdraw their own pending leave requests; higher officers such as Senior Manager and Management Admin approve or cancel requests.
- Recruitment module with backend resume parsing mock, candidate matching, and shortlist workflow.
- AI HR chatbot, voice assistant control state, and attendance/performance insight panels wired to backend routes.
- Responsible AI safety note: screening output supports HR review and never auto-rejects candidates.

## Run Locally

```bash
npm install
npm run dev
```

The full-stack dev command starts both services:

```text
Frontend: http://localhost:5173/
Backend:  http://localhost:4000/
```

Vite proxies `/api/*` to the backend.

## Demo Login

Use any of these accounts on the login screen:

```text
admin@yourcompany.com / admin123
manager@yourcompany.com / manager123
recruiter@yourcompany.com / recruiter123
employee@yourcompany.com / employee123
```

## Verify

```bash
npm run lint
npm run build
```

## Production Hosting

Use GitHub for the source repository, then deploy the full-stack app to a Node host such as Render.

Recommended Render settings:

```text
Build command: npm install && npm run build
Start command: npm run server
```

Required environment variables:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
PUBLIC_APP_URL
BREVO_API_KEY
EMAIL_FROM=AI-HRMS <your-verified-sender@gmail.com>
```

Brevo is the recommended hosted email provider on Render because it sends through HTTPS instead of blocked SMTP ports. Verify the sender email in Brevo before sending candidate emails.

Optional Gmail SMTP settings for local development or hosts that allow SMTP:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-gmail-address@gmail.com
SMTP_PASS=your-gmail-app-password
EMAIL_FROM=AI-HRMS <your-gmail-address@gmail.com>
```

`RESEND_API_KEY` is optional if you later verify a sending domain in Resend.

GitHub Pages is only suitable for static frontend files. This app needs the Express backend for Supabase service-role sync, realtime updates, resume parsing, and candidate emails, so deploy it as a Node service.
