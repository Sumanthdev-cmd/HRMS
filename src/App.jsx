import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Bell,
  Bot,
  BriefcaseBusiness,
  Calculator,
  CalendarCheck,
  Check,
  ClipboardCheck,
  Download,
  FileSearch,
  FileText,
  Gauge,
  LayoutDashboard,
  MessageSquare,
  Mic,
  PanelLeft,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  UsersRound,
  Video,
  WalletCards,
  X,
} from 'lucide-react'
import './App.css'

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'people', label: 'Employees', icon: UsersRound },
  { id: 'tasks', label: 'Tasks', icon: ClipboardCheck },
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { id: 'leave', label: 'Leave', icon: ClipboardCheck },
  { id: 'payroll', label: 'Payroll', icon: WalletCards },
  { id: 'recruitment', label: 'Recruitment', icon: BriefcaseBusiness },
  { id: 'salary', label: 'Salary Calculator', icon: Calculator },
  { id: 'teamup', label: 'Team-up', icon: MessageSquare },
  { id: 'ai', label: 'AI Center', icon: Sparkles },
]

const metricIcons = {
  employees: UsersRound,
  attendance: CalendarCheck,
  payroll: WalletCards,
  performance: Gauge,
}

const defaultJobDescription =
  'React, Node.js, Python, PostgreSQL, HR analytics, payroll automation, LLM workflows'

async function api(path, options = {}) {
  const headers = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {}),
  }
  const response = await fetch(path, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const message = await response.text()
    let parsed

    try {
      parsed = JSON.parse(message)
    } catch {
      parsed = null
    }

    throw new Error(parsed?.error || message)
  }

  return response.json()
}

function App() {
  const publicScreeningMatch = window.location.pathname.match(/^\/candidate-screening\/([^/]+)/)
  const [data, setData] = useState(null)
  const [auth, setAuth] = useState(null)
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [role, setRole] = useState('admin')
  const [activeTab, setActiveTab] = useState('dashboard')
  const [query, setQuery] = useState('How many leaves do I have?')
  const [chatAnswer, setChatAnswer] = useState('')
  const [jobDescription, setJobDescription] = useState(defaultJobDescription)
  const [appliedJobId, setAppliedJobId] = useState('')
  const [match, setMatch] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('All')
  const [status, setStatus] = useState('Please sign in to continue.')
  const [liveSyncStatus, setLiveSyncStatus] = useState('Live sync waiting')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [passwordPanelOpen, setPasswordPanelOpen] = useState(false)
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const notificationRef = useRef(null)

  useEffect(() => {
    if (!auth) {
      return
    }

    async function loadInitialData() {
      const bootstrap = await api('/api/bootstrap')
      const result = await api('/api/recruitment/match', {
        method: 'POST',
        body: JSON.stringify({ jobDescription: defaultJobDescription }),
      })
      setData(bootstrap)
      setMatch(result.match)
      setChatAnswer('Ask a leave, attendance, or payslip question.')
      setStatus(`Signed in as ${auth.user.name}. Backend connected.`)
      if (result.bestRole) {
        setMatch(result.bestRole)
      }
    }

    loadInitialData().catch((error) => {
      setStatus(error.message || 'Could not connect to backend.')
    })
  }, [auth])

  useEffect(() => {
    if (!auth) {
      return undefined
    }

    const source = new EventSource('/api/realtime')

    source.onopen = () => {
      setLiveSyncStatus('Live sync connected')
    }

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)

        if (payload.type === 'state' && payload.data) {
          setData(payload.data)
          const syncedAt = new Date(payload.syncedAt)
          setLiveSyncStatus(`Synced ${syncedAt.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
          })}`)
        }
      } catch {
        setLiveSyncStatus('Live sync received unreadable data')
      }
    }

    source.onerror = () => {
      setLiveSyncStatus('Live sync reconnecting')
    }

    return () => {
      source.close()
    }
  }, [auth])

  useEffect(() => {
    if (!notificationsOpen) {
      return undefined
    }

    function closeNotificationsOnOutsideClick(event) {
      if (!notificationRef.current?.contains(event.target)) {
        setNotificationsOpen(false)
      }
    }

    document.addEventListener('mousedown', closeNotificationsOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeNotificationsOnOutsideClick)
  }, [notificationsOpen])

  if (publicScreeningMatch) {
    return <CandidateScreeningPortal shortlistId={publicScreeningMatch[1]} />
  }

  async function handleLogin(event) {
    event.preventDefault()
    setStatus('Signing in...')
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(loginForm),
      })
      setAuth(result)
      setRole(result.user.role)
      setActiveTab('dashboard')
      setStatus(`Login successful. Opening ${result.user.role} panel...`)
    } catch (error) {
      setStatus(error.message || 'Invalid login. Check your company email and password.')
    }
  }

  async function runAction(action, successMessage) {
    try {
      await action()
      setStatus(successMessage)
    } catch (error) {
      setStatus(error.message || 'Action failed')
    }
  }

  async function runCandidateMatch(showStatus = true) {
    const result = await api('/api/recruitment/match', {
      method: 'POST',
      body: JSON.stringify({ jobDescription }),
    })
    setMatch(result.match)
    if (showStatus) {
      setStatus('AI candidate match recalculated by backend.')
    }
  }

  if (!auth) {
    return (
      <LoginScreen
        form={loginForm}
        setForm={setLoginForm}
        status={status}
        onSubmit={handleLogin}
      />
    )
  }

  if (!data) {
    return (
      <div className="loading-screen">
        <ShieldCheck size={34} />
        <strong>Starting AI-HRMS</strong>
        <span>{status}</span>
      </div>
    )
  }

  const visibleNav = navItems.filter((item) => data.permissions[role].includes(item.id))
  const activeRole = data.roles.find((item) => item.id === role)
  const safeActiveTab = data.permissions[role].includes(activeTab) ? activeTab : visibleNav[0].id
  const visibleNotifications = visibleNotificationsForRole(data.notifications, role)
  const unread = visibleNotifications.filter((notification) => !notification.read).length
  const searchFilteredEmployees = filterItems(data.employees, searchTerm, ['name', 'role', 'department', 'manager'])
  const filteredEmployees =
    departmentFilter === 'All'
      ? searchFilteredEmployees
      : searchFilteredEmployees.filter((employee) => employee.department === departmentFilter)
  const filteredJobs = filterItems(data.jobs, searchTerm, ['title', 'department'])

  const actions = {
    exportDashboard: () => {
      window.open('/api/dashboard/export', '_blank')
      setStatus('Dashboard export requested from backend.')
    },
    markNotificationsRead: async () => {
      const result = await api('/api/notifications/read', {
        method: 'POST',
        body: JSON.stringify({ ids: visibleNotifications.map((notification) => notification.id) }),
      })
      setData((current) => ({ ...current, notifications: result.notifications }))
    },
    markNotificationRead: async (id) => {
      const result = await api(`/api/notifications/${id}/read`, { method: 'PATCH' })
      setData((current) => ({ ...current, notifications: result.notifications }))
    },
    changePassword: async (passwordPayload) => api('/api/auth/password', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify(passwordPayload),
    }),
    addEmployee: async (employee) => {
      const result = await api('/api/employees', {
        method: 'POST',
        body: JSON.stringify({
          ...employee,
          actorName: auth.user.name,
          actorRole: role,
        }),
      })
      setData((current) => ({
        ...current,
        employees: result.employees,
        metrics: result.metrics,
          notifications: result.notifications,
      }))
      return result
    },
    reviewEmployee: async (employeeId, review) => {
      const result = await api(`/api/employees/${employeeId}/review`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...review,
          actorName: auth.user.name,
          actorEmail: auth.user.email,
          actorRole: role,
        }),
      })
      setData((current) => ({
        ...current,
        employees: result.employees,
        metrics: result.metrics,
        notifications: result.notifications,
      }))
    },
    uploadDocument: async (documentForm) => {
      const formData = new FormData()
      formData.append('title', documentForm.title)
      formData.append('category', documentForm.category)
      formData.append('actorName', auth.user.name)
      formData.append('actorRole', role)
      if (documentForm.file) {
        formData.append('document', documentForm.file)
      }
      const result = await api('/api/documents', { method: 'POST', body: formData })
      setData((current) => ({
        ...current,
        documents: result.documents,
        notifications: result.notifications,
      }))
    },
    acknowledgeDocument: async (id) => {
      const result = await api(`/api/documents/${id}/acknowledge`, {
        method: 'PATCH',
        body: JSON.stringify({
          actorName: auth.user.name,
          actorRole: role,
        }),
      })
      setData((current) => ({ ...current, documents: result.documents }))
    },
    addJob: async (job) => {
      const result = await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          ...job,
          actorName: auth.user.name,
          actorRole: role,
        }),
      })
      setData((current) => ({
        ...current,
        jobs: result.jobs,
        notifications: result.notifications,
      }))
    },
    postAnnouncement: async (announcement) => {
      const result = await api('/api/announcements', {
        method: 'POST',
        body: JSON.stringify({
          ...announcement,
          actorName: auth.user.name,
          actorRole: role,
        }),
      })
      setData((current) => ({
        ...current,
        announcements: result.announcements,
        notifications: result.notifications,
      }))
    },
    deleteAnnouncement: async (id) => {
      const result = await api(`/api/announcements/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({
          actorName: auth.user.name,
          actorRole: role,
        }),
      })
      setData((current) => ({
        ...current,
        announcements: result.announcements,
        notifications: result.notifications,
      }))
    },
    createTeam: async (team) => {
      const result = await api('/api/teams', {
        method: 'POST',
        body: JSON.stringify({
          ...team,
          actorName: auth.user.name,
          actorRole: role,
        }),
      })
      setData((current) => ({
        ...current,
        teams: result.teams,
        notifications: result.notifications,
      }))
    },
    sendTeamMessage: async (teamId, message) => {
      const formData = new FormData()
      formData.append('text', message.text)
      formData.append('actorName', auth.user.name)
      formData.append('actorRole', role)

      if (message.file) {
        formData.append('attachment', message.file)
      }

      const result = await api(`/api/teams/${teamId}/messages`, {
        method: 'POST',
        body: formData,
      })
      setData((current) => ({ ...current, teams: result.teams }))
    },
    syncAttendance: async () => {
      const result = await api('/api/attendance/sync', { method: 'POST' })
      setData((current) => ({ ...current, attendance: result.attendance, insights: result.insights }))
    },
    createLeave: async (leaveRequest) => {
      const result = await api('/api/leave', {
        method: 'POST',
        body: JSON.stringify({
          ...leaveRequest,
          person: auth.user.name,
          actorName: auth.user.name,
          actorEmail: auth.user.email,
          actorRole: role,
        }),
      })
      setData((current) => ({
        ...current,
        leaveRequests: result.leaveRequests,
        employees: result.employees || current.employees,
        notifications: result.notifications,
      }))
    },
    updateLeave: async (id, statusValue) => {
      const result = await api(`/api/leave/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: statusValue,
          actorName: auth.user.name,
          actorEmail: auth.user.email,
          actorRole: role,
        }),
      })
      setData((current) => ({
        ...current,
        leaveRequests: result.leaveRequests,
        employees: result.employees || current.employees,
        notifications: result.notifications || current.notifications,
      }))
    },
    generatePayroll: async () => {
      const result = await api('/api/payroll/generate', {
        method: 'POST',
        body: JSON.stringify({
          actorName: auth.user.name,
          actorRole: role,
        }),
      })
      setData((current) => ({
        ...current,
        payrollApprovals: result.payrollApprovals,
        salarySlips: result.salarySlips,
        notifications: result.notifications,
      }))
    },
    reviewPayroll: async (id, statusValue) => {
      const result = await api(`/api/payroll/approvals/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: statusValue,
          actorName: auth.user.name,
          actorRole: role,
        }),
      })
      setData((current) => ({
        ...current,
        payrollApprovals: result.payrollApprovals,
        salarySlips: result.salarySlips,
        notifications: result.notifications,
      }))
    },
    assignTask: async (task) => {
      const result = await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          ...task,
          actorName: auth.user.name,
          actorEmail: auth.user.email,
          actorRole: role,
        }),
      })
      setData((current) => ({
        ...current,
        tasks: result.tasks,
        productivity: result.productivity,
        performance: result.performance,
        notifications: result.notifications,
      }))
    },
    updateTask: async (id, taskUpdate) => {
      const result = await api(`/api/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...taskUpdate,
          actorName: auth.user.name,
          actorRole: role,
        }),
      })
      setData((current) => ({
        ...current,
        tasks: result.tasks,
        productivity: result.productivity,
        performance: result.performance,
        notifications: result.notifications,
      }))
    },
    reviewTask: async (id, review) => {
      const result = await api(`/api/tasks/${id}/review`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...review,
          actorName: auth.user.name,
          actorRole: role,
        }),
      })
      setData((current) => ({
        ...current,
        tasks: result.tasks,
        productivity: result.productivity,
        performance: result.performance,
        notifications: result.notifications,
      }))
    },
    parseResumes: async (files) => {
      const formData = new FormData()
      files.forEach((file) => {
        formData.append('resumes', file)
      })
      formData.append('jobDescription', jobDescription)
      formData.append('appliedJobId', appliedJobId || data.jobs[0]?.id || '')
      const result = await api('/api/recruitment/parse', { method: 'POST', body: formData })
      setData((current) => ({
        ...current,
        candidate: result.candidate,
        candidateResults: result.results,
      }))
      if (result.results?.[0]) {
        setMatch(result.results[0].bestRole || result.results[0].match)
      }
    },
    shortlist: async () => {
      const result = await api('/api/recruitment/shortlist', {
        method: 'POST',
        body: JSON.stringify({ jobTitle: data.jobs[0].title, score: match?.score || 0 }),
      })
      setData((current) => ({ ...current, shortlists: result.shortlists, notifications: result.notifications }))
    },
    shortlistCandidate: async (candidate, candidateMatch) => {
      const result = await api('/api/recruitment/shortlist', {
        method: 'POST',
        body: JSON.stringify({
          jobTitle: candidateMatch?.title || data.jobs[0].title,
          score: candidateMatch?.score || 0,
          fileName: candidate.fileName,
        }),
      })
      setData((current) => ({ ...current, shortlists: result.shortlists, notifications: result.notifications }))
    },
    notifyShortlistedCandidate: async (id) => {
      const result = await api(`/api/recruitment/shortlist/${id}/notify`, { method: 'POST' })
      setData((current) => ({ ...current, shortlists: result.shortlists, notifications: result.notifications }))
    },
    notifyAllShortlistedCandidates: async () => {
      const result = await api('/api/recruitment/shortlist/notify-all', { method: 'POST' })
      setData((current) => ({ ...current, shortlists: result.shortlists, notifications: result.notifications }))
      return result.notifiedCount
    },
    scheduleVideoInterview: async (id, interview) => {
      const result = await api(`/api/recruitment/shortlist/${id}/video-interview`, {
        method: 'POST',
        body: JSON.stringify({
          ...interview,
          actorName: auth.user.name,
          actorRole: role,
        }),
      })
      setData((current) => ({ ...current, shortlists: result.shortlists, notifications: result.notifications }))
    },
    startCandidateScreening: async (id) => {
      const result = await api(`/api/recruitment/shortlist/${id}/screening/start`, {
        method: 'POST',
        body: JSON.stringify({
          actorName: auth.user.name,
          actorRole: role,
        }),
      })
      setData((current) => ({ ...current, shortlists: result.shortlists, notifications: result.notifications }))
    },
    sendCandidateScreeningMessage: async (id, text, mode = 'text') => {
      const result = await api(`/api/recruitment/shortlist/${id}/screening/message`, {
        method: 'POST',
        body: JSON.stringify({
          text,
          mode,
          actorName: auth.user.name,
          actorRole: role,
        }),
      })
      setData((current) => ({ ...current, shortlists: result.shortlists, notifications: result.notifications }))
    },
    markShortlistedCandidateSelected: async (id) => {
      const result = await api(`/api/recruitment/shortlist/${id}/selection`, {
        method: 'PATCH',
        body: JSON.stringify({
          actorName: auth.user.name,
          actorRole: role,
        }),
      })
      setData((current) => ({ ...current, shortlists: result.shortlists, notifications: result.notifications }))
    },
    deleteShortlistedCandidate: async (id) => {
      const result = await api(`/api/recruitment/shortlist/${id}`, { method: 'DELETE' })
      setData((current) => ({ ...current, shortlists: result.shortlists }))
    },
    clearShortlistedCandidates: async () => {
      const result = await api('/api/recruitment/shortlist', { method: 'DELETE' })
      setData((current) => ({ ...current, shortlists: result.shortlists }))
    },
    askChat: async () => {
      const result = await api('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ query }),
      })
      setChatAnswer(result.answer)
    },
    toggleVoice: async () => {
      const result = await api('/api/ai/voice', { method: 'POST' })
      setData((current) => ({ ...current, voiceListening: result.listening }))
      setChatAnswer(result.transcript)
    },
    submitVoiceQuery: async (transcript) => {
      const result = await api('/api/ai/voice', {
        method: 'POST',
        body: JSON.stringify({ transcript }),
      })
      setQuery(result.transcript)
      setChatAnswer(result.answer)
      setData((current) => ({ ...current, voiceListening: result.listening }))
    },
  }

  return (
    <div className={mobileOpen ? 'app-shell nav-open' : 'app-shell'}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={24} />
          </div>
          <div>
            <strong>AI-HRMS</strong>
            <span>Full-stack SaaS</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          {visibleNav.map((item) => {
            const Icon = item.icon
            return (
              <button
                className={safeActiveTab === item.id ? 'nav-item active' : 'nav-item'}
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id)
                  setMobileOpen(false)
                }}
                title={item.label}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="role-card">
          <span>Current access</span>
          <strong>{activeRole.label}</strong>
          <p>{activeRole.access}</p>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            type="button"
            title="Toggle navigation"
            onClick={() => setMobileOpen((current) => !current)}
          >
            {mobileOpen ? <X size={19} /> : <PanelLeft size={19} />}
          </button>
          <div>
            <p className="eyebrow">Human resources operating system</p>
            <h1>{pageTitle(safeActiveTab)}</h1>
          </div>
          <div className="topbar-actions">
            <DateTimeBadge />
            <label className="search-box">
              <Search size={17} />
              <input
                placeholder="Search people, payslips, jobs"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>
            <div className="role-badge">
              <span>Role</span>
              <strong>{activeRole.label}</strong>
            </div>
            <div className="notification-wrap" ref={notificationRef}>
              <button
                className="icon-button notification-button"
                type="button"
                title="Show notifications"
                aria-label="Show notifications"
                onClick={() => setNotificationsOpen((current) => !current)}
              >
                <Bell size={19} />
                {unread > 0 && <span aria-hidden="true">{unread}</span>}
              </button>
              {notificationsOpen && (
                <NotificationPanel
                  notifications={visibleNotifications}
                  onReadOne={(id) =>
                    runAction(() => actions.markNotificationRead(id), 'Notification marked as read.')
                  }
                  onMarkRead={() =>
                    runAction(actions.markNotificationsRead, 'Notifications marked as read.')
                  }
                />
              )}
            </div>
          </div>
        </header>

        <div className="user-strip">
          <span>{auth.user.name}</span>
          <strong>{auth.user.email}</strong>
          <span className="live-sync-badge">{liveSyncStatus}</span>
          <button
            type="button"
            onClick={() => setPasswordPanelOpen((current) => !current)}
          >
            Change password
          </button>
          <button
            type="button"
            onClick={() => {
              setAuth(null)
              setData(null)
              setStatus('Signed out. Please sign in to continue.')
            }}
          >
            Sign out
          </button>
        </div>
        {passwordPanelOpen && (
          <form
            className="password-panel"
            onSubmit={(event) => {
              event.preventDefault()
              runAction(async () => {
                await actions.changePassword(passwordForm)
                setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
                setPasswordPanelOpen(false)
              }, 'Password changed successfully. Use the new password from your next login.')
            }}
          >
            <input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(event) =>
                setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))
              }
              placeholder="Current password"
              autoComplete="current-password"
            />
            <input
              type="password"
              value={passwordForm.newPassword}
              onChange={(event) =>
                setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))
              }
              placeholder="New password"
              autoComplete="new-password"
            />
            <input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(event) =>
                setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))
              }
              placeholder="Confirm new password"
              autoComplete="new-password"
            />
            <button type="submit">Update password</button>
          </form>
        )}

        <div className="app-status">{status}</div>

        {safeActiveTab === 'dashboard' && (
          <Dashboard
            data={data}
            roleId={role}
            onExport={actions.exportDashboard}
            onPostAnnouncement={actions.postAnnouncement}
            onDeleteAnnouncement={actions.deleteAnnouncement}
            runAction={runAction}
            currentUser={auth.user}
            onNavigate={setActiveTab}
          />
        )}
        {safeActiveTab === 'people' && (
          <People
            employees={filteredEmployees}
            allEmployees={data.employees}
            managerProfiles={data.managerProfiles || []}
            documents={data.documents}
            onAdd={actions.addEmployee}
            actions={actions}
            runAction={runAction}
            activeDepartment={departmentFilter}
            onDepartmentSelect={setDepartmentFilter}
            canAddEmployee={role === 'recruiter' || role === 'admin'}
            currentUser={auth.user}
            role={role}
          />
        )}
        {safeActiveTab === 'attendance' && (
          <Attendance data={data} onSync={actions.syncAttendance} runAction={runAction} />
        )}
        {safeActiveTab === 'tasks' && (
          <Tasks
            data={data}
            currentUser={auth.user}
            role={role}
            actions={actions}
            runAction={runAction}
          />
        )}
        {safeActiveTab === 'leave' && (
          <Leave data={data} actions={actions} runAction={runAction} currentUser={auth.user} role={role} />
        )}
        {safeActiveTab === 'payroll' && (
          <Payroll data={data} actions={actions} role={role} runAction={runAction} />
        )}
        {safeActiveTab === 'recruitment' && (
          <Recruitment
            data={{ ...data, jobs: filteredJobs }}
            jobDescription={jobDescription}
            setJobDescription={setJobDescription}
            appliedJobId={appliedJobId}
            setAppliedJobId={setAppliedJobId}
            match={match}
            actions={actions}
            runAction={runAction}
            runCandidateMatch={runCandidateMatch}
            roleId={role}
          />
        )}
        {safeActiveTab === 'salary' && <SalaryCalculator />}
        {safeActiveTab === 'teamup' && (
          <TeamUp
            employees={data.employees}
            teams={data.teams || []}
            currentUser={auth.user}
            actions={actions}
            runAction={runAction}
          />
        )}
        {safeActiveTab === 'ai' && (
          <AiCenter
            query={query}
            setQuery={setQuery}
            chatAnswer={chatAnswer}
            data={data}
            match={match}
            actions={actions}
            runAction={runAction}
          />
        )}
      </main>
    </div>
  )
}

function pageTitle(tab) {
  const labels = {
    dashboard: 'Company Dashboard',
    people: 'Employee Profiles',
    tasks: 'Task Productivity',
    attendance: 'Attendance Intelligence',
    leave: 'Leave Approvals',
    payroll: 'Payroll & Salary Slips',
    recruitment: 'Recruitment Pipeline',
    salary: 'Salary Calculator',
    teamup: 'Team-up Communication',
    ai: 'AI Assistant Center',
  }
  return labels[tab]
}

function LoginScreen({ form, setForm, status, onSubmit }) {
  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand login-brand">
          <div className="brand-mark">
            <ShieldCheck size={24} />
          </div>
          <div>
            <strong>AI-HRMS</strong>
            <span>Secure company access</span>
          </div>
        </div>

        <form className="login-form" onSubmit={onSubmit}>
          <div>
            <p className="eyebrow">Sign in required</p>
            <h1>Login to HRMS</h1>
          </div>

          <label>
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              autoComplete="username"
            />
          </label>

          <label>
            <span>Password</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              autoComplete="current-password"
            />
          </label>

          <button className="primary-button" type="submit">
            Sign in
          </button>
          <p className="login-status">{status}</p>
        </form>
      </section>
    </main>
  )
}

function CandidateScreeningPortal({ shortlistId }) {
  const token = new URLSearchParams(window.location.search).get('token') || ''
  const [screening, setScreening] = useState(null)
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState('Opening screening invitation...')
  const [voiceStatus, setVoiceStatus] = useState('Voice answer ready.')

  useEffect(() => {
    api(`/api/public/screening/${shortlistId}?token=${encodeURIComponent(token)}`)
      .then((result) => {
        setScreening(result.screening)
        setStatus('Screening loaded. Please answer each question clearly.')
      })
      .catch((error) => setStatus(error.message || 'Screening link could not be opened.'))
  }, [shortlistId, token])

  function submitAnswer(event, mode = 'text', voiceText = '') {
    event.preventDefault()
    const text = String(voiceText || answer).trim()

    if (!text) {
      setStatus('Please enter an answer before submitting.')
      return
    }

    setStatus('Saving your answer...')
    api(`/api/public/screening/${shortlistId}/message?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      body: JSON.stringify({ text, mode, token }),
    })
      .then((result) => {
        setScreening(result.screening)
        setAnswer('')
        setStatus(result.screening.status === 'Completed'
          ? 'Screening completed. Thank you. HR will review your responses.'
          : 'Answer saved. Please continue with the next question.')
      })
      .catch((error) => setStatus(error.message || 'Could not save your answer.'))
  }

  function captureVoiceAnswer() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognition) {
      setVoiceStatus('Voice recognition is not supported in this browser. Please type your answer.')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-IN'
    recognition.interimResults = false
    recognition.continuous = false
    setVoiceStatus('Listening...')

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || '')
        .join(' ')
        .trim()

      if (!transcript) {
        setVoiceStatus('No voice answer captured.')
        return
      }

      setVoiceStatus(`Captured: ${transcript}`)
      submitAnswer({ preventDefault: () => {} }, 'voice', transcript)
    }

    recognition.onerror = () => {
      setVoiceStatus('Voice capture failed. Please try again or type your answer.')
    }

    recognition.start()
  }

  return (
    <main className="candidate-screening-page">
      <section className="candidate-screening-panel">
        <div className="brand login-brand">
          <div className="brand-mark">
            <Sparkles size={24} />
          </div>
          <div>
            <strong>AI-HRMS Screening</strong>
            <span>Candidate conversation</span>
          </div>
        </div>

        {screening && (
          <div className="candidate-screening-meta">
            <h1>{screening.role}</h1>
            <p>{screening.candidate}</p>
            <span>{screening.status} - {screening.currentQuestionIndex} of {screening.totalQuestions} answered</span>
          </div>
        )}

        <div className="screening-chat public">
          {(screening?.messages || []).map((message) => (
            <div
              className={message.sender === 'ai' ? 'screening-message ai' : 'screening-message candidate'}
              key={message.id}
            >
              <span>{message.sender === 'ai' ? 'AI question' : message.mode === 'voice' ? 'Your voice answer' : 'Your answer'}</span>
              <p>{message.text}</p>
              <small>{message.createdAt}</small>
            </div>
          ))}
        </div>

        {screening?.status !== 'Completed' && screening && (
          <form className="candidate-answer-form" onSubmit={submitAnswer}>
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Type your answer here"
            />
            <div className="row-actions">
              <button type="submit">Submit answer</button>
              <button type="button" onClick={captureVoiceAnswer}>
                <Mic size={16} />
                Voice answer
              </button>
            </div>
            <small>{voiceStatus}</small>
          </form>
        )}

        <p className="login-status">{status}</p>
        <div className="safety-note">
          <ShieldCheck size={18} />
          Your responses are shared with HR for human review. AI does not make final hiring decisions.
        </div>
      </section>
    </main>
  )
}

function DateTimeBadge() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="date-time-badge" aria-label="Current date and time">
      <strong>{formatTime12Hour(now)}</strong>
      <span>{formatDateDayMonthYear(now)}</span>
    </div>
  )
}

function formatTime12Hour(date) {
  let hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  const period = hours >= 12 ? 'PM' : 'AM'
  hours %= 12
  if (hours === 0) {
    hours = 12
  }

  return `${String(hours).padStart(2, '0')}:${minutes}:${seconds} ${period}`
}

function formatDateDayMonthYear(date) {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()

  return `${day}/${month}/${year}`
}

function NotificationPanel({ notifications, onMarkRead, onReadOne }) {
  return (
    <div className="notification-panel">
      <div className="notification-head">
        <h2>Notifications</h2>
        <button type="button" onClick={onMarkRead}>
          Mark all read
        </button>
      </div>
      <div className="notification-list">
        {notifications.length === 0 ? (
          <p className="muted">No notifications yet.</p>
        ) : (
          notifications.map((notification) => (
            <button
              type="button"
              className={notification.read ? 'notification-item' : 'notification-item unread'}
              key={notification.id}
              onClick={() => onReadOne(notification.id)}
            >
              <span />
              <p>{notification.text}</p>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function filterItems(items, term, keys) {
  if (!term.trim()) {
    return items
  }
  const normalized = term.toLowerCase()
  return items.filter((item) =>
    keys.some((key) => String(item[key] || '').toLowerCase().includes(normalized)),
  )
}

function isRecruitmentNotification(notification) {
  const text = String(notification.text || '').toLowerCase()
  return (
    notification.category === 'recruitment' ||
    text.includes('candidate') ||
    text.includes('shortlist') ||
    text.includes('screening') ||
    text.includes('interview') ||
    text.includes('role listed')
  )
}

function visibleNotificationsForRole(notifications, role) {
  return notifications.filter((notification) => {
    if (Array.isArray(notification.roles) && notification.roles.length) {
      return notification.roles.includes(role)
    }

    if (isRecruitmentNotification(notification)) {
      return ['admin', 'manager', 'recruiter'].includes(role)
    }

    return true
  })
}

function Dashboard({ data, roleId, onExport, onPostAnnouncement, onDeleteAnnouncement, runAction, currentUser, onNavigate }) {
  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    text: '',
  })
  const [selectedEmployee, setSelectedEmployee] = useState(currentUser.name)
  const canPostAnnouncement = roleId === 'admin'
  const canViewCompanyAnalytics = ['admin', 'manager', 'recruiter'].includes(roleId)
  const dashboards = data.dashboards || { employees: [], company: {} }
  const ownDashboard = dashboards.employees?.find((item) =>
    item.employee === currentUser.name ||
    data.employees.find((employee) => employee.name === item.employee)?.workEmail === currentUser.email,
  )
  const selectedDashboard = dashboards.employees?.find((item) => item.employee === selectedEmployee) || dashboards.employees?.[0]

  function submitAnnouncement(event) {
    event.preventDefault()
    runAction(async () => {
      await onPostAnnouncement(announcementForm)
      setAnnouncementForm({ title: '', text: '' })
    }, 'Announcement posted for employees.')
  }

  return (
    <section className="content-grid">
      <div className="metric-strip">
        {(canViewCompanyAnalytics ? data.metrics : personalDashboardMetrics(ownDashboard)).map((metric) => (
          <Metric
            key={metric.id}
            icon={metricIcons[metric.id] || Gauge}
            label={metric.label}
            value={metric.value}
            detail={metric.detail}
          />
        ))}
      </div>

      {ownDashboard && (
        <PersonalDashboard dashboard={ownDashboard} />
      )}

      {canViewCompanyAnalytics && (
        <CompanyActivityDashboard
          dashboards={dashboards}
          canViewIndividuals={roleId === 'admin'}
          selectedEmployee={selectedEmployee}
          onSelectEmployee={setSelectedEmployee}
          selectedDashboard={selectedDashboard}
        />
      )}

      {canViewCompanyAnalytics && (
        <Panel className="wide" title="Company performance analytics" action="Export" onAction={onExport}>
          <div className="chart-note">
            <span>Blue: company score trend</span>
            <span>Orange: productivity trend</span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.performance}>
                <defs>
                  <linearGradient id="score" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#146c94" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#146c94" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" />
                <YAxis domain={[60, 100]} />
                <Tooltip />
                <Area dataKey="score" stroke="#146c94" fill="url(#score)" strokeWidth={3} />
                <Line dataKey="productivity" stroke="#c24f33" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      <Panel title="Announcements">
        {canPostAnnouncement && (
          <form className="announcement-form" onSubmit={submitAnnouncement}>
            <input
              value={announcementForm.title}
              onChange={(event) =>
                setAnnouncementForm((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="Announcement title"
            />
            <textarea
              value={announcementForm.text}
              onChange={(event) =>
                setAnnouncementForm((current) => ({ ...current, text: event.target.value }))
              }
              placeholder="Message to employees"
            />
            <button type="submit">Post announcement</button>
          </form>
        )}
        <div className="stack-list">
          {data.announcements.map((item) => (
            <div className="announcement-row" key={item.id}>
              <InfoRow title={item.title} text={item.text} />
              {canPostAnnouncement && (
                <button
                  type="button"
                  className="danger-button"
                  onClick={() =>
                    runAction(
                      () => onDeleteAnnouncement(item.id),
                      'Announcement deleted by management admin.',
                    )
                  }
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      </Panel>

      {canViewCompanyAnalytics && data.insights.length > 0 && (
        <Panel title="AI insights">
          {data.insights.map((insight, index) => (
            <InsightCard insight={insight} index={index} key={insight.id || insight.title || insight} />
          ))}
        </Panel>
      )}

      {roleId === 'manager' && (
        <ManagerTasks data={data} currentUser={currentUser} onNavigate={onNavigate} />
      )}
    </section>
  )
}

function personalDashboardMetrics(dashboard) {
  if (!dashboard) {
    return [
      { id: 'attendance', label: 'Attendance', value: '0%', detail: 'No employee profile linked' },
      { id: 'tasks', label: 'Tasks', value: '0', detail: 'No assigned tasks' },
      { id: 'performance', label: 'Productivity', value: '0%', detail: 'No task data yet' },
      { id: 'leave', label: 'Leave balance', value: '0', detail: 'No leave profile linked' },
    ]
  }

  return [
    { id: 'attendance', label: 'Attendance', value: `${dashboard.attendance}%`, detail: dashboard.status },
    { id: 'tasks', label: 'My tasks', value: String(dashboard.tasks.total), detail: `${dashboard.tasks.pending} pending` },
    { id: 'performance', label: 'Productivity', value: `${dashboard.productivity.score}%`, detail: 'From task activity' },
    { id: 'leave', label: 'Leave balance', value: String(dashboard.leaveBalance), detail: `${dashboard.leaves.pending} pending requests` },
  ]
}

function PersonalDashboard({ dashboard }) {
  return (
    <Panel className="wide" title="My activity dashboard">
      <div className="activity-summary-grid">
        <InfoRow title="Profile" text={`${dashboard.employeeCode} - ${dashboard.role} - ${dashboard.department}`} />
        <InfoRow title="Manager" text={dashboard.manager || 'Not assigned'} />
        <InfoRow title="Performance" text={`${dashboard.performance || 0}/100 current review score`} />
        <InfoRow title="Productivity formula" text={`${dashboard.productivity.score}% from completion, on-time delivery, quality, and attendance`} />
      </div>
      <div className="activity-columns">
        <div>
          <h3>Recent tasks</h3>
          <div className="stack-list">
            {dashboard.tasks.recent.length ? dashboard.tasks.recent.map((task) => (
              <InfoRow
                key={task.id}
                title={task.title}
                text={`${task.status} - Due ${task.dueDate || 'not set'} - Quality ${task.qualityScore || 0}/100`}
              />
            )) : <p className="muted">No tasks assigned yet.</p>}
          </div>
        </div>
        <div>
          <h3>Leave activity</h3>
          <div className="stack-list">
            {dashboard.leaves.recent.length ? dashboard.leaves.recent.map((leave) => (
              <InfoRow
                key={leave.id}
                title={leave.type}
                text={`${leave.dates} - ${leave.status}`}
              />
            )) : <p className="muted">No leave requests yet.</p>}
          </div>
        </div>
      </div>
    </Panel>
  )
}

function CompanyActivityDashboard({ dashboards, canViewIndividuals, selectedEmployee, onSelectEmployee, selectedDashboard }) {
  const company = dashboards.company || {}

  return (
    <Panel className="wide" title="Company activity analytics">
      <div className="activity-summary-grid">
        <Metric icon={UsersRound} label="Active employees" value={String(company.activeEmployees || 0)} detail="Company-wide status" />
        <Metric icon={ClipboardCheck} label="Company tasks" value={String(company.totalTasks || 0)} detail={`${company.completedTasks || 0} completed`} />
        <Metric icon={Gauge} label="Productivity" value={`${company.productivity?.average || 0}%`} detail="Company task average" />
        <Metric icon={CalendarCheck} label="Pending leaves" value={String(company.pendingLeaves || 0)} detail="Needs approval" />
      </div>
      {canViewIndividuals && (
        <>
          <label className="activity-selector">
            <span>View individual dashboard</span>
            <select value={selectedEmployee || ''} onChange={(event) => onSelectEmployee(event.target.value)}>
              {(dashboards.employees || []).map((employee) => (
                <option value={employee.employee} key={employee.employeeCode || employee.employee}>
                  {employee.employee} - {employee.department}
                </option>
              ))}
            </select>
          </label>
          {selectedDashboard && <PersonalDashboard dashboard={selectedDashboard} />}
        </>
      )}
    </Panel>
  )
}

function managerTeamEmployees(employees, currentUser) {
  const exactTeam = employees.filter((employee) =>
    employee.manager === currentUser.name ||
    employee.managerEmail === currentUser.email,
  )

  return exactTeam.length ? exactTeam : employees
}

function ManagerTasks({ data, currentUser, onNavigate }) {
  const team = managerTeamEmployees(data.employees, currentUser)
  const teamNames = new Set(team.map((employee) => employee.name))
  const pendingLeaves = data.leaveRequests.filter((request) =>
    request.status === 'Pending' && teamNames.has(request.person),
  )
  const reviewsDue = team.filter((employee) =>
    !employee.performance ||
    employee.performanceDetails?.rating === 'Not reviewed' ||
    employee.performanceDetails?.reviewCycle === 'First review pending',
  )
  const attendanceWatch = team.filter((employee) => Number(employee.attendance || 0) < 90)
  const teamAveragePerformance = team.length
    ? Math.round(team.reduce((sum, employee) => sum + Number(employee.performance || 0), 0) / team.length)
    : 0

  return (
    <Panel className="wide" title="Manager tasks">
      <div className="manager-task-grid">
        <Metric icon={UsersRound} label="My team" value={String(team.length)} detail="Employees assigned to this manager" />
        <Metric icon={ClipboardCheck} label="Pending leave" value={String(pendingLeaves.length)} detail="Requests waiting for action" />
        <Metric icon={Gauge} label="Reviews due" value={String(reviewsDue.length)} detail="Performance reviews to submit" />
        <Metric icon={CalendarCheck} label="Attendance watch" value={String(attendanceWatch.length)} detail="Team members below 90%" />
      </div>
      <div className="manager-task-actions">
        <button type="button" onClick={() => onNavigate('leave')}>Approve leave</button>
        <button type="button" onClick={() => onNavigate('people')}>Review employees</button>
        <button type="button" onClick={() => onNavigate('attendance')}>Check attendance</button>
        <button type="button" onClick={() => onNavigate('teamup')}>Message team</button>
      </div>
      <div className="manager-task-list">
        <InfoRow
          title="Team performance"
          text={`Average score ${teamAveragePerformance}. ${reviewsDue.length} review${reviewsDue.length === 1 ? '' : 's'} need manager input.`}
        />
        <InfoRow
          title="Immediate approvals"
          text={pendingLeaves.length
            ? `${pendingLeaves.map((request) => `${request.person} - ${request.type}`).join(', ')}`
            : 'No team leave requests are pending.'}
        />
        <InfoRow
          title="Attention required"
          text={attendanceWatch.length
            ? `${attendanceWatch.map((employee) => `${employee.name} attendance ${employee.attendance}%`).join(', ')}`
            : 'No attendance risk under this manager right now.'}
        />
      </div>
    </Panel>
  )
}

function InsightCard({ insight, index }) {
  if (typeof insight === 'string') {
    return (
      <div className={index === 0 ? 'insight-card' : 'insight-card warm'}>
        {index === 0 ? <Sparkles size={20} /> : <Gauge size={20} />}
        <p>{insight}</p>
      </div>
    )
  }

  return (
    <article className={index === 0 ? 'insight-card' : 'insight-card warm'}>
      {index === 0 ? <Sparkles size={20} /> : <Gauge size={20} />}
      <div className="insight-detail">
        <div className="insight-meta">
          <span>{insight.scopeType}: {insight.scopeName}</span>
          <span>{insight.severity}</span>
        </div>
        <h3>{insight.title}</h3>
        <p>{insight.signal}</p>
        <dl>
          <div>
            <dt>Attention point</dt>
            <dd>{insight.attentionPoint}</dd>
          </div>
          <div>
            <dt>Suggested action</dt>
            <dd>{insight.recommendedAction}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{insight.owner}</dd>
          </div>
        </dl>
      </div>
    </article>
  )
}

function People({
  employees,
  allEmployees,
  managerProfiles,
  documents,
  onAdd,
  actions,
  runAction,
  activeDepartment,
  onDepartmentSelect,
  canAddEmployee,
  currentUser,
  role,
}) {
  const [employeeForm, setEmployeeForm] = useState({
    name: '',
    workEmail: '',
    role: '',
    department: 'HR',
    manager: '',
    managerEmail: '',
    managerProfileId: '',
    ctc: '',
    cabChargesMonthly: '',
    createLogin: true,
    accessRole: 'employee',
    temporaryPassword: '',
  })
  const departments = departmentCounts(allEmployees)
  const managerOptions = managerProfiles.length
    ? managerProfiles
    : Array.from(new Set(allEmployees.map((employee) => employee.manager).filter(Boolean)))
      .map((name) => ({ name, email: '', id: '' }))
  const [documentForm, setDocumentForm] = useState({
    title: '',
    category: 'Policy',
    file: null,
  })
  const [reviewForms, setReviewForms] = useState({})
  const canReviewEmployees = role === 'manager' || role === 'admin'
  const managerHasExactReports = allEmployees.some((employee) =>
    employee.manager === currentUser.name ||
    employee.managerEmail === currentUser.email,
  )

  function submitEmployee(event) {
    event.preventDefault()
    runAction(async () => {
      const result = await onAdd(employeeForm)
      setEmployeeForm({
        name: '',
        workEmail: '',
        role: '',
        department: 'HR',
        manager: '',
        managerEmail: '',
        managerProfileId: '',
        ctc: '',
        cabChargesMonthly: '',
        createLogin: true,
        accessRole: 'employee',
        temporaryPassword: '',
      })
      return result
    }, employeeForm.createLogin ? 'Employee added and login access created.' : 'Employee added with recruiter-provided details.')
  }

  function submitDocument(event) {
    event.preventDefault()
    runAction(async () => {
      await actions.uploadDocument(documentForm)
      setDocumentForm({ title: '', category: 'Policy', file: null })
      event.target.reset()
    }, 'Document uploaded and added to the manager document list.')
  }

  function updateReviewForm(employeeId, field, value) {
    setReviewForms((current) => ({
      ...current,
      [employeeId]: {
        ...(current[employeeId] || {}),
        [field]: value,
      },
    }))
  }

  function submitReview(event, employee) {
    event.preventDefault()
    const form = reviewForms[employee.id] || {}

    runAction(async () => {
      await actions.reviewEmployee(employee.id, form)
      setReviewForms((current) => ({
        ...current,
        [employee.id]: {
          score: '',
          rating: '',
          focusArea: '',
          achievements: '',
          improvementPlan: '',
          cycle: '',
        },
      }))
    }, `Performance review submitted for ${employee.name}.`)
  }

  function canReviewEmployee(employee) {
    if (role === 'admin') {
      return true
    }

    if (role !== 'manager') {
      return false
    }

    return employee.manager === currentUser.name || employee.managerEmail === currentUser.email || !managerHasExactReports
  }

  return (
    <section className="people-layout">
      <Panel title="Employee directory">
        {canAddEmployee && (
          <form className="employee-form" onSubmit={submitEmployee}>
            <input
              value={employeeForm.name}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Employee name"
            />
            <input
              type="email"
              value={employeeForm.workEmail}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, workEmail: event.target.value }))}
              placeholder="Work email"
            />
            <input
              value={employeeForm.role}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, role: event.target.value }))}
              placeholder="Job role"
            />
            <select
              value={employeeForm.department}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, department: event.target.value }))}
            >
              <option value="HR">HR</option>
              <option value="Product">Product</option>
              <option value="Revenue">Revenue</option>
              <option value="Analytics">Analytics</option>
            </select>
            <select
              value={employeeForm.managerProfileId || employeeForm.manager}
              onChange={(event) => {
                const selected = managerOptions.find((manager) =>
                  (manager.id || manager.name) === event.target.value,
                )
                setEmployeeForm((current) => ({
                  ...current,
                  manager: selected?.name || event.target.value,
                  managerEmail: selected?.email || '',
                  managerProfileId: selected?.id || '',
                }))
              }}
            >
              <option value="">Select manager</option>
              {managerOptions.map((manager) => (
                <option value={manager.id || manager.name} key={manager.id || manager.name}>
                  {manager.name}{manager.email ? ` - ${manager.email}` : ''}
                </option>
              ))}
            </select>
            <input
              value={employeeForm.ctc}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, ctc: event.target.value }))}
              placeholder="Annual CTC"
              type="number"
            />
            <input
              value={employeeForm.cabChargesMonthly}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, cabChargesMonthly: event.target.value }))}
              placeholder="Cab charges monthly"
              type="number"
            />
            <label className="employee-login-toggle">
              <input
                type="checkbox"
                checked={employeeForm.createLogin}
                onChange={(event) =>
                  setEmployeeForm((current) => ({ ...current, createLogin: event.target.checked }))
                }
              />
              <span>Create login access</span>
            </label>
            {employeeForm.createLogin && (
              <>
                <select
                  value={employeeForm.accessRole}
                  onChange={(event) =>
                    setEmployeeForm((current) => ({ ...current, accessRole: event.target.value }))
                  }
                >
                  <option value="employee">Employee login</option>
                  <option value="recruiter">HR Recruiter login</option>
                  <option value="manager">Senior Manager login</option>
                  <option value="admin">Management Admin login</option>
                </select>
                <input
                  type="password"
                  value={employeeForm.temporaryPassword}
                  onChange={(event) =>
                    setEmployeeForm((current) => ({ ...current, temporaryPassword: event.target.value }))
                  }
                  placeholder="Temporary password"
                  autoComplete="new-password"
                />
              </>
            )}
            <button type="submit">Add employee</button>
          </form>
        )}
        <div className="department-strip" aria-label="Department filters">
          <button
            className={activeDepartment === 'All' ? 'department-filter active' : 'department-filter'}
            type="button"
            onClick={() => onDepartmentSelect('All')}
          >
            All departments
          </button>
          {departments.map((department) => (
            <button
              className={activeDepartment === department.name ? 'department-tile active' : 'department-tile'}
              key={department.name}
              type="button"
              onClick={() => onDepartmentSelect(department.name)}
            >
              <UsersRound size={18} />
              <strong>{department.name}</strong>
              <span>{department.count} employees</span>
            </button>
          ))}
        </div>
        <div className={`table-wrap employee-directory-table ${canReviewEmployees ? 'has-review-column' : ''}`}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Department</th>
                <th>Manager</th>
                <th>Salary structure</th>
                <th>Attendance</th>
                <th>Performance</th>
                <th>Status</th>
                {canReviewEmployees && <th>Review</th>}
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.id}>
                  <td>
                    <div className="person-cell">
                      <div className="avatar">{employee.name.slice(0, 1)}</div>
                      <div className="person-meta">
                        <strong>{employee.name}</strong>
                        <span>{employee.role}</span>
                        <div className="employee-badge-row">
                          <small className="employee-id-tag">Employee ID {employee.employeeCode || employee.id}</small>
                          {employee.loginAccess?.enabled && (
                            <small className="employee-id-tag">Login {employee.loginAccess.role}</small>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{employee.department}</td>
                  <td>{employee.manager}</td>
                  <td>
                    <SalaryStructure employee={employee} />
                  </td>
                  <td>{employee.attendance}%</td>
                  <td>
                    <PerformanceDetails employee={employee} />
                  </td>
                  <td>
                    <span className={employee.status === 'Active' ? 'pill good' : 'pill'}>
                      {employee.status}
                    </span>
                  </td>
                  {canReviewEmployees && (
                    <td>
                      {canReviewEmployee(employee) ? (
                        <form className="review-form" onSubmit={(event) => submitReview(event, employee)}>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={reviewForms[employee.id]?.score || ''}
                            onChange={(event) => updateReviewForm(employee.id, 'score', event.target.value)}
                            placeholder="Score"
                            required
                          />
                          <select
                            value={reviewForms[employee.id]?.rating || ''}
                            onChange={(event) => updateReviewForm(employee.id, 'rating', event.target.value)}
                            required
                          >
                            <option value="">Rating</option>
                            <option value="Exceeds expectations">Exceeds expectations</option>
                            <option value="Meets expectations">Meets expectations</option>
                            <option value="Needs improvement">Needs improvement</option>
                            <option value="New hire review">New hire review</option>
                          </select>
                          <input
                            value={reviewForms[employee.id]?.focusArea || ''}
                            onChange={(event) => updateReviewForm(employee.id, 'focusArea', event.target.value)}
                            placeholder="Focus area"
                            required
                          />
                          <input
                            value={reviewForms[employee.id]?.achievements || ''}
                            onChange={(event) => updateReviewForm(employee.id, 'achievements', event.target.value)}
                            placeholder="Achievements"
                          />
                          <input
                            value={reviewForms[employee.id]?.improvementPlan || ''}
                            onChange={(event) => updateReviewForm(employee.id, 'improvementPlan', event.target.value)}
                            placeholder="Improvement plan"
                          />
                          <input
                            value={reviewForms[employee.id]?.cycle || ''}
                            onChange={(event) => updateReviewForm(employee.id, 'cycle', event.target.value)}
                            placeholder="Review cycle"
                          />
                          <button type="submit">Submit review</button>
                        </form>
                      ) : (
                        <span className="muted">Assigned manager only</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Documents">
        <form className="document-form" onSubmit={submitDocument}>
          <input
            value={documentForm.title}
            onChange={(event) => setDocumentForm((current) => ({ ...current, title: event.target.value }))}
            placeholder="Document title"
          />
          <select
            value={documentForm.category}
            onChange={(event) => setDocumentForm((current) => ({ ...current, category: event.target.value }))}
          >
            <option value="Policy">Policy</option>
            <option value="Hiring">Hiring</option>
            <option value="Compliance">Compliance</option>
            <option value="Performance">Performance</option>
          </select>
          <input
            type="file"
            onChange={(event) => setDocumentForm((current) => ({ ...current, file: event.target.files?.[0] || null }))}
          />
          <button type="submit">Upload document</button>
        </form>
        <div className="stack-list">
          {documents.map((document) => (
            <div className="document-row" key={document.id}>
              <InfoRow
                title={document.title}
                text={`${document.category || 'General'} - ${document.text} - ${document.acknowledgedBy?.length || 0} acknowledged`}
              />
              <div className="row-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => window.open(`/api/documents/${document.id}/download`, '_blank')}
                >
                  Download
                </button>
                <button
                  type="button"
                  onClick={() =>
                    runAction(
                      () => actions.acknowledgeDocument(document.id),
                      'Document acknowledged.',
                    )
                  }
                  disabled={document.acknowledgedBy?.includes(currentUser.name)}
                >
                  {document.acknowledgedBy?.includes(currentUser.name) ? 'Acknowledged' : 'Acknowledge'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  )
}

function departmentCounts(employees) {
  const counts = employees.reduce((accumulator, employee) => {
    accumulator[employee.department] = (accumulator[employee.department] || 0) + 1
    return accumulator
  }, {})

  return Object.entries(counts).map(([name, count]) => ({ name, count }))
}

function SalaryStructure({ employee }) {
  const details = employee.salaryDetails || {
    annualCtc: employee.ctc || employee.salary * 12,
    monthlyGross: employee.salary,
    monthlyDeductions: 0,
    monthlyTakeHome: employee.salary,
    basicAnnual: employee.salary * 12 * 0.4,
    hraAnnual: employee.salary * 12 * 0.16,
    specialAllowanceAnnual: employee.salary * 12 * 0.44,
    employeePfAnnual: 0,
  }

  return (
    <div className="salary-structure">
      <strong>CTC {formatCurrency(details.annualCtc)}</strong>
      <span>Gross {formatCurrency(details.monthlyGross)} / month</span>
      <span>Take-home {formatCurrency(details.monthlyTakeHome)} / month</span>
      <small>
        Basic {formatCurrency(Math.round(details.basicAnnual / 12))} - HRA {formatCurrency(Math.round(details.hraAnnual / 12))} - PF {formatCurrency(Math.round(details.employeePfAnnual / 12))} - Cab {formatCurrency(details.monthlyCabCharges || 0)} - Deductions {formatCurrency(details.monthlyDeductions)}
      </small>
    </div>
  )
}

function PerformanceDetails({ employee }) {
  const details = employee.performanceDetails || {
    rating: employee.performance > 0 ? 'Performance recorded' : 'Not reviewed',
    reviewCycle: employee.performance > 0 ? 'Current cycle' : 'First review pending',
    focusArea: employee.performance > 0 ? 'Manager feedback available' : 'Onboarding goals to be assigned',
  }

  return (
    <div className="performance-detail">
      <strong>{employee.performance || 0}</strong>
      <span>{details.rating}</span>
      <small>{details.reviewCycle}</small>
      <small>{details.focusArea}</small>
      {details.achievements && <small>Wins: {details.achievements}</small>}
      {details.improvementPlan && <small>Plan: {details.improvementPlan}</small>}
      {details.reviewedBy && <small>By {details.reviewedBy} on {details.reviewedAt}</small>}
    </div>
  )
}

function statusPillClass(status) {
  if (status === 'Approved') {
    return 'pill good'
  }
  if (status === 'Cancelled' || status === 'Rejected') {
    return 'pill danger'
  }
  if (status === 'Withdrawn') {
    return 'pill neutral'
  }
  return 'pill pending'
}

function Tasks({ data, currentUser, role, actions, runAction }) {
  const canAssignTasks = ['admin', 'manager'].includes(role)
  const [taskForm, setTaskForm] = useState({
    title: '',
    assignedTo: data.employees[0]?.name || '',
    priority: 'Medium',
    dueDate: '',
    estimatedHours: '',
    description: '',
  })
  const [taskUpdates, setTaskUpdates] = useState({})
  const [qualityScores, setQualityScores] = useState({})
  const managedEmployees = data.employees.filter((employee) =>
    role === 'admin' ||
    employee.manager === currentUser.name ||
    employee.managerEmail === currentUser.email ||
    employee.name === currentUser.name,
  )
  const visibleTasks = (data.tasks || []).filter((task) =>
    role === 'admin' ||
    task.assignedTo === currentUser.name ||
    task.assignedBy === currentUser.name ||
    managedEmployees.some((employee) => employee.name === task.assignedTo),
  )
  const productivity = data.productivity || { average: 0, employees: [], formula: '' }

  function updateTaskForm(field, value) {
    setTaskForm((current) => ({ ...current, [field]: value }))
  }

  function taskDraft(id) {
    return taskUpdates[id] || {}
  }

  function updateTaskDraft(id, field, value) {
    setTaskUpdates((current) => ({
      ...current,
      [id]: {
        ...(current[id] || {}),
        [field]: value,
      },
    }))
  }

  function submitTask(event) {
    event.preventDefault()
    runAction(async () => {
      await actions.assignTask(taskForm)
      setTaskForm({
        title: '',
        assignedTo: managedEmployees[0]?.name || data.employees[0]?.name || '',
        priority: 'Medium',
        dueDate: '',
        estimatedHours: '',
        description: '',
      })
    }, 'Task assigned and productivity will recalculate automatically.')
  }

  return (
    <section className="content-grid">
      <div className="metric-strip">
        <Metric icon={Gauge} label="Productivity" value={`${productivity.average || 0}%`} detail="Calculated from employee tasks" />
        <Metric icon={ClipboardCheck} label="Tracked tasks" value={String((data.tasks || []).length)} detail="Supabase-backed task records" />
        <Metric icon={Check} label="Completed" value={String((data.tasks || []).filter((task) => task.status === 'Completed').length)} detail="Used in completion score" />
        <Metric icon={CalendarCheck} label="On-time" value={`${productivity.employees?.length ? Math.round(productivity.employees.reduce((sum, item) => sum + item.onTime, 0) / productivity.employees.length) : 0}%`} detail="Completed before due date" />
      </div>

      <Panel className="wide" title="Task tracker">
        {canAssignTasks && (
          <form className="task-form" onSubmit={submitTask}>
            <input
              value={taskForm.title}
              onChange={(event) => updateTaskForm('title', event.target.value)}
              placeholder="Task title"
              required
            />
            <select
              value={taskForm.assignedTo}
              onChange={(event) => updateTaskForm('assignedTo', event.target.value)}
              required
            >
              <option value="">Assign employee</option>
              {managedEmployees.map((employee) => (
                <option value={employee.name} key={employee.id}>
                  {employee.name} - {employee.department}
                </option>
              ))}
            </select>
            <select value={taskForm.priority} onChange={(event) => updateTaskForm('priority', event.target.value)}>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Critical">Critical</option>
            </select>
            <input
              type="date"
              value={taskForm.dueDate}
              onChange={(event) => updateTaskForm('dueDate', event.target.value)}
              required
            />
            <input
              type="number"
              min="0"
              value={taskForm.estimatedHours}
              onChange={(event) => updateTaskForm('estimatedHours', event.target.value)}
              placeholder="Estimated hours"
            />
            <input
              value={taskForm.description}
              onChange={(event) => updateTaskForm('description', event.target.value)}
              placeholder="Task description"
            />
            <button type="submit">Assign task</button>
          </form>
        )}

        <div className="task-list">
          {visibleTasks.map((task) => (
            <article className="task-card" key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <span>{task.assignedTo} - {task.department}</span>
                <small>Assigned by {task.assignedBy} - Due {task.dueDate || 'Not set'} - Priority {task.priority}</small>
                {task.description && <p>{task.description}</p>}
                {task.reviewedBy && <small>Quality {task.qualityScore}/100 reviewed by {task.reviewedBy} on {task.reviewedAt}</small>}
              </div>
              <div className="task-actions">
                <span className={task.status === 'Completed' ? 'pill good' : task.status === 'Blocked' || task.status === 'Delayed' ? 'pill danger' : 'pill pending'}>
                  {task.status}
                </span>
                <select
                  value={taskDraft(task.id).status || task.status}
                  onChange={(event) => updateTaskDraft(task.id, 'status', event.target.value)}
                >
                  <option value="Pending">Pending</option>
                  <option value="In progress">In progress</option>
                  <option value="Completed">Completed</option>
                  <option value="Delayed">Delayed</option>
                  <option value="Blocked">Blocked</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
                <input
                  type="number"
                  min="0"
                  value={taskDraft(task.id).actualHours ?? task.actualHours ?? ''}
                  onChange={(event) => updateTaskDraft(task.id, 'actualHours', event.target.value)}
                  placeholder="Actual hours"
                />
                <button
                  type="button"
                  onClick={() => runAction(
                    () => actions.updateTask(task.id, taskDraft(task.id)),
                    'Task updated and productivity recalculated.',
                  )}
                >
                  Update
                </button>
                {canAssignTasks && task.status === 'Completed' && (
                  <>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={qualityScores[task.id] ?? task.qualityScore ?? ''}
                      onChange={(event) => setQualityScores((current) => ({ ...current, [task.id]: event.target.value }))}
                      placeholder="Quality score"
                    />
                    <button
                      type="button"
                      onClick={() => runAction(
                        () => actions.reviewTask(task.id, { qualityScore: qualityScores[task.id] ?? task.qualityScore }),
                        'Task quality reviewed and productivity recalculated.',
                      )}
                    >
                      Review quality
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
          {visibleTasks.length === 0 && <p className="muted">No tasks are assigned for this login yet.</p>}
        </div>
      </Panel>

      <Panel title="Productivity formula">
        <p className="muted">{productivity.formula}</p>
        <div className="stack-list">
          {(productivity.employees || []).map((employee) => (
            <div className="productivity-card" key={employee.employeeCode || employee.employee}>
              <strong>{employee.employee}</strong>
              <span>{employee.department} - {employee.taskCount} tasks - Final {employee.score}%</span>
              <Progress label="Completion" value={employee.completion} max={100} />
              <Progress label="On-time" value={employee.onTime} max={100} />
              <Progress label="Quality" value={employee.quality} max={100} />
              <Progress label="Attendance" value={employee.attendance} max={100} />
            </div>
          ))}
        </div>
      </Panel>
    </section>
  )
}

function Attendance({ data, onSync, runAction }) {
  const today = data.attendance[data.attendance.length - 1]

  return (
    <section className="content-grid">
      <Panel
        className="wide"
        title="Weekly attendance"
        action="Sync devices"
        onAction={() => runAction(onSync, 'Attendance synced from backend devices endpoint.')}
      >
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.attendance}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="present" fill="#146c94" radius={[5, 5, 0, 0]} />
              <Bar dataKey="late" fill="#c24f33" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="Pattern alerts">
        <div className="stack-list">
          {data.insights.map((insight) => (
            <InfoRow
              key={insight.id || insight.title || insight}
              title={
                typeof insight === 'string'
                  ? 'AI attendance insight'
                  : `${insight.scopeType}: ${insight.scopeName}`
              }
              text={
                typeof insight === 'string'
                  ? insight
                  : `${insight.title}. Attention: ${insight.attentionPoint}`
              }
            />
          ))}
        </div>
      </Panel>

      <Panel title="Today">
        <div className="metric-list">
          <Metric icon={Check} label="Present" value={String(today.present)} detail="Live synced workforce" />
          <Metric icon={CalendarCheck} label="Late" value={String(today.late)} detail="Needs manager review" />
        </div>
      </Panel>
    </section>
  )
}

function Leave({ data, actions, runAction, currentUser, role }) {
  const canApproveLeave = ['admin', 'manager'].includes(role)
  const today = new Date().toISOString().slice(0, 10)
  const [leaveForm, setLeaveForm] = useState({
    startDate: today,
    endDate: today,
    type: 'Leave',
    specialCategory: '',
  })
  const currentEmployee = data.employees.find((employee) => employee.name === currentUser.name) || data.employees[0] || {}
  const allocation = currentEmployee.leaveAllocation || {
    casual: 6,
    sick: 4,
    earned: 6,
    special: {
      maternity: 182,
      paternity: 15,
      bereavement: 5,
      medicalEmergency: 10,
      marriage: 5,
    },
  }
  const allocatedLeaveDays = Number(allocation.casual || 0) + Number(allocation.sick || 0) + Number(allocation.earned || 0)
  const visibleLeaveRequests = useMemo(() => {
    if (role === 'admin') {
      return data.leaveRequests
    }

    if (role === 'manager') {
      const teamNames = new Set(
        data.employees
          .filter((employee) =>
            employee.manager === currentUser.name ||
            employee.managerEmail === currentUser.email ||
            employee.name === currentUser.name,
          )
          .map((employee) => employee.name),
      )
      return data.leaveRequests.filter((request) => teamNames.has(request.person))
    }

    return data.leaveRequests.filter((request) => request.person === currentUser.name)
  }, [currentUser.email, currentUser.name, data.employees, data.leaveRequests, role])
  const balances = useMemo(() => {
    return [
      { label: 'Casual', value: allocation.casual, max: allocatedLeaveDays || 1 },
      { label: 'Sick', value: allocation.sick, max: allocatedLeaveDays || 1 },
      { label: 'Earned', value: allocation.earned, max: allocatedLeaveDays || 1 },
    ]
  }, [allocatedLeaveDays, allocation.casual, allocation.earned, allocation.sick])

  function submitLeave(event) {
    event.preventDefault()
    runAction(async () => {
      await actions.createLeave({
        ...leaveForm,
        requestedOn: new Date().toISOString().slice(0, 10),
      })
      setLeaveForm({
        startDate: today,
        endDate: today,
        type: 'Leave',
        specialCategory: '',
      })
    }, 'Leave request created in backend.')
  }

  return (
    <section className="content-grid">
      <Panel className="wide" title="Leave requests">
        <form className="leave-form" onSubmit={submitLeave}>
          <label>
            <span>Request date</span>
            <input type="text" value={formatDateDayMonthYear(new Date())} readOnly />
          </label>
          <label>
            <span>Start date</span>
            <input
              type="date"
              value={leaveForm.startDate}
              onChange={(event) => setLeaveForm((current) => ({ ...current, startDate: event.target.value }))}
            />
          </label>
          <label>
            <span>End date</span>
            <input
              type="date"
              value={leaveForm.endDate}
              onChange={(event) => setLeaveForm((current) => ({ ...current, endDate: event.target.value }))}
            />
          </label>
          <label>
            <span>Request type</span>
            <select
              value={leaveForm.type}
              onChange={(event) => setLeaveForm((current) => ({ ...current, type: event.target.value }))}
            >
              <option value="Leave">Leave</option>
              <option value="Work from home">Work from home</option>
              <option value="Special leave">Special leave</option>
            </select>
          </label>
          {leaveForm.type === 'Special leave' && (
            <label>
              <span>Special case</span>
              <select
                value={leaveForm.specialCategory}
                onChange={(event) => setLeaveForm((current) => ({ ...current, specialCategory: event.target.value }))}
              >
                <option value="">Select special case</option>
                <option value="Maternity">Maternity</option>
                <option value="Paternity">Paternity</option>
                <option value="Bereavement">Bereavement</option>
                <option value="Medical emergency">Medical emergency</option>
                <option value="Marriage">Marriage</option>
              </select>
            </label>
          )}
          <button type="submit">Create request</button>
        </form>
        <div className="request-list">
          {visibleLeaveRequests.map((request) => (
            <div className="request-row" key={request.id}>
              <div>
                <strong>{request.person}</strong>
                <span>
                  {request.type} - {request.dates}
                </span>
                {request.requestedOn && <small>Requested on {request.requestedOn}</small>}
                {request.approver && <small>Reviewed by {request.approver}</small>}
              </div>
              <div className="row-actions">
                <span className={statusPillClass(request.status)}>
                  {request.status}
                </span>
                {request.status === 'Pending' && request.person === currentUser.name && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      runAction(
                        () => actions.updateLeave(request.id, 'Withdrawn'),
                        'Leave request withdrawn by employee.',
                      )
                    }
                  >
                    Withdraw
                  </button>
                )}
                {request.status === 'Pending' && canApproveLeave && request.person !== currentUser.name && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        runAction(() => actions.updateLeave(request.id, 'Approved'), 'Leave request approved.')
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        runAction(() => actions.updateLeave(request.id, 'Cancelled'), 'Leave request cancelled.')
                      }
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {visibleLeaveRequests.length === 0 && <p className="muted">No leave requests for this login yet.</p>}
        </div>
      </Panel>

      <Panel title="Balance">
        <div className="balance-card">
          <strong>{allocatedLeaveDays}</strong>
          <span>available leave days</span>
        </div>
        <div className="leave-bars">
          {balances.map((balance) => (
            <Progress key={balance.label} label={balance.label} value={balance.value} max={balance.max} />
          ))}
        </div>
        <div className="stack-list leave-policy-list">
          <InfoRow title="Special leave - Maternity" text={`${allocation.special.maternity} days as per policy`} />
          <InfoRow title="Special leave - Paternity" text={`${allocation.special.paternity} days as per policy`} />
          <InfoRow title="Special leave - Bereavement" text={`${allocation.special.bereavement} days as per policy`} />
          <InfoRow title="Special leave - Medical emergency" text={`${allocation.special.medicalEmergency} days as per policy`} />
          <InfoRow title="Special leave - Marriage" text={`${allocation.special.marriage} days as per policy`} />
        </div>
      </Panel>
    </section>
  )
}

function TeamUp({ employees, teams, currentUser, actions, runAction }) {
  const [teamForm, setTeamForm] = useState({
    name: '',
    purpose: '',
    members: [currentUser.name],
  })
  const [messageDrafts, setMessageDrafts] = useState({})
  const [messageFiles, setMessageFiles] = useState({})
  const availablePeople = employees.map((employee) => employee.name)

  function toggleMember(member) {
    setTeamForm((current) => ({
      ...current,
      members: current.members.includes(member)
        ? current.members.filter((item) => item !== member)
        : [...current.members, member],
    }))
  }

  function submitTeam(event) {
    event.preventDefault()
    runAction(async () => {
      await actions.createTeam(teamForm)
      setTeamForm({ name: '', purpose: '', members: [currentUser.name] })
    }, 'Team group created for communication.')
  }

  function sendMessage(event, teamId) {
    event.preventDefault()
    const text = messageDrafts[teamId] || ''
    const file = messageFiles[teamId] || null
    runAction(async () => {
      await actions.sendTeamMessage(teamId, { text, file })
      setMessageDrafts((current) => ({ ...current, [teamId]: '' }))
      setMessageFiles((current) => ({ ...current, [teamId]: null }))
      event.target.reset()
    }, file ? 'Team message and document uploaded.' : 'Team message sent.')
  }

  return (
    <section className="content-grid">
      <Panel className="wide" title="Team groups">
        <div className="team-list">
          {teams.map((team) => (
            <article className="team-card" key={team.id}>
              <div className="team-card-head">
                <div>
                  <strong>{team.name}</strong>
                  <span>Created by {team.createdBy}</span>
                </div>
                <span className="pill neutral">{team.members.length} members</span>
              </div>
              <p>{team.purpose}</p>
              <div className="tag-row">
                {team.members.map((member) => (
                  <span className="tag" key={`${team.id}-${member}`}>
                    {member}
                  </span>
                ))}
              </div>
              <div className="message-list">
                {team.messages.map((message) => (
                  <div className="message-row" key={message.id}>
                    <strong>{message.author}</strong>
                    <p>{message.text}</p>
                    {message.attachment && (
                      <button
                        type="button"
                        className="attachment-button"
                        onClick={() => window.open(`/api/teams/${team.id}/messages/${message.id}/attachment`, '_blank')}
                      >
                        <FileText size={15} />
                        <span>{message.attachment.name}</span>
                        <Download size={14} />
                      </button>
                    )}
                    <span>{message.createdAt}</span>
                  </div>
                ))}
              </div>
              <form className="message-form" onSubmit={(event) => sendMessage(event, team.id)}>
                <input
                  value={messageDrafts[team.id] || ''}
                  onChange={(event) =>
                    setMessageDrafts((current) => ({ ...current, [team.id]: event.target.value }))
                  }
                  placeholder="Write a team message"
                />
                <label className="message-attachment">
                  <Upload size={16} />
                  <span>{messageFiles[team.id]?.name || 'Attach document'}</span>
                  <input
                    type="file"
                    onChange={(event) =>
                      setMessageFiles((current) => ({ ...current, [team.id]: event.target.files?.[0] || null }))
                    }
                  />
                </label>
                <button type="submit">Send</button>
              </form>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="Create team">
        <form className="team-form" onSubmit={submitTeam}>
          <input
            value={teamForm.name}
            onChange={(event) => setTeamForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Team group name"
          />
          <textarea
            value={teamForm.purpose}
            onChange={(event) => setTeamForm((current) => ({ ...current, purpose: event.target.value }))}
            placeholder="Purpose of this group"
          />
          <div className="member-picker">
            {availablePeople.map((person) => (
              <label key={person}>
                <input
                  type="checkbox"
                  checked={teamForm.members.includes(person)}
                  onChange={() => toggleMember(person)}
                />
                <span>{person}</span>
              </label>
            ))}
          </div>
          <button type="submit">Create team group</button>
        </form>
      </Panel>
    </section>
  )
}

function Payroll({ data, actions, role, runAction }) {
  const canReviewPayroll = role === 'admin'
  const pendingApprovals = (data.payrollApprovals || []).filter((approval) => approval.status === 'Pending')
  const approvedApprovals = (data.payrollApprovals || []).filter((approval) => approval.status === 'Approved')

  return (
    <section className="content-grid">
      <Panel
        className="wide"
        title="Payroll trend"
        action="Generate batch"
        onAction={() => runAction(actions.generatePayroll, 'Payroll batch sent to approval queue.')}
      >
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data.payroll}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Line dataKey="payroll" stroke="#146c94" strokeWidth={3} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="Salary slips">
        <div className="stack-list">
          {data.salarySlips.map((slip) => (
            <button
              className="document-button"
              type="button"
              key={slip.id}
              onClick={() => window.open(`/api/payroll/slips/${slip.id}/download`, '_blank')}
            >
              <FileText size={17} />
              <span>{slip.month}</span>
              <Download size={16} />
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Pending Approvals">
        <div className="approval-list">
          {pendingApprovals.map((approval) => (
            <PayrollApprovalCard
              approval={approval}
              canReviewPayroll={canReviewPayroll}
              actions={actions}
              runAction={runAction}
              key={approval.id}
            />
          ))}
          {pendingApprovals.length === 0 && (
            <p className="muted">No payroll batches are waiting for review.</p>
          )}
        </div>
      </Panel>

      <Panel title="Approved">
        <div className="approval-list">
          {approvedApprovals.map((approval) => (
            <PayrollApprovalCard
              approval={approval}
              canReviewPayroll={false}
              actions={actions}
              runAction={runAction}
              key={approval.id}
            />
          ))}
          {approvedApprovals.length === 0 && (
            <p className="muted">Approved payroll batches will appear here.</p>
          )}
        </div>
      </Panel>
    </section>
  )
}

function PayrollApprovalCard({ approval, canReviewPayroll, actions, runAction }) {
  return (
    <div className="approval-card">
      <div>
        <strong>{approval.month}</strong>
        <span>{approval.employees} employees - requested by {approval.requestedBy}</span>
        <p>
          Gross {formatCurrency(approval.grossTotal)} - Deductions {formatCurrency(approval.deductions)} - Net {formatCurrency(approval.netTotal)}
        </p>
        {approval.reviewedBy && <small>Reviewed by {approval.reviewedBy}</small>}
      </div>
      <div className="row-actions">
        <span className={statusPillClass(approval.status)}>{approval.status}</span>
        {approval.status === 'Pending' && canReviewPayroll && (
          <>
            <button
              type="button"
              onClick={() =>
                runAction(
                  () => actions.reviewPayroll(approval.id, 'Approved'),
                  'Payroll batch approved and moved to Approved.',
                )
              }
            >
              Approve
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                runAction(
                  () => actions.reviewPayroll(approval.id, 'Rejected'),
                  'Payroll batch rejected.',
                )
              }
            >
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function formatCurrency(value) {
  return `Rs. ${Number(value || 0).toLocaleString('en-IN')}`
}

function SalaryCalculator() {
  const [salaryForm, setSalaryForm] = useState({
    annualCtc: '600000',
    variablePay: '0',
    monthlyTax: '0',
    professionalTax: '200',
    cabChargesMonthly: '0',
    includePf: true,
  })
  const annualCtc = Number(salaryForm.annualCtc || 0)
  const variablePay = Number(salaryForm.variablePay || 0)
  const fixedCtc = Math.max(0, annualCtc - variablePay)
  const basicAnnual = Math.round(fixedCtc * 0.4)
  const hraAnnual = Math.round(basicAnnual * 0.4)
  const employerPfAnnual = salaryForm.includePf ? Math.min(Math.round(basicAnnual * 0.12), 21600) : 0
  const employeePfAnnual = salaryForm.includePf ? employerPfAnnual : 0
  const specialAllowanceAnnual = Math.max(0, fixedCtc - basicAnnual - hraAnnual - employerPfAnnual)
  const grossMonthly = Math.round((basicAnnual + hraAnnual + specialAllowanceAnnual) / 12)
  const monthlyDeductions =
    Math.round(employeePfAnnual / 12) +
    Number(salaryForm.monthlyTax || 0) +
    Number(salaryForm.professionalTax || 0) +
    Number(salaryForm.cabChargesMonthly || 0)
  const takeHomeMonthly = Math.max(0, grossMonthly - monthlyDeductions)

  function updateSalaryForm(field, value) {
    setSalaryForm((current) => ({ ...current, [field]: value }))
  }

  return (
    <section className="content-grid">
      <Panel className="wide" title="CTC salary calculator">
        <div className="salary-calculator">
          <label>
            <span>Annual CTC</span>
            <input
              type="number"
              value={salaryForm.annualCtc}
              onChange={(event) => updateSalaryForm('annualCtc', event.target.value)}
            />
          </label>
          <label>
            <span>Annual variable pay</span>
            <input
              type="number"
              value={salaryForm.variablePay}
              onChange={(event) => updateSalaryForm('variablePay', event.target.value)}
            />
          </label>
          <label>
            <span>Monthly income tax</span>
            <input
              type="number"
              value={salaryForm.monthlyTax}
              onChange={(event) => updateSalaryForm('monthlyTax', event.target.value)}
            />
          </label>
          <label>
            <span>Professional tax</span>
            <input
              type="number"
              value={salaryForm.professionalTax}
              onChange={(event) => updateSalaryForm('professionalTax', event.target.value)}
            />
          </label>
          <label>
            <span>Cab charges</span>
            <input
              type="number"
              value={salaryForm.cabChargesMonthly}
              onChange={(event) => updateSalaryForm('cabChargesMonthly', event.target.value)}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={salaryForm.includePf}
              onChange={(event) => updateSalaryForm('includePf', event.target.checked)}
            />
            <span>Include PF deductions</span>
          </label>
        </div>
      </Panel>

      <Panel title="Monthly estimate">
        <div className="salary-summary">
          <Metric icon={WalletCards} label="Gross monthly" value={formatCurrency(grossMonthly)} detail="Before employee deductions" />
          <Metric icon={Download} label="Take-home" value={formatCurrency(takeHomeMonthly)} detail="Estimated in-hand salary" />
        </div>
      </Panel>

      <Panel title="Breakup">
        <div className="stack-list">
          <InfoRow title="Basic" text={`${formatCurrency(Math.round(basicAnnual / 12))} monthly`} />
          <InfoRow title="HRA" text={`${formatCurrency(Math.round(hraAnnual / 12))} monthly`} />
          <InfoRow title="Special allowance" text={`${formatCurrency(Math.round(specialAllowanceAnnual / 12))} monthly`} />
          <InfoRow title="Employee PF" text={`${formatCurrency(Math.round(employeePfAnnual / 12))} monthly`} />
          <InfoRow title="Cab charges" text={`${formatCurrency(Number(salaryForm.cabChargesMonthly || 0))} monthly`} />
          <InfoRow title="Monthly deductions" text={formatCurrency(monthlyDeductions)} />
          <InfoRow title="Annual variable pay" text={formatCurrency(variablePay)} />
        </div>
      </Panel>
    </section>
  )
}

function Recruitment({
  data,
  jobDescription,
  setJobDescription,
  appliedJobId,
  setAppliedJobId,
  match,
  actions,
  runAction,
  runCandidateMatch,
  roleId,
}) {
  const [selectedResumes, setSelectedResumes] = useState([])
  const [interviewForms, setInterviewForms] = useState({})
  const [jobForm, setJobForm] = useState({
    title: '',
    department: '',
    skills: '',
    description: '',
  })
  const candidateResults = data.candidateResults?.length
    ? data.candidateResults
    : [{ candidate: data.candidate, match }]
  const fileSummary = selectedResumes.length
    ? `${selectedResumes.length} resume${selectedResumes.length === 1 ? '' : 's'} selected`
    : data.candidate.fileName
  const selectionLimitReached = selectedResumes.length === 25
  const canListRole = roleId === 'recruiter' || roleId === 'admin'
  const activeAppliedJobId = appliedJobId || data.jobs[0]?.id || ''

  function submitJob(event) {
    event.preventDefault()
    runAction(async () => {
      await actions.addJob(jobForm)
      setJobForm({ title: '', department: '', skills: '', description: '' })
    }, 'Open role listed with required skills.')
  }

  function updateInterviewForm(id, field, value) {
    setInterviewForms((current) => ({
      ...current,
      [id]: {
        ...(current[id] || {}),
        [field]: value,
      },
    }))
  }

  function scheduleInterview(event, item) {
    event.preventDefault()
    const form = interviewForms[item.id] || {}
    runAction(async () => {
      await actions.scheduleVideoInterview(item.id, form)
      setInterviewForms((current) => ({
        ...current,
        [item.id]: {
          scheduledFor: '',
          interviewer: '',
          meetingLink: '',
          notes: '',
        },
      }))
    }, `Video interview scheduled and email prepared for ${item.email}.`)
  }

  return (
    <section className="content-grid">
      <Panel
        className="wide"
        title="AI resume screening"
        action="Send to shortlist"
        onAction={() => runAction(actions.shortlist, 'Candidate sent to shortlist for human HR review.')}
      >
        <div className="screening-grid">
          <div className="resume-uploader">
            <label className="upload-zone" htmlFor="resume-upload">
              <Upload size={24} />
              <strong>{fileSummary}</strong>
              <span>Choose up to 25 PDF, DOC, or DOCX resumes</span>
            </label>
            <input
              id="resume-upload"
              type="file"
              accept=".pdf,.doc,.docx"
              multiple
              onChange={(event) => setSelectedResumes(normalizeResumeFiles(event.target.files))}
            />
            <input
              id="resume-folder-upload"
              type="file"
              accept=".pdf,.doc,.docx"
              multiple
              webkitdirectory="true"
              directory="true"
              onChange={(event) => setSelectedResumes(normalizeResumeFiles(event.target.files))}
            />
            <div className="upload-options">
              <label htmlFor="resume-upload">Upload files</label>
              <label htmlFor="resume-folder-upload">Upload folder</label>
            </div>
            {selectionLimitReached && (
              <p className="muted">First 25 resume files selected for this screening batch.</p>
            )}
            {selectedResumes.length > 0 && (
              <div className="selected-files">
                {selectedResumes.map((file) => (
                  <span key={`${file.name}-${file.size}`}>
                    {file.webkitRelativePath || file.name}
                  </span>
                ))}
              </div>
            )}
            <div className="screening-actions">
              <button
                type="button"
                onClick={() =>
                  runAction(
                    () => actions.parseResumes(selectedResumes),
                    selectedResumes.length
                      ? `${selectedResumes.length} resume${selectedResumes.length === 1 ? '' : 's'} screened by backend AI endpoint.`
                      : 'Current demo resume screened by backend AI endpoint.',
                  )
                }
              >
                <Sparkles size={16} />
                Screen resume
              </button>
            </div>
          </div>
          <label className="job-input">
            <span>Applied for role</span>
            <select value={activeAppliedJobId} onChange={(event) => setAppliedJobId(event.target.value)}>
              {data.jobs.map((job) => (
                <option value={job.id} key={job.id}>{job.title}</option>
              ))}
            </select>
            <span>Manual skill check</span>
            <textarea value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} />
            <button type="button" onClick={() => runCandidateMatch()}>
              Recalculate match
            </button>
          </label>
          <div className="batch-results">
            {candidateResults.map((result, index) => (
              <CandidateMatch
                candidate={result.candidate}
                match={result.bestRole || result.match}
                roleMatches={result.roleMatches}
                appliedFor={result.appliedFor}
                onShortlist={() =>
                  runAction(
                    () => actions.shortlistCandidate(result.candidate, result.bestRole || result.match),
                    `${result.candidate.name} moved to HR shortlisted folder.`,
                  )
                }
                key={`${result.candidate.fileName}-${index}`}
              />
            ))}
          </div>
        </div>
        <div className="safety-note">
          <ShieldCheck size={18} />
          AI provides summaries, skill match scores, strengths, missing skills, and recommendation notes only.
          Final hiring decisions stay with HR.
        </div>
      </Panel>

      <Panel title="Open roles">
        {canListRole && (
          <form className="role-form" onSubmit={submitJob}>
            <input
              value={jobForm.title}
              onChange={(event) => setJobForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Role title"
            />
            <input
              value={jobForm.department}
              onChange={(event) => setJobForm((current) => ({ ...current, department: event.target.value }))}
              placeholder="Department"
            />
            <input
              value={jobForm.skills}
              onChange={(event) => setJobForm((current) => ({ ...current, skills: event.target.value }))}
              placeholder="Required skills, comma separated"
            />
            <textarea
              value={jobForm.description}
              onChange={(event) => setJobForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Role description"
            />
            <button type="submit">List open role</button>
          </form>
        )}
        <div className="stack-list">
          {data.jobs.map((job) => (
            <article className="role-card" key={job.id}>
              <div>
                <strong>{job.title}</strong>
                <span>{job.department} - {job.applicants} candidates</span>
                {job.description && <p>{job.description}</p>}
              </div>
              <div className="tag-row">
                {job.skills.map((skill) => (
                  <span className="tag" key={`${job.id}-${skill}`}>
                    {skill}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="HR shortlisted folder">
        <div className="folder-actions">
          <button
            type="button"
            onClick={() =>
              runAction(
                actions.notifyAllShortlistedCandidates,
                'All pending shortlisted candidates notified by email.',
              )
            }
            disabled={(data.shortlists || []).every((item) => item.notified)}
          >
            Notify all
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() =>
              runAction(
                actions.clearShortlistedCandidates,
                'Shortlisted folder cleared.',
              )
            }
            disabled={(data.shortlists || []).length === 0}
          >
            Clear all
          </button>
        </div>
        <div className="shortlist-folder">
          {(data.shortlists || []).map((item) => (
            <article className="shortlist-card" key={item.id}>
              <div>
                <strong>{item.candidate}</strong>
                <span>{item.email}</span>
                <p>Applied for: {item.appliedFor?.title || item.jobTitle}</p>
                <p>Matched for: {item.bestRole || item.jobTitle} - {item.score}% match - {item.fileName}</p>
              </div>
              <div className="tag-row">
                {(item.skills || []).slice(0, 5).map((skill) => (
                  <span className="tag" key={`${item.id}-${skill}`}>{skill}</span>
                ))}
              </div>
              <div className="row-actions">
                <span className={item.selected ? 'pill good' : 'pill pending'}>
                  {item.selected ? 'Selected' : 'Selection pending'}
                </span>
                <span className={item.notified ? 'pill good' : 'pill pending'}>
                  {item.notified ? 'Notified' : 'Not notified'}
                </span>
                {canListRole && (
                  <button
                    type="button"
                    onClick={() =>
                      runAction(
                        () => actions.markShortlistedCandidateSelected(item.id),
                        `${item.candidate} marked as selected by HR.`,
                      )
                    }
                    disabled={item.selected}
                  >
                    {item.selected ? 'Selected' : 'Mark selected'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    runAction(
                      () => actions.notifyShortlistedCandidate(item.id),
                      `Email notification sent to ${item.email}.`,
                    )
                  }
                  disabled={item.notified}
                >
                  {item.notified ? 'Email sent' : 'Notify candidate'}
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() =>
                    runAction(
                      () => actions.deleteShortlistedCandidate(item.id),
                      `${item.candidate} removed from shortlisted folder.`,
                    )
                  }
                >
                  Delete
                </button>
              </div>
              {item.notifiedAt && <small>Sent {item.notifiedAt}</small>}
              {item.selected && (
                <small>Selected by {item.selectedBy} on {item.selectedAt}. Final decision recorded by HR.</small>
              )}
              {item.videoInterview && (
                <div className="interview-summary">
                  <Video size={17} />
                  <div>
                    <strong>Video interview scheduled</strong>
                    <span>{item.videoInterview.scheduledForLabel}</span>
                    <span>Interviewer: {item.videoInterview.interviewer}</span>
                    <a href={item.videoInterview.meetingLink} target="_blank" rel="noreferrer">
                      Open meeting link
                    </a>
                    {item.videoInterview.notes && <small>{item.videoInterview.notes}</small>}
                  </div>
                </div>
              )}
              <div className="screening-session">
                <div className="screening-session-head">
                  <div>
                    <strong>AI screening conversation</strong>
                    <span>{item.aiScreening?.status || 'Not started'}</span>
                  </div>
                  {canListRole && (
                    <button
                      type="button"
                      onClick={() =>
                        runAction(
                          () => actions.startCandidateScreening(item.id),
                          `AI screening invitation sent to ${item.email}.`,
                        )
                      }
                    >
                      {item.aiScreening ? 'Resend invite' : 'Invite candidate'}
                    </button>
                  )}
                </div>
                {item.aiScreening && (
                  <>
                    <div className="screening-invite-row">
                      <span>Candidate link</span>
                      <a href={item.aiScreening.inviteUrl} target="_blank" rel="noreferrer">
                        Open candidate screening page
                      </a>
                      {item.aiScreening.invitedAt && <small>Invited {item.aiScreening.invitedAt}</small>}
                    </div>
                    <div className="screening-chat">
                      {item.aiScreening.messages.map((message) => (
                        <div
                          className={message.sender === 'ai' ? 'screening-message ai' : 'screening-message candidate'}
                          key={message.id}
                        >
                          <span>{message.sender === 'ai' ? 'AI question' : message.mode === 'voice' ? 'Voice answer' : 'Candidate answer'}</span>
                          <p>{message.text}</p>
                          <small>{message.createdAt}</small>
                        </div>
                      ))}
                    </div>
                    {item.aiScreening.evaluation && (
                      <div className="screening-evaluation">
                        <strong>AI evaluation for HR review</strong>
                        <div className="screening-score-grid">
                          <span>Overall {item.aiScreening.evaluation.overallScore}%</span>
                          <span>Communication {item.aiScreening.evaluation.communicationScore}%</span>
                          <span>Skill evidence {item.aiScreening.evaluation.skillEvidenceScore}%</span>
                        </div>
                        <p>{item.aiScreening.evaluation.hrRecommendationNote}</p>
                        <small>Final hiring decision remains with HR.</small>
                      </div>
                    )}
                  </>
                )}
              </div>
              {canListRole && (
                <form className="interview-form" onSubmit={(event) => scheduleInterview(event, item)}>
                  <label>
                    <span>Video interview date and time</span>
                    <input
                      type="datetime-local"
                      value={interviewForms[item.id]?.scheduledFor || ''}
                      onChange={(event) => updateInterviewForm(item.id, 'scheduledFor', event.target.value)}
                      required
                    />
                  </label>
                  <label>
                    <span>Interviewer</span>
                    <input
                      placeholder="Interviewer name"
                      value={interviewForms[item.id]?.interviewer || ''}
                      onChange={(event) => updateInterviewForm(item.id, 'interviewer', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Meeting link</span>
                    <input
                      type="url"
                      placeholder="https://meet.google.com/..."
                      value={interviewForms[item.id]?.meetingLink || ''}
                      onChange={(event) => updateInterviewForm(item.id, 'meetingLink', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Candidate note</span>
                    <input
                      placeholder="Interview agenda or preparation note"
                      value={interviewForms[item.id]?.notes || ''}
                      onChange={(event) => updateInterviewForm(item.id, 'notes', event.target.value)}
                    />
                  </label>
                  <button type="submit">
                    <Video size={16} />
                    {item.videoInterview ? 'Reschedule video interview' : 'Schedule video interview'}
                  </button>
                </form>
              )}
            </article>
          ))}
          {(data.shortlists || []).length === 0 && (
            <p className="muted">Shortlisted candidates will appear here for HR follow-up.</p>
          )}
        </div>
      </Panel>
    </section>
  )
}

function normalizeResumeFiles(fileList) {
  const allowedExtensions = ['.pdf', '.doc', '.docx']

  return Array.from(fileList || [])
    .filter((file) => allowedExtensions.some((extension) => file.name.toLowerCase().endsWith(extension)))
    .slice(0, 25)
}

function AiCenter({ query, setQuery, chatAnswer, data, match, actions, runAction }) {
  const recognitionRef = useRef(null)
  const [voiceStatus, setVoiceStatus] = useState('Ready for a voice HR question.')
  const [voiceListening, setVoiceListening] = useState(false)

  function startVoiceQuery() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognition) {
      setVoiceStatus('Voice recognition is not supported in this browser. Sending the typed question instead.')
      runAction(
        () => actions.submitVoiceQuery(query),
        'Typed question sent through the voice query backend.',
      )
      return
    }

    if (voiceListening && recognitionRef.current) {
      recognitionRef.current.stop()
      return
    }

    const recognition = new SpeechRecognition()
    recognitionRef.current = recognition
    recognition.lang = 'en-IN'
    recognition.interimResults = false
    recognition.continuous = false

    recognition.onstart = () => {
      setVoiceListening(true)
      setVoiceStatus('Listening... ask about leave, attendance, or payslips.')
    }

    recognition.onerror = (event) => {
      setVoiceListening(false)
      setVoiceStatus(event.error === 'not-allowed' ? 'Microphone permission was blocked.' : 'Voice capture failed. Try again.')
    }

    recognition.onend = () => {
      setVoiceListening(false)
    }

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || '')
        .join(' ')
        .trim()

      if (!transcript) {
        setVoiceStatus('No speech detected. Try again.')
        return
      }

      setVoiceStatus(`Heard: ${transcript}`)
      runAction(
        () => actions.submitVoiceQuery(transcript),
        'Voice query answered by backend.',
      )
    }

    recognition.start()
  }

  return (
    <section className="content-grid">
      <Panel className="wide" title="AI HR chatbot" action="Ask backend" onAction={() => runAction(actions.askChat, 'Chatbot answered from backend AI route.')}>
        <div className="chat-surface">
          <div className="chat-message user">
            <UserRound size={18} />
            <span>{query}</span>
          </div>
          <div className="chat-message bot">
            <Bot size={18} />
            <span>{chatAnswer}</span>
          </div>
          <div className="chat-input">
            <input value={query} onChange={(event) => setQuery(event.target.value)} />
            <button type="button" title="Ask chatbot" onClick={() => runAction(actions.askChat, 'Chatbot answered from backend AI route.')}>
              <Sparkles size={18} />
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Voice assistant">
        <div className={voiceListening || data.voiceListening ? 'voice-orb listening' : 'voice-orb'}>
          <Mic size={28} />
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={startVoiceQuery}
        >
          {voiceListening ? 'Stop listening' : 'Start voice query'}
        </button>
        <p className="muted">{voiceStatus}</p>
      </Panel>

      <Panel title="Candidate signal">
        <CandidateMatch candidate={data.candidate} match={match} compact />
      </Panel>
    </section>
  )
}

function CandidateMatch({ candidate, match, compact = false, onShortlist, roleMatches = [], appliedFor }) {
  const safeMatch = match || { score: 0, matched: [], missing: [], recommendation: 'Run matching to score this candidate.' }

  return (
    <div className={compact ? 'match-card compact' : 'match-card'}>
      <div className="score-ring" style={{ '--score': `${safeMatch.score}%` }}>
        <strong>{safeMatch.score}%</strong>
        <span>match</span>
      </div>
      <div>
        <h3>{candidate.name}</h3>
        {appliedFor?.title && (
          <p className="applied-role">Applied for: <strong>{appliedFor.title}</strong></p>
        )}
        {safeMatch.title && (
          <p className="best-role">Matched for: <strong>{safeMatch.title}</strong> ({safeMatch.score}% match)</p>
        )}
        <p>{candidate.summary}</p>
        <p className="muted">
          Extracted: {candidate.email}, {candidate.phone}, {candidate.education}, and {candidate.experience}.
        </p>
        {candidate.parseStatus && <p className="muted">Parser status: {candidate.parseStatus}.</p>}
        <div className="tag-row">
          {candidate.skills.length > 0 ? (
            candidate.skills.map((skill) => (
              <span className="tag" key={skill}>
                {skill}
              </span>
            ))
          ) : (
            <span className="tag muted-tag">No skills detected</span>
          )}
        </div>
        {!compact && (
          <>
            <p className="muted">Missing skills: {safeMatch.missing.length ? safeMatch.missing.join(', ') : 'None detected'}</p>
            {roleMatches.length > 0 && (
              <div className="role-match-list">
                {roleMatches.map((roleMatch) => (
                  <div className="role-match-row" key={roleMatch.jobId}>
                    <span>{roleMatch.title}</span>
                    <strong>{roleMatch.score}%</strong>
                  </div>
                ))}
              </div>
            )}
            <p className="muted">HR note: {safeMatch.recommendation}</p>
            <p className="muted">Strengths: {candidate.strengths.join(', ')}</p>
            {onShortlist && (
              <button className="primary-button inline-action" type="button" onClick={onShortlist}>
                Send to shortlist
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Panel({ title, action, onAction, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <h2>{title}</h2>
        {action && (
          <button type="button" onClick={onAction}>
            {action === 'Add employee' && <Plus size={16} />}
            {action}
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function Metric({ icon: Icon, label, value, detail }) {
  return (
    <div className="metric-card">
      <div className="metric-icon">
        <Icon size={19} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </div>
  )
}

function InfoRow({ title, text }) {
  return (
    <div className="info-row">
      <FileSearch size={18} />
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </div>
  )
}

function Progress({ label, value, max }) {
  return (
    <div className="progress-row">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="progress-track">
        <span style={{ width: `${(value / max) * 100}%` }} />
      </div>
    </div>
  )
}

export default App
