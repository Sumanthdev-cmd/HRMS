import 'dotenv/config'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import cors from 'cors'
import express from 'express'
import mammoth from 'mammoth'
import multer from 'multer'
import nodemailer from 'nodemailer'
import { PDFParse } from 'pdf-parse'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const upload = multer({ storage: multer.memoryStorage() })
const port = 4000
const usersPath = join(__dirname, 'data', 'users.json')
const analyticsSeedPath = join(__dirname, 'data', 'analytics-seed.csv')
const clientDistPath = join(__dirname, '..', 'dist')
const clientIndexPath = join(clientDistPath, 'index.html')
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const resendApiKey = process.env.RESEND_API_KEY
const brevoApiKey = process.env.BREVO_API_KEY
const smtpHost = process.env.SMTP_HOST
const smtpPort = Number(process.env.SMTP_PORT || 465)
const smtpUser = process.env.SMTP_USER
const smtpPass = process.env.SMTP_PASS
const emailFrom = process.env.EMAIL_FROM || 'AI-HRMS <onboarding@resend.dev>'
const publicAppUrl = process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173'
const supabaseAuth = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null
const supabaseAdmin = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null
const appStateId = 'default-company'

const defaultLeaveAllocation = {
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

const realtimeClients = new Set()
let lastSupabaseStateUpdatedAt = null
let realtimeVersion = 0

app.use(cors())
app.use(express.json())
app.use((request, response, next) => {
  response.on('finish', () => {
    if (['POST', 'PATCH', 'DELETE'].includes(request.method) && response.statusCode < 500) {
      saveHrmsStateToSupabase()
        .then(() => broadcastRealtimeState(`mutation:${request.method}:${request.path}`))
        .catch((error) => {
          console.warn(`[realtime] Could not publish latest state: ${error.message}`)
        })
    }
  })
  next()
})

function loadUsers() {
  return JSON.parse(readFileSync(usersPath, 'utf8'))
}

function verifyPassword(password, user) {
  const submittedHash = scryptSync(String(password || ''), user.salt, 64)
  const storedHash = Buffer.from(user.passwordHash, 'hex')
  return storedHash.length === submittedHash.length && timingSafeEqual(storedHash, submittedHash)
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase()
  const roleMap = {
    admin: 'admin',
    'management admin': 'admin',
    manager: 'manager',
    'senior manager': 'manager',
    recruiter: 'recruiter',
    'hr recruiter': 'recruiter',
    employee: 'employee',
  }

  return roleMap[role] || ''
}

function inferRoleFromEmail(email) {
  const username = String(email || '').split('@')[0].trim().toLowerCase()

  if (username.includes('admin')) return 'admin'
  if (username.includes('manager')) return 'manager'
  if (username.includes('recruiter') || username.includes('hr')) return 'recruiter'
  if (username.includes('employee')) return 'employee'

  return ''
}

async function loginWithSupabase(email, password) {
  if (!supabaseAuth) {
    return null
  }

  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })

  if (error || !data.user || !data.session) {
    throw new Error(error?.message || 'Invalid email or password')
  }

  const userScopedSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
      },
    },
  })
  const profileClient = supabaseAdmin || userScopedSupabase
  const { data: profile, error: profileError } = await profileClient
    .from('profiles')
    .select('full_name, role')
    .eq('id', data.user.id)
    .maybeSingle()

  const metadata = data.user.user_metadata || {}
  const role = normalizeRole(profile?.role) || normalizeRole(metadata.role) || inferRoleFromEmail(data.user.email)

  if (!role) {
    console.warn(`[auth] Supabase login succeeded for ${data.user.email}, but no profile role was found.`)
  }

  if (profileError) {
    console.warn(`[auth] Could not load profile for ${data.user.email}: ${profileError.message}`)
  }

  return {
    token: data.session.access_token,
    user: {
      email: data.user.email,
      name: profile?.full_name || metadata.full_name || data.user.email,
      role: role || 'employee',
    },
  }
}

async function findSupabaseUserByEmail(email) {
  if (!supabaseAdmin) {
    return null
  }

  const normalizedEmail = String(email || '').trim().toLowerCase()
  let page = 1

  while (page <= 10) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })

    if (error) {
      console.warn(`[auth] Could not search Supabase users: ${error.message}`)
      return null
    }

    const user = data.users.find((item) => String(item.email || '').toLowerCase() === normalizedEmail)
    if (user) {
      return user
    }

    if (data.users.length < 1000) {
      return null
    }

    page += 1
  }

  return null
}

async function createOrUpdateSupabaseEmployeeLogin({ email, password, fullName, role }) {
  if (!supabaseAdmin) {
    return { created: false, updated: false, error: 'Supabase service role is not configured' }
  }

  const normalizedEmail = String(email || '').trim().toLowerCase()
  const normalizedRole = normalizeRole(role) || 'employee'

  if (!normalizedEmail || !password || password.length < 6) {
    return { created: false, updated: false, error: 'Work email and a password with at least 6 characters are required' }
  }

  let authUser = await findSupabaseUserByEmail(normalizedEmail)
  let created = false
  let updated = false

  if (authUser) {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role: normalizedRole,
      },
    })

    if (error) {
      return { created: false, updated: false, error: error.message }
    }

    authUser = data.user
    updated = true
  } else {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role: normalizedRole,
      },
    })

    if (error) {
      return { created: false, updated: false, error: error.message }
    }

    authUser = data.user
    created = true
  }

  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .upsert({
      id: authUser.id,
      email: normalizedEmail,
      full_name: fullName,
      role: normalizedRole,
    }, {
      onConflict: 'id',
    })

  if (profileError) {
    return { created, updated, error: profileError.message }
  }

  return { created, updated, userId: authUser.id, role: normalizedRole, email: normalizedEmail }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

let smtpTransporter = null

function getSmtpTransporter() {
  if (!smtpHost || !smtpUser || !smtpPass) {
    return null
  }

  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    })
  }

  return smtpTransporter
}

async function sendEmail({ to, subject, text, html }) {
  if (brevoApiKey) {
    const fromMatch = String(emailFrom).match(/^(.*)<(.+)>$/)
    const senderName = fromMatch ? fromMatch[1].trim() : 'AI-HRMS'
    const senderEmail = fromMatch ? fromMatch[2].trim() : smtpUser || 'no-reply@example.com'
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'api-key': brevoApiKey,
      },
      body: JSON.stringify({
        sender: {
          name: senderName || 'AI-HRMS',
          email: senderEmail,
        },
        to: [{ email: to }],
        subject,
        textContent: text,
        htmlContent: html,
      }),
    })

    const result = await response.json().catch(() => ({}))

    if (!response.ok) {
      console.warn(`[email] Brevo rejected email to ${to}: ${response.status} ${JSON.stringify(result)}`)
      return { sent: false, error: result.message || 'Brevo rejected the message' }
    }

    return { sent: true, providerId: result.messageId || null, provider: 'brevo' }
  }

  const transporter = getSmtpTransporter()

  if (transporter) {
    try {
      const result = await transporter.sendMail({
        from: emailFrom,
        to,
        subject,
        text,
        html,
      })

      return { sent: true, providerId: result.messageId || null, provider: 'smtp' }
    } catch (error) {
      console.warn(`[email] SMTP rejected email to ${to}: ${error.message}`)
      return { sent: false, error: error.message }
    }
  }

  if (!resendApiKey) {
    console.warn('[email] SMTP is not configured and RESEND_API_KEY is missing; email was not sent.')
    return { sent: false, error: 'SMTP email settings or RESEND_API_KEY are required' }
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: emailFrom,
      to: [to],
      subject,
      text,
      html,
    }),
  })

  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    console.warn(`[email] Resend rejected email to ${to}: ${response.status} ${JSON.stringify(result)}`)
    return { sent: false, error: result.message || result.error || 'Email provider rejected the message' }
  }

  return { sent: true, providerId: result.id || null }
}

function candidateNotificationContent(shortlist) {
  const role = shortlist.bestRole || shortlist.jobTitle || 'the open role'
  const score = Number(shortlist.score || 0)
  const subject = `Your application update for ${role}`
  const text = [
    `Hello ${shortlist.candidate},`,
    '',
    `Thank you for your application. Your profile has been shortlisted for HR review for ${role}.`,
    `Current match score: ${score}%.`,
    '',
    'This is not a final selection decision. Our HR team will review your profile and contact you with the next steps.',
    '',
    `AI-HRMS`,
    publicAppUrl,
  ].join('\n')
  const html = `
    <div style="font-family: Arial, sans-serif; color: #17212b; line-height: 1.5;">
      <h2>Application update</h2>
      <p>Hello ${escapeHtml(shortlist.candidate)},</p>
      <p>Your profile has been shortlisted for HR review for <strong>${escapeHtml(role)}</strong>.</p>
      <p><strong>Current match score:</strong> ${score}%</p>
      <p>This is not a final selection decision. Our HR team will review your profile and contact you with the next steps.</p>
      <p style="color: #667985;">AI-HRMS<br />${escapeHtml(publicAppUrl)}</p>
    </div>
  `

  return { subject, text, html }
}

function videoInterviewEmailContent(shortlist, interview) {
  const role = shortlist.bestRole || shortlist.jobTitle || 'the open role'
  const subject = `Video interview scheduled for ${role}`
  const text = [
    `Hello ${shortlist.candidate},`,
    '',
    `Your video interview has been scheduled for ${role}.`,
    `When: ${interview.scheduledForLabel}`,
    `Interviewer: ${interview.interviewer}`,
    `Meeting link: ${interview.meetingLink}`,
    interview.notes ? `Notes: ${interview.notes}` : '',
    '',
    'Please reply to HR if you need to reschedule.',
    '',
    'AI-HRMS',
  ].filter(Boolean).join('\n')
  const html = `
    <div style="font-family: Arial, sans-serif; color: #17212b; line-height: 1.5;">
      <h2>Video interview scheduled</h2>
      <p>Hello ${escapeHtml(shortlist.candidate)},</p>
      <p>Your video interview has been scheduled for <strong>${escapeHtml(role)}</strong>.</p>
      <p><strong>When:</strong> ${escapeHtml(interview.scheduledForLabel)}</p>
      <p><strong>Interviewer:</strong> ${escapeHtml(interview.interviewer)}</p>
      <p><strong>Meeting link:</strong> <a href="${escapeHtml(interview.meetingLink)}">${escapeHtml(interview.meetingLink)}</a></p>
      ${interview.notes ? `<p><strong>Notes:</strong> ${escapeHtml(interview.notes)}</p>` : ''}
      <p>Please reply to HR if you need to reschedule.</p>
    </div>
  `

  return { subject, text, html }
}

function screeningInviteEmailContent(shortlist, screening) {
  const role = shortlist.bestRole || shortlist.jobTitle || 'the open role'
  const subject = `AI screening invitation for ${role}`
  const text = [
    `Hello ${shortlist.candidate},`,
    '',
    `You have been invited to complete an AI-assisted screening conversation for ${role}.`,
    'Please open the secure link below and answer the screening questions. You can type your answers or use voice input if your browser supports it.',
    '',
    screening.inviteUrl,
    '',
    'This screening helps HR prepare for review. It is not an automatic hiring decision.',
    '',
    'AI-HRMS',
  ].join('\n')
  const html = `
    <div style="font-family: Arial, sans-serif; color: #17212b; line-height: 1.5;">
      <h2>AI screening invitation</h2>
      <p>Hello ${escapeHtml(shortlist.candidate)},</p>
      <p>You have been invited to complete an AI-assisted screening conversation for <strong>${escapeHtml(role)}</strong>.</p>
      <p>Please answer the screening questions using text or voice input if your browser supports it.</p>
      <p><a href="${escapeHtml(screening.inviteUrl)}" style="display:inline-block;padding:10px 14px;background:#146c94;color:#fff;text-decoration:none;border-radius:7px;">Open screening link</a></p>
      <p>This screening helps HR prepare for review. It is not an automatic hiring decision.</p>
    </div>
  `

  return { subject, text, html }
}

function screeningQuestionBank(shortlist) {
  const role = shortlist.bestRole || shortlist.jobTitle || 'this role'
  const skills = (shortlist.skills || []).slice(0, 4)
  const topSkill = skills[0] || 'your strongest technical skill'
  const missingSkill = shortlist.roleMatches?.[0]?.missing?.[0] || 'a skill listed in the job description'

  return [
    `Please introduce yourself and explain why you are interested in ${role}.`,
    `Describe one project where you used ${topSkill}. What was your responsibility and result?`,
    `The role may require ${missingSkill}. How would you approach learning or applying it?`,
    'Tell us about a difficult project situation and how you handled it.',
    'What is your notice period, availability, and preferred work location?',
  ]
}

function createScreeningEvaluation(shortlist, session) {
  const answers = (session.messages || []).filter((message) => message.sender === 'candidate')
  const transcript = answers.map((message) => message.text).join(' ').toLowerCase()
  const candidateSkills = (shortlist.skills || []).map((skill) => String(skill).toLowerCase())
  const mentionedSkills = candidateSkills.filter((skill) => transcript.includes(skill.toLowerCase()))
  const wordCount = transcript.split(/\s+/).filter(Boolean).length
  const communicationScore = Math.min(100, Math.max(20, Math.round(wordCount / Math.max(answers.length, 1) * 2)))
  const skillEvidenceScore = candidateSkills.length
    ? Math.round((mentionedSkills.length / candidateSkills.length) * 100)
    : 0
  const overallScore = Math.round((communicationScore * 0.35) + (skillEvidenceScore * 0.35) + (Number(shortlist.score || 0) * 0.3))

  return {
    overallScore,
    communicationScore,
    skillEvidenceScore,
    answeredQuestions: answers.length,
    mentionedSkills,
    strengths: [
      mentionedSkills.length ? `Mentioned ${mentionedSkills.slice(0, 3).join(', ')} during screening.` : 'Resume-based skill evidence should be probed further.',
      wordCount > 80 ? 'Gave detailed responses suitable for HR review.' : 'Responses are brief and need follow-up questions.',
    ],
    concerns: [
      answers.length < 3 ? 'Screening is incomplete; HR should collect more answers.' : null,
      skillEvidenceScore < 50 ? 'Limited direct skill evidence in screening answers.' : null,
    ].filter(Boolean),
    hrRecommendationNote: overallScore >= 70
      ? 'AI suggests moving to structured HR/technical interview. Final decision remains with HR.'
      : 'AI suggests HR follow-up before moving ahead. Final decision remains with HR.',
    generatedAt: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
  }
}

function ensureScreeningSession(shortlist, actorName = 'HR Recruiter') {
  if (shortlist.aiScreening) {
    if (!shortlist.aiScreening.inviteToken) {
      shortlist.aiScreening.inviteToken = randomBytes(24).toString('hex')
    }
    shortlist.aiScreening.inviteUrl = `${publicAppUrl}/candidate-screening/${shortlist.id}?token=${shortlist.aiScreening.inviteToken}`
    return shortlist.aiScreening
  }

  const questions = screeningQuestionBank(shortlist)
  const inviteToken = randomBytes(24).toString('hex')
  shortlist.aiScreening = {
    id: `screening-${Date.now()}`,
    status: 'In progress',
    inviteToken,
    inviteUrl: `${publicAppUrl}/candidate-screening/${shortlist.id}?token=${inviteToken}`,
    createdBy: actorName,
    createdAt: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
    questions,
    currentQuestionIndex: 0,
    messages: [
      {
        id: `screen-msg-${Date.now()}`,
        sender: 'ai',
        mode: 'text',
        text: questions[0],
        createdAt: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      },
    ],
    voiceTranscripts: [],
    evaluation: null,
  }

  return shortlist.aiScreening
}

function publicScreeningPayload(shortlist) {
  const screening = shortlist.aiScreening

  return {
    id: screening.id,
    status: screening.status,
    candidate: shortlist.candidate,
    role: shortlist.bestRole || shortlist.jobTitle,
    appliedFor: shortlist.appliedFor,
    messages: screening.messages || [],
    currentQuestionIndex: screening.currentQuestionIndex,
    totalQuestions: screening.questions?.length || 0,
  }
}

function findShortlistByScreeningInvite(request, response) {
  const shortlist = state.shortlists.find((item) => item.id === request.params.id)
  const token = String(request.query.token || request.body.token || '').trim()

  if (!shortlist?.aiScreening) {
    response.status(404).json({ error: 'Screening invitation not found' })
    return null
  }

  if (!token || token !== shortlist.aiScreening.inviteToken) {
    response.status(403).json({ error: 'Invalid or expired screening link' })
    return null
  }

  return shortlist
}

const defaultState = {
  roles: [
    {
      id: 'admin',
      label: 'Management Admin',
      access: 'Full company dashboard, payroll, employees, analytics',
    },
    {
      id: 'manager',
      label: 'Senior Manager',
      access: 'Team attendance, performance, approvals',
    },
    {
      id: 'recruiter',
      label: 'HR Recruiter',
      access: 'Jobs, candidates, interviews, AI screening',
    },
    {
      id: 'employee',
      label: 'Employee',
      access: 'Own attendance, salary slips, leave, profile',
    },
  ],
  permissions: {
    admin: ['dashboard', 'people', 'attendance', 'leave', 'payroll', 'recruitment', 'salary', 'teamup', 'ai'],
    manager: ['dashboard', 'people', 'attendance', 'leave', 'salary', 'teamup', 'ai'],
    recruiter: ['dashboard', 'people', 'leave', 'recruitment', 'salary', 'teamup', 'ai'],
    employee: ['dashboard', 'attendance', 'leave', 'payroll', 'salary', 'teamup', 'ai'],
  },
  employees: [
    createEmployee('Aarav Mehta', 'Senior Frontend Engineer', 'Product', 'Nisha Rao', 96, 8, 186000, 92),
    createEmployee('Priya Nair', 'People Operations Lead', 'HR', 'Meera Iyer', 98, 12, 142000, 89),
    createEmployee('Kabir Singh', 'Sales Manager', 'Revenue', 'Nisha Rao', 88, 4, 134000, 84, 'On leave'),
    createEmployee('Sara Khan', 'Data Analyst', 'Analytics', 'Dev Arora', 91, 6, 118000, 87),
  ],
  attendance: [],
  performance: [],
  payroll: [],
  salarySlips: [
    { id: 'slip-may-2026', month: 'May 2026', employee: 'Aarav Mehta', gross: 186000, net: 151940 },
    { id: 'slip-apr-2026', month: 'April 2026', employee: 'Aarav Mehta', gross: 186000, net: 151940 },
    { id: 'slip-mar-2026', month: 'March 2026', employee: 'Aarav Mehta', gross: 184000, net: 150320 },
  ],
  payrollApprovals: [
    {
      id: 'payroll-approval-jun-2026',
      month: 'June 2026',
      employees: 4,
      grossTotal: 580000,
      deductions: 112460,
      netTotal: 467540,
      status: 'Pending',
      requestedBy: 'Priya Nair',
      reviewedBy: null,
    },
  ],
  leaveRequests: [
    { id: 'leave-1', person: 'Sara Khan', type: 'Casual leave', dates: 'Jun 12-13', status: 'Pending', approver: null },
    { id: 'leave-2', person: 'Kabir Singh', type: 'Medical leave', dates: 'Jun 3-5', status: 'Approved', approver: 'Nisha Rao' },
    { id: 'leave-3', person: 'Aarav Mehta', type: 'Work from home', dates: 'Jun 7', status: 'Pending', approver: null },
  ],
  jobs: [
    {
      id: 'job-ai-product-engineer',
      title: 'AI Product Engineer',
      department: 'Product',
      applicants: 64,
      skills: ['React', 'Node.js', 'Python', 'LLM workflows'],
      description: 'Build AI-enabled HR workflows, dashboards, and automation services.',
    },
    {
      id: 'job-hr-business-partner',
      title: 'HR Business Partner',
      department: 'People',
      applicants: 31,
      skills: ['Employee relations', 'Payroll', 'Policy', 'Analytics'],
      description: 'Support people operations, policy rollout, and employee relations programs.',
    },
    {
      id: 'job-backend-platform-lead',
      title: 'Backend Platform Lead',
      department: 'Engineering',
      applicants: 48,
      skills: ['PostgreSQL', 'Express', 'Redis', 'AWS'],
      description: 'Lead backend platform services for payroll, attendance, and HR integrations.',
    },
  ],
  candidate: {
    name: 'Rhea Sharma',
    email: 'rhea.sharma@example.com',
    phone: '+91 98765 43210',
    fileName: 'rhea-sharma-resume.pdf',
    skills: ['React', 'Python', 'PostgreSQL', 'Payroll automation', 'Analytics'],
    education: 'B.Tech Computer Science',
    experience: '5 years in HR technology products',
    summary: 'Product engineer with HR tech, analytics, and payroll automation experience.',
    strengths: ['Strong frontend delivery', 'Comfortable with HR data', 'Can work with Python services'],
  },
  candidateResults: [],
  notifications: [
    { id: 'n-1', text: 'June payroll is ready for management approval.', read: false },
    { id: 'n-2', text: '2 leave requests need action.', read: false },
    { id: 'n-3', text: 'Candidate Rhea Sharma has a new AI match score.', read: true },
  ],
  documents: [
    {
      id: 'doc-1',
      title: 'Offer letters',
      text: '142 uploaded',
      category: 'Hiring',
      uploadedBy: 'Priya Nair',
      acknowledgedBy: [],
      content: 'Offer letter repository summary for active and pending hires.',
    },
    {
      id: 'doc-2',
      title: 'Identity docs',
      text: '96% verified',
      category: 'Compliance',
      uploadedBy: 'Meera Iyer',
      acknowledgedBy: [],
      content: 'Identity document verification tracker for employee records.',
    },
    {
      id: 'doc-3',
      title: 'Policy acknowledgements',
      text: '22 pending',
      category: 'Policy',
      uploadedBy: 'Nisha Rao',
      acknowledgedBy: [],
      content: 'Hybrid attendance policy acknowledgement tracker.',
    },
  ],
  announcements: [
    { id: 'a-1', title: 'Payroll lock', text: 'June payroll closes today at 6:00 PM.' },
    { id: 'a-2', title: 'Policy update', text: 'Hybrid attendance policy is pending acknowledgement.' },
    { id: 'a-3', title: 'Review cycle', text: 'Manager review submissions are 72% complete.' },
  ],
  insights: [],
  voiceListening: false,
  syncCount: 0,
  shortlists: [],
  teams: [
    {
      id: 'team-product-sync',
      name: 'Product Sync',
      purpose: 'Daily coordination for product delivery and HR workflow blockers.',
      createdBy: 'Nisha Rao',
      members: ['Aarav Mehta', 'Priya Nair', 'Sara Khan'],
      messages: [
        {
          id: 'msg-1',
          author: 'Nisha Rao',
          text: 'Please share blockers before the afternoon review.',
          createdAt: 'Jun 1, 2026 10:00 AM',
        },
      ],
    },
  ],
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value))
}

let state = cloneData(defaultState)
let saveStateQueue = Promise.resolve()
let moduleRecordSyncWarningShown = false

function mergeWithDefaultState(data) {
  const merged = {
    ...cloneData(defaultState),
    ...(data || {}),
  }

  merged.permissions = {
    ...cloneData(defaultState.permissions),
    ...(data?.permissions || {}),
  }
  merged.permissions.recruiter = Array.from(new Set([
    ...merged.permissions.recruiter,
    'leave',
  ]))
  merged.employees = (merged.employees || []).map((employee) => ({
    ...employee,
    leaveAllocation: {
      ...cloneData(defaultLeaveAllocation),
      ...(employee.leaveAllocation || {}),
      special: {
        ...cloneData(defaultLeaveAllocation.special),
        ...(employee.leaveAllocation?.special || {}),
      },
    },
  }))

  return merged
}

function parseCsvLine(line) {
  const values = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const nextCharacter = line[index + 1]

    if (character === '"' && quoted && nextCharacter === '"') {
      current += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      values.push(current)
      current = ''
    } else {
      current += character
    }
  }

  values.push(current)
  return values
}

function loadAnalyticsSeedRows() {
  const [headerLine, ...lines] = readFileSync(analyticsSeedPath, 'utf8').trim().split(/\r?\n/)
  const headers = parseCsvLine(headerLine)

  return lines
    .filter((line) => line.trim())
    .map((line) => {
      const values = parseCsvLine(line)
      return headers.reduce((record, header, index) => ({
        ...record,
        [header]: values[index] || '',
      }), {})
    })
}

function analyticsRecordFromCsv(row) {
  if (row.category === 'attendance') {
    return {
      day: row.day,
      present: Number(row.present || 0),
      late: Number(row.late || 0),
    }
  }

  if (row.category === 'performance') {
    return {
      month: row.month,
      score: Number(row.score || 0),
      productivity: Number(row.productivity || 0),
    }
  }

  if (row.category === 'payroll') {
    return {
      month: row.month,
      payroll: Number(row.payroll || 0),
    }
  }

  return {
    id: row.record_key,
    scopeType: row.scope_type,
    scopeName: row.scope_name,
    severity: row.severity,
    owner: row.owner,
    title: row.title,
    signal: row.signal,
    attentionPoint: row.attention_point,
    recommendedAction: row.recommended_action,
  }
}

function applyAnalyticsRows(rows) {
  const grouped = {
    attendance: [],
    performance: [],
    payroll: [],
    insights: [],
  }

  rows
    .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0))
    .forEach((row) => {
      const category = row.category
      const record = row.data || analyticsRecordFromCsv(row)

      if (grouped[category]) {
        grouped[category].push(record)
      }
    })

  state.attendance = grouped.attendance
  state.performance = grouped.performance
  state.payroll = grouped.payroll
  state.insights = grouped.insights
}

function loadAnalyticsFromCsvFallback() {
  applyAnalyticsRows(loadAnalyticsSeedRows())
}

async function seedAnalyticsFromCsvToSupabase() {
  if (!supabaseAdmin) {
    loadAnalyticsFromCsvFallback()
    return
  }

  const { count, error: countError } = await supabaseAdmin
    .from('hrms_analytics_records')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', appStateId)

  if (countError) {
    console.warn(`[analytics] Could not check Supabase analytics records: ${countError.message}`)
    return
  }

  if (count > 0) {
    return
  }

  const rows = loadAnalyticsSeedRows().map((row) => ({
    company_id: appStateId,
    category: row.category,
    record_key: row.record_key,
    sort_order: Number(row.sort_order || 0),
    data: analyticsRecordFromCsv(row),
    source: 'csv',
    updated_at: new Date().toISOString(),
  }))

  const { error } = await supabaseAdmin
    .from('hrms_analytics_records')
    .upsert(rows, { onConflict: 'company_id,category,record_key' })

  if (error) {
    console.warn(`[analytics] Could not seed analytics CSV into Supabase: ${error.message}`)
  }
}

async function loadAnalyticsFromSupabase() {
  if (!supabaseAdmin) {
    return
  }

  await seedAnalyticsFromCsvToSupabase()

  const { data, error } = await supabaseAdmin
    .from('hrms_analytics_records')
    .select('category, data, sort_order')
    .eq('company_id', appStateId)
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })

  if (error) {
    console.warn(`[analytics] Could not load analytics from Supabase: ${error.message}`)
    loadAnalyticsFromCsvFallback()
    return
  }

  applyAnalyticsRows(data || [])
}

function moduleRecordCollections(snapshot) {
  return [
    ['employees', snapshot.employees],
    ['attendance', snapshot.attendance],
    ['performance', snapshot.performance],
    ['payroll', snapshot.payroll],
    ['salarySlips', snapshot.salarySlips],
    ['payrollApprovals', snapshot.payrollApprovals],
    ['leaveRequests', snapshot.leaveRequests],
    ['jobs', snapshot.jobs],
    ['candidateResults', snapshot.candidateResults],
    ['notifications', snapshot.notifications],
    ['documents', snapshot.documents],
    ['announcements', snapshot.announcements],
    ['insights', snapshot.insights],
    ['shortlists', snapshot.shortlists],
    ['candidateScreenings', (snapshot.shortlists || [])
      .filter((shortlist) => shortlist.aiScreening)
      .map((shortlist) => ({
        ...shortlist.aiScreening,
        shortlistId: shortlist.id,
        candidate: shortlist.candidate,
        email: shortlist.email,
      }))],
    ['teams', snapshot.teams],
    ['teamMessages', (snapshot.teams || []).flatMap((team) =>
      (team.messages || []).map((message) => ({
        ...message,
        teamId: team.id,
        teamName: team.name,
      })),
    )],
    ['candidate', snapshot.candidate ? [snapshot.candidate] : []],
    ['voiceState', [{ id: 'voice-listening', listening: Boolean(snapshot.voiceListening) }]],
  ]
}

function moduleRecordId(module, record, index) {
  return String(
    record?.id ||
      record?.employeeCode ||
      record?.fileName ||
      record?.month ||
      record?.day ||
      record?.title ||
      `${module}-${index + 1}`,
  )
}

async function syncModuleRecordsToSupabase(snapshot) {
  if (!supabaseAdmin) {
    return
  }

  const collections = moduleRecordCollections(snapshot)

  for (const [module, records] of collections) {
    const normalizedRecords = Array.isArray(records) ? records : []
    const rows = normalizedRecords.map((record, index) => ({
      company_id: appStateId,
      module,
      record_id: moduleRecordId(module, record, index),
      data: record,
      updated_at: new Date().toISOString(),
    }))

    if (rows.length) {
      const { error } = await supabaseAdmin
        .from('hrms_module_records')
        .upsert(rows, { onConflict: 'company_id,module,record_id' })

      if (error) {
        if (!moduleRecordSyncWarningShown) {
          console.warn(`[storage] Could not sync module records to Supabase: ${error.message}`)
          moduleRecordSyncWarningShown = true
        }
        return
      }
    }

    const { data: existingRecords, error: readError } = await supabaseAdmin
      .from('hrms_module_records')
      .select('record_id')
      .eq('company_id', appStateId)
      .eq('module', module)

    if (readError) {
      if (!moduleRecordSyncWarningShown) {
        console.warn(`[storage] Could not read module records from Supabase: ${readError.message}`)
        moduleRecordSyncWarningShown = true
      }
      return
    }

    const currentIds = new Set(rows.map((row) => row.record_id))
    const staleIds = (existingRecords || [])
      .map((record) => record.record_id)
      .filter((recordId) => !currentIds.has(recordId))

    if (staleIds.length) {
      const { error: deleteError } = await supabaseAdmin
        .from('hrms_module_records')
        .delete()
        .eq('company_id', appStateId)
        .eq('module', module)
        .in('record_id', staleIds)

      if (deleteError && !moduleRecordSyncWarningShown) {
        console.warn(`[storage] Could not delete stale module records from Supabase: ${deleteError.message}`)
        moduleRecordSyncWarningShown = true
      }
    }
  }
}

async function loadHrmsStateFromSupabase() {
  if (!supabaseAdmin) {
    console.warn('[storage] SUPABASE_SERVICE_ROLE_KEY is missing. HRMS data is not being persisted to Supabase yet.')
    return
  }

  const { data, error } = await supabaseAdmin
    .from('hrms_app_state')
    .select('data, updated_at')
    .eq('id', appStateId)
    .maybeSingle()

  if (error) {
    console.warn(`[storage] Could not load HRMS state from Supabase: ${error.message}`)
    return
  }

  if (data?.data) {
    state = mergeWithDefaultState(data.data)
    lastSupabaseStateUpdatedAt = data.updated_at || null
    console.log('[storage] HRMS state loaded from Supabase.')
    return
  }

  await saveHrmsStateToSupabase()
  console.log('[storage] Initial HRMS state seeded into Supabase.')
}

function saveHrmsStateToSupabase() {
  if (!supabaseAdmin) {
    return saveStateQueue
  }

  const snapshot = cloneData(state)
  saveStateQueue = saveStateQueue
    .then(async () => {
      const updatedAt = new Date().toISOString()
      const { error } = await supabaseAdmin
        .from('hrms_app_state')
        .upsert({
          id: appStateId,
          data: snapshot,
          updated_at: updatedAt,
        })

      if (error) {
        console.warn(`[storage] Could not save HRMS state to Supabase: ${error.message}`)
        return
      }

      lastSupabaseStateUpdatedAt = updatedAt
      await syncNotificationsToSupabase(snapshot.notifications || [])
      await syncModuleRecordsToSupabase(snapshot)
    })
    .catch((error) => {
      console.warn(`[storage] Supabase save queue failed: ${error.message}`)
    })

  return saveStateQueue
}

async function pullExternalSupabaseStateChanges() {
  if (!supabaseAdmin) {
    return
  }

  const { data, error } = await supabaseAdmin
    .from('hrms_app_state')
    .select('data, updated_at')
    .eq('id', appStateId)
    .maybeSingle()

  if (error) {
    console.warn(`[storage] Could not check Supabase live state: ${error.message}`)
    return
  }

  if (!data?.data || !data.updated_at || data.updated_at === lastSupabaseStateUpdatedAt) {
    return
  }

  if (lastSupabaseStateUpdatedAt && new Date(data.updated_at) <= new Date(lastSupabaseStateUpdatedAt)) {
    return
  }

  state = mergeWithDefaultState(data.data)
  await loadAnalyticsFromSupabase()
  updateEmployeeStatusesFromLeaveRequests()
  lastSupabaseStateUpdatedAt = data.updated_at
  broadcastRealtimeState('supabase:external-change')
}

function createEmployee(name, role, department, manager, attendance, leaves, monthlyGrossSalary, performance, status = 'Active', annualCtc = null, cabChargesMonthly = 0, workEmail = '', loginAccess = null) {
  const id = name.toLowerCase().replaceAll(' ', '-')
  const employeeCode = createEmployeeCode(name)
  const salaryDetails = calculateSalaryStructure(annualCtc || monthlyGrossSalary * 12, cabChargesMonthly)
  return {
    id,
    employeeCode,
    name,
    workEmail: normalizeWorkEmail(workEmail, name, employeeCode),
    role,
    department,
    manager,
    status,
    attendance,
    leaves,
    leaveAllocation: cloneData(defaultLeaveAllocation),
    ctc: salaryDetails.annualCtc,
    salary: salaryDetails.monthlyGross,
    salaryDetails,
    performance,
    performanceDetails: createPerformanceDetails(performance, status),
    loginAccess,
  }
}

function slugifyEmailPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

function normalizeWorkEmail(workEmail, name, employeeCode) {
  const email = String(workEmail || '').trim().toLowerCase()
  if (email) {
    return email
  }

  return `${slugifyEmailPart(name) || 'employee'}.${employeeCode.toLowerCase()}@aihrms.local`
}

function createEmployeeCode(name) {
  const hash = Array.from(name).reduce((sum, character) => sum + character.charCodeAt(0), 0)
  return `EMP-${String(1000 + (hash % 9000)).padStart(4, '0')}`
}

async function syncEmployeeToSupabase(employee) {
  if (!supabaseAdmin) {
    return
  }

  const { error } = await supabaseAdmin
    .from('employees')
    .upsert({
      employee_code: employee.employeeCode,
      full_name: employee.name,
      work_email: normalizeWorkEmail(employee.workEmail, employee.name, employee.employeeCode),
      job_title: employee.role,
      department: employee.department,
      annual_ctc: employee.ctc || employee.salaryDetails?.annualCtc || 0,
      monthly_cab_charges: employee.salaryDetails?.monthlyCabCharges || 0,
      status: employee.status || 'Active',
      performance: {
        score: employee.performance || 0,
        details: employee.performanceDetails || {},
        attendance: employee.attendance || 0,
        leave_balance: employee.leaves || 0,
        leave_allocation: employee.leaveAllocation || cloneData(defaultLeaveAllocation),
        manager: employee.manager || '',
        salary: employee.salaryDetails || {},
        login_access: employee.loginAccess || null,
      },
    }, {
      onConflict: 'employee_code',
    })

  if (error) {
    console.warn(`[storage] Could not sync employee ${employee.employeeCode} to Supabase employees table: ${error.message}`)
  }
}

async function syncEmployeesToSupabase() {
  if (!supabaseAdmin) {
    return
  }

  await Promise.all(state.employees.map((employee) => syncEmployeeToSupabase(employee)))
}

function leaveTypeForSupabase(type) {
  const normalized = String(type || '').toLowerCase()
  if (normalized.includes('work from home')) return 'work_from_home'
  if (normalized.includes('special')) return 'special_leave'
  return 'leave'
}

function leaveStatusForSupabase(status) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'approved') return 'approved'
  if (normalized === 'cancelled') return 'cancelled'
  if (normalized === 'withdrawn') return 'withdrawn'
  return 'pending'
}

function currentDateIso() {
  return new Date().toISOString().slice(0, 10)
}

function parseLeaveDate(value) {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function parseLegacyLeaveDates(dates) {
  const match = String(dates || '').match(/^([A-Za-z]{3})\s+(\d{1,2})(?:-(\d{1,2}))?/)
  if (!match) {
    return { startDate: null, endDate: null }
  }

  const [, month, startDay, endDay] = match
  const year = new Date().getFullYear()
  const startDate = parseLeaveDate(`${month} ${startDay}, ${year}`)
  const endDate = parseLeaveDate(`${month} ${endDay || startDay}, ${year}`)

  return { startDate, endDate }
}

function leaveDateRange(leave) {
  const legacyRange = parseLegacyLeaveDates(leave.dates)
  return {
    startDate: parseLeaveDate(leave.startDate) || legacyRange.startDate,
    endDate: parseLeaveDate(leave.endDate) || legacyRange.endDate,
  }
}

function updateEmployeeStatusesFromLeaveRequests() {
  const today = currentDateIso()

  state.employees = state.employees.map((employee) => {
    const isOnLeaveToday = state.leaveRequests.some((leave) => {
      const { startDate, endDate } = leaveDateRange(leave)
      return (
        leave.person === employee.name &&
        leave.status === 'Approved' &&
        leaveTypeForSupabase(leave.requestType || leave.type) !== 'work_from_home' &&
        startDate &&
        endDate &&
        startDate <= today &&
        today <= endDate
      )
    })

    return {
      ...employee,
      status: isOnLeaveToday ? 'On leave' : 'Active',
    }
  })
}

async function syncLeaveRequestToSupabase(leave) {
  if (!supabaseAdmin) {
    return
  }

  const decided = ['Approved', 'Cancelled'].includes(leave.status)
  const { error } = await supabaseAdmin
    .from('leave_requests')
    .upsert({
      app_record_id: leave.id,
      request_date: leave.requestedOn || new Date().toISOString().slice(0, 10),
      start_date: leave.startDate || leave.requestedOn || new Date().toISOString().slice(0, 10),
      end_date: leave.endDate || leave.startDate || leave.requestedOn || new Date().toISOString().slice(0, 10),
      leave_type: leaveTypeForSupabase(leave.requestType || leave.type),
      special_category: leave.specialCategory || null,
      reason: `${leave.person} requested ${leave.type || 'leave'}`,
      status: leaveStatusForSupabase(leave.status),
      decided_at: decided ? new Date().toISOString() : null,
    }, {
      onConflict: 'app_record_id',
    })

  if (error) {
    console.warn(`[storage] Could not sync leave request ${leave.id} to Supabase leave_requests table: ${error.message}`)
  }
}

async function syncLeaveRequestsToSupabase() {
  if (!supabaseAdmin) {
    return
  }

  await Promise.all(state.leaveRequests.map((leave) => syncLeaveRequestToSupabase(leave)))

  const currentIds = state.leaveRequests.map((leave) => leave.id)
  if (currentIds.length === 0) {
    return
  }

  const { error } = await supabaseAdmin
    .from('leave_requests')
    .delete()
    .not('app_record_id', 'in', `(${currentIds.map((id) => `"${id}"`).join(',')})`)
    .not('app_record_id', 'is', null)

  if (error) {
    console.warn(`[storage] Could not remove stale Supabase leave request rows: ${error.message}`)
  }
}

async function syncShortlistedCandidateToSupabase(shortlist) {
  if (!supabaseAdmin) {
    return
  }

  const { error } = await supabaseAdmin
    .from('shortlisted_candidates')
    .upsert({
      app_record_id: shortlist.id,
      candidate_name: shortlist.candidate,
      candidate_email: shortlist.email,
      match_score: Number(shortlist.score || 0),
      resume_summary: {
        phone: shortlist.phone,
        fileName: shortlist.fileName,
        summary: shortlist.summary,
        skills: shortlist.skills || [],
        appliedFor: shortlist.appliedFor,
        matchedFor: shortlist.bestRole || shortlist.jobTitle,
        jobTitle: shortlist.jobTitle,
        roleMatches: shortlist.roleMatches || [],
        status: shortlist.status,
        notified: Boolean(shortlist.notified),
        notifiedAt: shortlist.notifiedAt,
        videoInterview: shortlist.videoInterview || null,
        selected: Boolean(shortlist.selected),
        selectedBy: shortlist.selectedBy || null,
        selectedAt: shortlist.selectedAt || null,
        selectionNote: shortlist.selectionNote || null,
      },
      notified_at: shortlist.notifiedAt ? new Date().toISOString() : null,
    }, {
      onConflict: 'app_record_id',
    })

  if (error) {
    console.warn(`[storage] Could not sync shortlisted candidate ${shortlist.id} to Supabase shortlisted_candidates table: ${error.message}`)
  }
}

async function syncShortlistedCandidatesToSupabase() {
  if (!supabaseAdmin) {
    return
  }

  await Promise.all(state.shortlists.map((shortlist) => syncShortlistedCandidateToSupabase(shortlist)))

  const currentIds = state.shortlists.map((shortlist) => shortlist.id)
  if (currentIds.length === 0) {
    const { error } = await supabaseAdmin
      .from('shortlisted_candidates')
      .delete()
      .not('app_record_id', 'is', null)

    if (error) {
      console.warn(`[storage] Could not clear Supabase shortlisted candidate rows: ${error.message}`)
    }
    return
  }

  const { error } = await supabaseAdmin
    .from('shortlisted_candidates')
    .delete()
    .not('app_record_id', 'in', `(${currentIds.map((id) => `"${id}"`).join(',')})`)
    .not('app_record_id', 'is', null)

  if (error) {
    console.warn(`[storage] Could not remove stale Supabase shortlisted candidate rows: ${error.message}`)
  }
}

async function syncAnnouncementToSupabase(announcement) {
  if (!supabaseAdmin) {
    return
  }

  const { error } = await supabaseAdmin
    .from('announcements')
    .upsert({
      app_record_id: announcement.id,
      title: announcement.title,
      body: announcement.text,
    }, {
      onConflict: 'app_record_id',
    })

  if (error) {
    console.warn(`[storage] Could not sync announcement ${announcement.id} to Supabase announcements table: ${error.message}`)
  }
}

async function syncAnnouncementsToSupabase() {
  if (!supabaseAdmin) {
    return
  }

  await Promise.all(state.announcements.map((announcement) => syncAnnouncementToSupabase(announcement)))

  const currentIds = state.announcements.map((announcement) => announcement.id)
  if (currentIds.length === 0) {
    const { error } = await supabaseAdmin
      .from('announcements')
      .delete()
      .not('app_record_id', 'is', null)

    if (error) {
      console.warn(`[storage] Could not clear Supabase announcement rows: ${error.message}`)
    }
    return
  }

  const { error } = await supabaseAdmin
    .from('announcements')
    .delete()
    .not('app_record_id', 'in', `(${currentIds.map((id) => `"${id}"`).join(',')})`)
    .not('app_record_id', 'is', null)

  if (error) {
    console.warn(`[storage] Could not remove stale Supabase announcement rows: ${error.message}`)
  }
}

async function syncNotificationToSupabase(notification) {
  if (!supabaseAdmin) {
    return
  }

  const text = String(notification.text || 'Notification')
  const { error } = await supabaseAdmin
    .from('notifications')
    .upsert({
      app_record_id: notification.id,
      title: text.slice(0, 120),
      body: text,
      is_read: Boolean(notification.read),
    }, {
      onConflict: 'app_record_id',
    })

  if (error) {
    console.warn(`[storage] Could not sync notification ${notification.id} to Supabase notifications table: ${error.message}`)
  }
}

async function syncNotificationsToSupabase(notifications = state.notifications) {
  if (!supabaseAdmin) {
    return
  }

  await Promise.all(notifications.map((notification) => syncNotificationToSupabase(notification)))

  const currentIds = notifications.map((notification) => notification.id)
  if (currentIds.length === 0) {
    const { error } = await supabaseAdmin
      .from('notifications')
      .delete()
      .not('app_record_id', 'is', null)

    if (error) {
      console.warn(`[storage] Could not clear Supabase notification rows: ${error.message}`)
    }
    return
  }

  const { error } = await supabaseAdmin
    .from('notifications')
    .delete()
    .not('app_record_id', 'in', `(${currentIds.map((id) => `"${id}"`).join(',')})`)
    .not('app_record_id', 'is', null)

  if (error) {
    console.warn(`[storage] Could not remove stale Supabase notification rows: ${error.message}`)
  }
}

async function syncJobToSupabase(job) {
  if (!supabaseAdmin) {
    return
  }

  const { error } = await supabaseAdmin
    .from('jobs')
    .upsert({
      app_record_id: job.id,
      title: job.title,
      department: job.department,
      skills: job.skills || [],
      description: job.description || '',
      status: job.status || 'Open',
    }, {
      onConflict: 'app_record_id',
    })

  if (error) {
    console.warn(`[storage] Could not sync job ${job.id} to Supabase jobs table: ${error.message}`)
  }
}

async function syncJobsToSupabase() {
  if (!supabaseAdmin) {
    return
  }

  await Promise.all(state.jobs.map((job) => syncJobToSupabase(job)))

  const currentIds = state.jobs.map((job) => job.id)
  if (!currentIds.length) {
    return
  }

  const { error } = await supabaseAdmin
    .from('jobs')
    .delete()
    .not('app_record_id', 'in', `(${currentIds.map((id) => `"${id}"`).join(',')})`)
    .not('app_record_id', 'is', null)

  if (error) {
    console.warn(`[storage] Could not remove stale Supabase job rows: ${error.message}`)
  }
}

async function syncSalarySlipToSupabase(slip, status = 'approved') {
  if (!supabaseAdmin) {
    return
  }

  const { error } = await supabaseAdmin
    .from('salary_slips')
    .upsert({
      app_record_id: slip.id,
      month: slip.month,
      annual_ctc: slip.salaryDetails?.annualCtc || Number(slip.gross || 0) * 12,
      salary_breakup: {
        employee: slip.employee,
        employeeCode: slip.employeeCode,
        gross: slip.gross,
        deductions: slip.deductions || 0,
        net: slip.net,
        salaryDetails: slip.salaryDetails || {},
      },
      status,
      approved_at: status === 'approved' ? new Date().toISOString() : null,
    }, {
      onConflict: 'app_record_id',
    })

  if (error) {
    console.warn(`[storage] Could not sync salary slip ${slip.id} to Supabase salary_slips table: ${error.message}`)
  }
}

async function syncSalarySlipsToSupabase() {
  if (!supabaseAdmin) {
    return
  }

  await Promise.all(state.salarySlips.map((slip) => syncSalarySlipToSupabase(slip)))

  const currentIds = state.salarySlips.map((slip) => slip.id)
  if (!currentIds.length) {
    return
  }

  const { error } = await supabaseAdmin
    .from('salary_slips')
    .delete()
    .not('app_record_id', 'in', `(${currentIds.map((id) => `"${id}"`).join(',')})`)
    .not('app_record_id', 'is', null)

  if (error) {
    console.warn(`[storage] Could not remove stale Supabase salary slip rows: ${error.message}`)
  }
}

function createPerformanceDetails(score, status) {
  if (status === 'New hire' || score === 0) {
    return {
      rating: 'Not reviewed',
      reviewCycle: 'First review pending',
      focusArea: 'Onboarding goals to be assigned',
    }
  }

  if (score >= 90) {
    return {
      rating: 'Exceeds expectations',
      reviewCycle: 'June 2026',
      focusArea: 'Leadership readiness and mentoring',
    }
  }

  if (score >= 80) {
    return {
      rating: 'Meets expectations',
      reviewCycle: 'June 2026',
      focusArea: 'Consistent delivery and skill growth',
    }
  }

  return {
    rating: 'Needs attention',
    reviewCycle: 'June 2026',
    focusArea: 'Manager coaching and goal alignment',
  }
}

function calculateSalaryStructure(annualCtc, cabChargesMonthly = 0) {
  const fixedCtc = Math.max(0, Number(annualCtc || 0))
  const monthlyCabCharges = Math.max(0, Number(cabChargesMonthly || 0))
  const basicAnnual = Math.round(fixedCtc * 0.4)
  const hraAnnual = Math.round(basicAnnual * 0.4)
  const employerPfAnnual = Math.min(Math.round(basicAnnual * 0.12), 21600)
  const employeePfAnnual = employerPfAnnual
  const professionalTaxAnnual = 2400
  const incomeTaxAnnual = 0
  const specialAllowanceAnnual = Math.max(0, fixedCtc - basicAnnual - hraAnnual - employerPfAnnual)
  const monthlyGross = Math.round((basicAnnual + hraAnnual + specialAllowanceAnnual) / 12)
  const cabChargesAnnual = monthlyCabCharges * 12
  const monthlyDeductions = Math.round((employeePfAnnual + professionalTaxAnnual + incomeTaxAnnual + cabChargesAnnual) / 12)

  return {
    annualCtc: fixedCtc,
    basicAnnual,
    hraAnnual,
    specialAllowanceAnnual,
    employerPfAnnual,
    employeePfAnnual,
    professionalTaxAnnual,
    incomeTaxAnnual,
    cabChargesAnnual,
    monthlyCabCharges,
    monthlyGross,
    monthlyDeductions,
    monthlyTakeHome: Math.max(0, monthlyGross - monthlyDeductions),
  }
}

function formatMoney(value) {
  return `Rs. ${Number(value).toLocaleString('en-IN')}`
}

function dashboardMetrics() {
  const employeeCount = state.employees.length
  const attendanceAverage = Math.round(
    state.employees.reduce((sum, employee) => sum + employee.attendance, 0) / employeeCount,
  )
  const performanceAverage = Math.round(
    state.employees.reduce((sum, employee) => sum + employee.performance, 0) / employeeCount,
  )
  const monthlyPayroll = state.employees.reduce((sum, employee) => sum + employee.salaryDetails.monthlyGross, 0)

  return [
    { id: 'employees', label: 'Employees', value: String(employeeCount), detail: '+12 this quarter' },
    { id: 'attendance', label: 'Attendance', value: `${attendanceAverage}%`, detail: 'Live company average' },
    { id: 'payroll', label: 'Monthly payroll', value: formatMoney(monthlyPayroll), detail: 'Ready for approval' },
    { id: 'performance', label: 'Performance', value: String(performanceAverage), detail: 'Company average score' },
  ]
}

function normalizeSkillList(source) {
  return Array.isArray(source)
    ? source.map((skill) => String(skill).trim()).filter(Boolean)
    : String(source || '')
      .split(',')
      .map((skill) => skill.trim())
      .filter(Boolean)
}

function matchCandidate(jobDescription, candidate = state.candidate) {
  const requested = normalizeSkillList(jobDescription)
  const candidateSkillText = normalizeSkillList(candidate.skills).join(' ').toLowerCase()
  const candidateResumeText = String(candidate.resumeText || '').toLowerCase()
  const matched = requested.filter((skill) => skillMatchesCandidate(skill, candidateSkillText, candidateResumeText))
  const partial = requested.filter((skill) => !matched.includes(skill) && partialSkillMatchesCandidate(skill, candidateResumeText))
  const score = requested.length ? Math.round(((matched.length + partial.length * 0.5) / requested.length) * 100) : 0
  const missing = requested.filter((skill) => !matched.includes(skill))

  return {
    score: Math.min(100, score),
    matched,
    partial,
    missing,
    summary: candidate.summary,
    strengths: candidate.strengths,
    recommendation:
      score >= 70
        ? 'Recommended for HR review and structured interview.'
        : 'Needs HR review for transferable skills before interview decision.',
  }
}

function skillMatchesCandidate(skill, candidateSkillText, candidateResumeText) {
  const normalizedSkill = normalizeSkillToken(skill)
  const aliases = skillAliases(normalizedSkill)
  return aliases.some((alias) => {
    const escaped = escapeRegExp(alias)
    return (
      new RegExp(`(^|\\b)${escaped}(\\b|$)`, 'i').test(candidateSkillText) ||
      new RegExp(`(^|\\b)${escaped}(\\b|$)`, 'i').test(candidateResumeText)
    )
  })
}

function partialSkillMatchesCandidate(skill, candidateResumeText) {
  return normalizeSkillToken(skill)
    .split(/\s+/)
    .filter((part) => part.length > 2)
    .some((part) => new RegExp(`\\b${escapeRegExp(part)}\\b`, 'i').test(candidateResumeText))
}

function normalizeSkillToken(skill) {
  return String(skill || '').toLowerCase().replace(/[^a-z0-9+#. ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function skillAliases(skill) {
  const aliasMap = {
    'node.js': ['node.js', 'nodejs', 'node'],
    postgresql: ['postgresql', 'postgres', 'psql'],
    'llm workflows': ['llm workflows', 'llm', 'large language model'],
    'hr analytics': ['hr analytics', 'people analytics', 'workforce analytics'],
    'payroll automation': ['payroll automation', 'payroll'],
    'employee relations': ['employee relations', 'people relations'],
    aws: ['aws', 'amazon web services'],
  }

  return aliasMap[skill] || [skill]
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchCandidateToOpenRoles(candidate) {
  const roleMatches = state.jobs
    .map((job) => ({
      jobId: job.id,
      title: job.title,
      department: job.department,
      skills: job.skills,
      ...matchCandidate(job.skills, candidate),
    }))
    .sort((first, second) => second.score - first.score)

  return {
    roleMatches,
    bestRole: roleMatches[0] || null,
  }
}

function candidateFromText(file, text, baseCandidate = state.candidate) {
  const cleanedText = normalizeText(text)
  const fromFileName = candidateFromFileName(file.originalname, baseCandidate)
  const extractedName = extractName(cleanedText)
  const extractedSkills = inferResumeSkills(`${file.originalname} ${cleanedText}`)
  const extractedEducation = extractEducation(cleanedText)
  const extractedExperience = extractExperience(cleanedText)
  const hasReadableText = cleanedText.length > 40

  return {
    ...fromFileName,
    name: extractedName || fromFileName.name,
    email: extractEmail(cleanedText) || fromFileName.email,
    phone: extractPhone(cleanedText) || fromFileName.phone,
    skills: extractedSkills,
    resumeText: cleanedText,
    education: extractedEducation || fromFileName.education,
    experience: extractedExperience || 'Experience not detected from resume text',
    summary: hasReadableText
      ? buildResumeSummary(cleanedText, extractedSkills, file.originalname)
      : `Could not read enough text from ${file.originalname}; showing best-effort details from the file name and known skill keywords.`,
    strengths: buildStrengths(cleanedText, extractedSkills, hasReadableText),
    parseStatus: hasReadableText ? 'Resume text parsed from uploaded document' : 'Limited text extraction; HR should review the original file',
  }
}

function candidateFromFileName(fileName, baseCandidate = state.candidate) {
  const candidateName = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim()
  const inferredSkills = inferResumeSkills(fileName)

  return {
    ...baseCandidate,
    id: `candidate-${fileName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: candidateName || baseCandidate.name,
    email: `${(candidateName || 'candidate').toLowerCase().replace(/\s+/g, '.')}@example.com`,
    phone: '+91 90000 12345',
    fileName,
    skills: inferredSkills,
    resumeText: fileName,
    education: 'Parsed from uploaded resume',
    experience: 'Experience not detected from resume text',
    summary: `Uploaded resume screened from ${fileName}; extracted ${inferredSkills.length} relevant skills for HR review.`,
    strengths: [
      'Relevant technical skills detected',
      'Resume is ready for human HR review',
      'Candidate profile extracted from uploaded document',
    ],
    parseStatus: 'Demo profile generated from file name',
  }
}

async function extractResumeText(file) {
  const extension = file.originalname.toLowerCase().split('.').pop()

  try {
    if (extension === 'pdf') {
      const parser = new PDFParse({ data: new Uint8Array(file.buffer) })
      const result = await parser.getText()
      await parser.destroy()
      return result.text || ''
    }

    if (extension === 'docx') {
      const result = await mammoth.extractRawText({ buffer: file.buffer })
      return result.value || ''
    }
  } catch (error) {
    console.warn(`Resume text extraction failed for ${file.originalname}: ${error.message}`)
  }

  return extractPlainTextFallback(file.buffer)
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function extractPlainTextFallback(buffer) {
  return normalizeText(
    buffer
      .toString('utf8')
      .replace(/[^\x20-\x7e]+/g, ' ')
      .replace(/\s+/g, ' '),
  )
}

function extractEmail(text) {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || ''
}

function extractPhone(text) {
  return text.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() || ''
}

function extractName(text) {
  const lines = String(text || '')
    .split(/[\r\n]+| {2,}/)
    .map((line) => line.trim())
    .filter(Boolean)
  const ignored = ['resume', 'curriculum vitae', 'profile', 'email', 'phone', 'mobile']
  const line = lines.find((item) => {
    const normalized = item.toLowerCase()
    return (
      item.length >= 3 &&
      item.length <= 60 &&
      !item.includes('@') &&
      !/\d/.test(item) &&
      !ignored.some((word) => normalized.includes(word))
    )
  })

  return line || ''
}

function extractEducation(text) {
  const educationMatch = text.match(
    /\b(B\.?Tech|M\.?Tech|B\.?E\.?|M\.?E\.?|MBA|BBA|BSc|MSc|Bachelor(?:'s)?|Master(?:'s)?|PhD|Diploma)[^.,;]{0,80}/i,
  )
  return educationMatch
    ? educationMatch[0].replace(/\b\d{1,2}\+?\s*(?:years|yrs)\b.*$/i, '').trim()
    : ''
}

function extractExperience(text) {
  const experienceMatch = text.match(
    /\b(\d{1,2}\+?)\s*(?:years|yrs)(?:\s+of)?\s+(?:experience|professional experience|work experience|relevant experience)\b[^.,;]{0,50}/i,
  )
  if (experienceMatch) {
    return experienceMatch[0].trim()
  }

  const reverseExperienceMatch = text.match(
    /\b(?:experience|professional experience|work experience|relevant experience)\s*(?:of|:|-)?\s*(\d{1,2}\+?)\s*(?:years|yrs)\b/i,
  )
  return reverseExperienceMatch ? reverseExperienceMatch[0].trim() : ''
}

function buildResumeSummary(text, skills, fileName) {
  const publicText = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const firstSentence = publicText
    .split(/(?<=[.!?])\s+/)
    .find((sentence) => sentence.length > 35 && sentence.length < 220)
  const skillText = skills.length ? ` Detected skills: ${skills.slice(0, 6).join(', ')}.` : ''
  return `${firstSentence || publicText.slice(0, 180) || `Resume text extracted from ${fileName}.`}${skillText}`
}

function buildStrengths(text, skills, hasReadableText) {
  const strengths = []
  if (skills.length >= 4) strengths.push('Multiple required skills detected in resume text')
  if (/lead|managed|owner|architect|mentor/i.test(text)) strengths.push('Leadership or ownership language detected')
  if (/payroll|attendance|hr|employee|people/i.test(text)) strengths.push('Relevant HR domain experience detected')
  if (!strengths.length && hasReadableText) strengths.push('Readable resume content available for HR review')
  return strengths.length ? strengths : ['Resume needs manual HR review for full qualification check']
}

function inferResumeSkills(sourceText) {
  const normalized = sourceText.toLowerCase()
  const skillMap = [
    [/\breact(?:\.js)?\b/, 'React'],
    [/\bjavascript\b|\bjs\b/, 'JavaScript'],
    [/\btypescript\b|\bts\b/, 'TypeScript'],
    [/\bnode(?:\.js|js)?\b/, 'Node.js'],
    [/\bexpress(?:\.js)?\b/, 'Express'],
    [/\bpython\b/, 'Python'],
    [/\bpostgres(?:ql)?\b|\bpsql\b/, 'PostgreSQL'],
    [/\bmysql\b/, 'MySQL'],
    [/\bsql\b/, 'SQL'],
    [/\bredis\b/, 'Redis'],
    [/\baws\b|\bamazon web services\b/, 'AWS'],
    [/\bazure\b/, 'Azure'],
    [/\bdocker\b/, 'Docker'],
    [/\bkubernetes\b|\bk8s\b/, 'Kubernetes'],
    [/\bhr analytics\b|\bpeople analytics\b|\bworkforce analytics\b/, 'HR analytics'],
    [/\bpayroll automation\b|\bpayroll\b/, 'Payroll automation'],
    [/\bemployee relations\b|\bpeople relations\b/, 'Employee relations'],
    [/\bpolicy\b|\bpolicies\b/, 'Policy'],
    [/\banalytics\b|\breporting\b|\bdashboards?\b/, 'Analytics'],
    [/\bllm\b|\blarge language model\b|\bgenai\b|\bgenerative ai\b/, 'LLM workflows'],
    [/\bmachine learning\b|\bml\b/, 'Machine learning'],
    [/\bscikit\b|\bscikit-learn\b|\bsklearn\b/, 'scikit-learn'],
    [/\bspacy\b/, 'spaCy'],
    [/\bjava\b/, 'Java'],
    [/\bsales operations\b|\bsales\b/, 'Sales operations'],
  ]
  const detected = skillMap
    .filter(([pattern]) => pattern.test(normalized))
    .map(([, skill]) => skill)

  return Array.from(new Set(detected))
}

function getBootstrap() {
  updateEmployeeStatusesFromLeaveRequests()
  return {
    roles: state.roles,
    permissions: state.permissions,
    employees: state.employees,
    attendance: state.attendance,
    performance: state.performance,
    payroll: state.payroll,
    salarySlips: state.salarySlips,
    payrollApprovals: state.payrollApprovals,
    leaveRequests: state.leaveRequests,
    jobs: state.jobs,
    candidate: state.candidate,
    candidateResults: state.candidateResults,
    notifications: state.notifications,
    documents: state.documents,
    announcements: state.announcements,
    insights: state.insights,
    shortlists: state.shortlists,
    teams: state.teams,
    voiceListening: state.voiceListening,
    metrics: dashboardMetrics(),
  }
}

function writeRealtimeEvent(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function broadcastRealtimeState(reason = 'state') {
  if (!realtimeClients.size) {
    return
  }

  realtimeVersion += 1
  const payload = {
    type: 'state',
    reason,
    version: realtimeVersion,
    syncedAt: new Date().toISOString(),
    data: getBootstrap(),
  }

  realtimeClients.forEach((client) => {
    try {
      writeRealtimeEvent(client.response, payload)
    } catch {
      realtimeClients.delete(client)
    }
  })
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'AI-HRMS API' })
})

app.get('/api/auth/status', (_request, response) => {
  response.json({
    provider: supabaseAuth ? 'supabase' : 'local',
    supabaseUrlConfigured: Boolean(supabaseUrl),
    supabaseKeyConfigured: Boolean(supabaseAnonKey),
    serviceRoleConfigured: Boolean(supabaseServiceRoleKey),
    storageProvider: supabaseAdmin ? 'supabase' : 'runtime-only',
    storageTable: 'hrms_app_state',
    moduleRecordsTable: 'hrms_module_records',
    analyticsTable: 'hrms_analytics_records',
  })
})

app.get('/api/email/status', (_request, response) => {
  response.json({
    brevoApiKeyConfigured: Boolean(brevoApiKey),
    smtpConfigured: Boolean(smtpHost && smtpUser && smtpPass),
    smtpHostConfigured: Boolean(smtpHost),
    smtpUserConfigured: Boolean(smtpUser),
    smtpPassConfigured: Boolean(smtpPass),
    smtpUser: smtpUser || null,
    resendApiKeyConfigured: Boolean(resendApiKey),
    emailFromConfigured: Boolean(emailFrom),
    emailFrom,
    publicAppUrl,
  })
})

app.get('/api/realtime', (request, response) => {
  response.setHeader('Content-Type', 'text/event-stream')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('Connection', 'keep-alive')
  response.flushHeaders?.()

  const client = {
    id: `realtime-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    response,
  }
  realtimeClients.add(client)

  writeRealtimeEvent(response, {
    type: 'state',
    reason: 'connected',
    version: realtimeVersion,
    syncedAt: new Date().toISOString(),
    data: getBootstrap(),
  })

  const heartbeat = setInterval(() => {
    response.write(': heartbeat\n\n')
  }, 15000)

  request.on('close', () => {
    clearInterval(heartbeat)
    realtimeClients.delete(client)
  })
})

app.get('/api/storage/status', async (_request, response) => {
  if (!supabaseAdmin) {
    response.json({
      storageProvider: 'runtime-only',
      appStateAvailable: false,
      moduleRecordsAvailable: false,
      message: 'SUPABASE_SERVICE_ROLE_KEY is missing.',
    })
    return
  }

  const appStateResult = await supabaseAdmin.from('hrms_app_state').select('id').limit(1)
  const moduleRecordsResult = await supabaseAdmin.from('hrms_module_records').select('module').limit(1)
  const analyticsRecordsResult = await supabaseAdmin.from('hrms_analytics_records').select('category').limit(1)

  response.json({
    storageProvider: 'supabase',
    appStateAvailable: !appStateResult.error,
    moduleRecordsAvailable: !moduleRecordsResult.error,
    analyticsRecordsAvailable: !analyticsRecordsResult.error,
    appStateError: appStateResult.error?.message || null,
    moduleRecordsError: moduleRecordsResult.error?.message || null,
    analyticsRecordsError: analyticsRecordsResult.error?.message || null,
  })
})

app.post('/api/storage/sync', async (_request, response) => {
  if (!supabaseAdmin) {
    response.status(503).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is missing' })
    return
  }

  await syncEmployeesToSupabase()
  await syncLeaveRequestsToSupabase()
  await syncShortlistedCandidatesToSupabase()
  await syncAnnouncementsToSupabase()
  await syncNotificationsToSupabase()
  await syncJobsToSupabase()
  await syncSalarySlipsToSupabase()
  await loadAnalyticsFromSupabase()
  await saveHrmsStateToSupabase()
  await syncModuleRecordsToSupabase(cloneData(state))

  response.json({
    synced: true,
    employees: state.employees.length,
    leaveRequests: state.leaveRequests.length,
    jobs: state.jobs.length,
    shortlists: state.shortlists.length,
    notifications: state.notifications.length,
  })
})

app.post('/api/auth/login', async (request, response) => {
  const { email, password } = request.body

  try {
    const supabaseSession = await loginWithSupabase(String(email || ''), String(password || ''))

    if (supabaseSession) {
      response.json(supabaseSession)
      return
    }
  } catch (error) {
    const message = error.message || 'Invalid email or password'
    console.error(`[auth] Supabase login failed for ${String(email || '').trim().toLowerCase()}: ${message}`)
    response.status(401).type('application/json').send(JSON.stringify({ error: message }))
    return
  }

  const users = loadUsers()
  const user = users.find((item) => item.email.toLowerCase() === String(email || '').toLowerCase())

  if (!user || !verifyPassword(password, user)) {
    response.status(401).json({ error: 'Invalid email or password' })
    return
  }

  response.json({
    token: `session-token-${Date.now()}-${user.role}`,
    user: {
      email: user.email,
      name: user.name,
      role: user.role,
    },
  })
})

app.patch('/api/auth/password', async (request, response) => {
  if (!supabaseAuth || !supabaseAdmin) {
    response.status(503).json({ error: 'Password changes require Supabase Auth and service role configuration' })
    return
  }

  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  const currentPassword = String(request.body.currentPassword || '')
  const newPassword = String(request.body.newPassword || '')
  const confirmPassword = String(request.body.confirmPassword || '')

  if (!token) {
    response.status(401).json({ error: 'Please sign in again before changing your password' })
    return
  }

  if (!currentPassword || !newPassword || !confirmPassword) {
    response.status(400).json({ error: 'Current password, new password, and confirmation are required' })
    return
  }

  if (newPassword !== confirmPassword) {
    response.status(400).json({ error: 'New password and confirmation do not match' })
    return
  }

  if (newPassword.length < 6) {
    response.status(400).json({ error: 'New password must be at least 6 characters' })
    return
  }

  const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token)
  if (userError || !userData.user?.email) {
    response.status(401).json({ error: 'Your session expired. Please sign in again' })
    return
  }

  const { error: passwordError } = await supabaseAuth.auth.signInWithPassword({
    email: userData.user.email,
    password: currentPassword,
  })

  if (passwordError) {
    response.status(401).json({ error: 'Current password is incorrect' })
    return
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userData.user.id, {
    password: newPassword,
  })

  if (updateError) {
    response.status(400).json({ error: updateError.message })
    return
  }

  response.json({ ok: true })
})

app.get('/api/bootstrap', (_request, response) => {
  response.json(getBootstrap())
})

app.post('/api/announcements', async (request, response) => {
  if (request.body.actorRole !== 'admin') {
    response.status(403).json({ error: 'Only Management Admin can post announcements' })
    return
  }

  const title = String(request.body.title || '').trim()
  const text = String(request.body.text || '').trim()

  if (!title || !text) {
    response.status(400).json({ error: 'Announcement title and message are required' })
    return
  }

  const announcement = {
    id: `a-${Date.now()}`,
    title,
    text,
  }
  state.announcements.unshift(announcement)
  await syncAnnouncementToSupabase(announcement)
  state.notifications.unshift({
    id: `n-${Date.now()}`,
    text: `${request.body.actorName || 'Management Admin'} posted announcement: ${title}.`,
    read: false,
  })

  response.status(201).json({
    announcement,
    announcements: state.announcements,
    notifications: state.notifications,
  })
})

app.delete('/api/announcements/:id', async (request, response) => {
  if (request.body.actorRole !== 'admin') {
    response.status(403).json({ error: 'Only Management Admin can delete announcements' })
    return
  }

  const announcement = state.announcements.find((item) => item.id === request.params.id)
  if (!announcement) {
    response.status(404).json({ error: 'Announcement not found' })
    return
  }

  state.announcements = state.announcements.filter((item) => item.id !== request.params.id)
  if (supabaseAdmin) {
    await supabaseAdmin
      .from('announcements')
      .delete()
      .eq('app_record_id', request.params.id)
  }
  state.notifications.unshift({
    id: `n-${Date.now()}`,
    text: `${request.body.actorName || 'Management Admin'} deleted announcement: ${announcement.title}.`,
    read: false,
  })
  response.json({ announcements: state.announcements, notifications: state.notifications })
})

app.post('/api/employees', async (request, response) => {
  if (request.body.actorRole !== 'recruiter' && request.body.actorRole !== 'admin') {
    response.status(403).json({ error: 'Only HR recruiters or management admins can add employees' })
    return
  }

  const name = String(request.body.name || '').trim()
  const role = String(request.body.role || '').trim()
  const department = String(request.body.department || '').trim()
  const manager = String(request.body.manager || '').trim()
  const workEmail = String(request.body.workEmail || '').trim()
  const ctc = Number(request.body.ctc)
  const cabChargesMonthly = Number(request.body.cabChargesMonthly || 0)
  const createLogin = Boolean(request.body.createLogin)
  const accessRole = normalizeRole(request.body.accessRole) || 'employee'
  const temporaryPassword = String(request.body.temporaryPassword || '')
  const allowedDepartments = ['HR', 'Product', 'Revenue', 'Analytics']

  if (!name || !role || !department || !manager || !ctc) {
    response.status(400).json({ error: 'Name, role, department, manager, and CTC are required' })
    return
  }

  if (!allowedDepartments.includes(department)) {
    response.status(400).json({ error: 'Department must be HR, Product, Revenue, or Analytics' })
    return
  }

  if (createLogin && !workEmail) {
    response.status(400).json({ error: 'Work email is required to create login access' })
    return
  }

  if (createLogin && temporaryPassword.length < 6) {
    response.status(400).json({ error: 'Temporary password must be at least 6 characters' })
    return
  }

  let loginAccess = createLogin
    ? {
        enabled: false,
        email: workEmail.toLowerCase(),
        role: accessRole,
        status: 'Pending',
      }
    : {
        enabled: false,
        email: workEmail.toLowerCase(),
        role: accessRole,
        status: 'Not created',
      }

  if (createLogin) {
    const loginResult = await createOrUpdateSupabaseEmployeeLogin({
      email: workEmail,
      password: temporaryPassword,
      fullName: name,
      role: accessRole,
    })

    if (loginResult.error) {
      response.status(400).json({ error: `Employee login could not be created: ${loginResult.error}` })
      return
    }

    loginAccess = {
      enabled: true,
      email: loginResult.email,
      role: loginResult.role,
      userId: loginResult.userId,
      status: loginResult.created ? 'Created' : 'Updated',
    }
  }

  const employee = createEmployee(
    name,
    role,
    department,
    manager,
    0,
    0,
    0,
    0,
    'New hire',
    ctc,
    cabChargesMonthly,
    workEmail,
    loginAccess,
  )
  state.employees.unshift(employee)
  await syncEmployeeToSupabase(employee)
  state.notifications.unshift({
    id: `n-${Date.now()}`,
    text: `${request.body.actorName || 'HR Recruiter'} added ${employee.name} to Employee directory${loginAccess.enabled ? ' and created login access' : ''}.`,
    read: false,
  })
  response.status(201).json({
    employee,
    employees: state.employees,
    metrics: dashboardMetrics(),
    notifications: state.notifications,
    loginAccess,
  })
})

app.patch('/api/employees/:id/review', async (request, response) => {
  const actorRole = request.body.actorRole || 'employee'
  const actorName = request.body.actorName || 'Unknown reviewer'

  if (!['manager', 'admin'].includes(actorRole)) {
    response.status(403).json({ error: 'Only Senior Manager or Management Admin can submit employee reviews' })
    return
  }

  const employee = state.employees.find((item) => item.id === request.params.id || item.employeeCode === request.params.id)
  if (!employee) {
    response.status(404).json({ error: 'Employee not found' })
    return
  }

  if (actorRole === 'manager' && employee.manager !== actorName) {
    response.status(403).json({ error: 'Senior Managers can review only their assigned team members' })
    return
  }

  const score = Number(request.body.score)
  const rating = String(request.body.rating || '').trim()
  const focusArea = String(request.body.focusArea || '').trim()
  const achievements = String(request.body.achievements || '').trim()
  const improvementPlan = String(request.body.improvementPlan || '').trim()

  if (!Number.isFinite(score) || score < 0 || score > 100 || !rating || !focusArea) {
    response.status(400).json({ error: 'Score between 0 and 100, rating, and focus area are required' })
    return
  }

  const reviewedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  const review = {
    id: `review-${Date.now()}`,
    score,
    rating,
    focusArea,
    achievements,
    improvementPlan,
    reviewedBy: actorName,
    reviewedAt,
    cycle: request.body.cycle || 'Current review cycle',
  }

  employee.performance = score
  employee.performanceDetails = {
    rating,
    reviewCycle: review.cycle,
    focusArea,
    achievements,
    improvementPlan,
    reviewedBy: actorName,
    reviewedAt,
  }
  employee.performanceReviews = [review, ...(employee.performanceReviews || [])]

  await syncEmployeeToSupabase(employee)
  state.notifications.unshift({
    id: `n-${Date.now()}`,
    text: `${actorName} submitted performance review for ${employee.name}.`,
    read: false,
  })

  response.json({ employee, employees: state.employees, metrics: dashboardMetrics(), notifications: state.notifications })
})

app.post('/api/documents', upload.single('document'), (request, response) => {
  const title = String(request.body.title || request.file?.originalname || '').trim()
  const category = String(request.body.category || 'General').trim()

  if (!title) {
    response.status(400).json({ error: 'Document title is required' })
    return
  }

  const document = {
    id: `doc-${Date.now()}`,
    title,
    text: request.file ? `${request.file.originalname} uploaded` : 'Document record created',
    category,
    uploadedBy: request.body.actorName || 'Manager',
    acknowledgedBy: [],
    content: request.file
      ? request.file.buffer.toString('utf8').replace(/[^\x20-\x7e]+/g, ' ').slice(0, 4000)
      : 'Document content unavailable; metadata record created.',
  }

  state.documents.unshift(document)
  state.notifications.unshift({
    id: `n-${Date.now()}`,
    text: `${document.uploadedBy} uploaded document: ${document.title}.`,
    read: false,
  })
  response.status(201).json({ document, documents: state.documents, notifications: state.notifications })
})

app.patch('/api/documents/:id/acknowledge', (request, response) => {
  const document = state.documents.find((item) => item.id === request.params.id)
  if (!document) {
    response.status(404).json({ error: 'Document not found' })
    return
  }

  const actorName = request.body.actorName || 'Employee'
  if (!document.acknowledgedBy.includes(actorName)) {
    document.acknowledgedBy.push(actorName)
  }

  response.json({ document, documents: state.documents })
})

app.get('/api/documents/:id/download', (request, response) => {
  const document = state.documents.find((item) => item.id === request.params.id)
  if (!document) {
    response.status(404).send('Document not found')
    return
  }

  response.setHeader('Content-Type', 'text/plain')
  response.setHeader('Content-Disposition', `attachment; filename="${document.id}.txt"`)
  response.send(
    [
      `Document: ${document.title}`,
      `Category: ${document.category}`,
      `Uploaded by: ${document.uploadedBy}`,
      `Acknowledgements: ${document.acknowledgedBy.length}`,
      '',
      document.content,
    ].join('\n'),
  )
})

app.post('/api/jobs', async (request, response) => {
  if (request.body.actorRole !== 'recruiter' && request.body.actorRole !== 'admin') {
    response.status(403).json({ error: 'Only HR recruiters or management admins can list open roles' })
    return
  }

  const skills = String(request.body.skills || '')
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean)

  if (!request.body.title || !request.body.department || skills.length === 0) {
    response.status(400).json({ error: 'Title, department, and required skills are needed' })
    return
  }

  const job = {
    id: `job-${Date.now()}`,
    title: request.body.title,
    department: request.body.department,
    applicants: 0,
    skills,
    description: request.body.description || 'Open role listed by HR recruiter.',
    listedBy: request.body.actorName || 'HR Recruiter',
  }

  state.jobs.unshift(job)
  await syncJobToSupabase(job)
  state.notifications.unshift({
    id: `n-${Date.now()}`,
    text: `${job.title} role listed with ${skills.length} required skills.`,
    read: false,
  })
  response.status(201).json({ job, jobs: state.jobs, notifications: state.notifications })
})

app.post('/api/teams', (request, response) => {
  const name = String(request.body.name || '').trim()
  const purpose = String(request.body.purpose || '').trim()
  const members = Array.isArray(request.body.members) ? request.body.members.filter(Boolean) : []
  const actorName = request.body.actorName || 'Employee'

  if (!name || members.length === 0) {
    response.status(400).json({ error: 'Team name and at least one member are required' })
    return
  }

  const uniqueMembers = Array.from(new Set([actorName, ...members]))
  const team = {
    id: `team-${Date.now()}`,
    name,
    purpose: purpose || 'Team communication group.',
    createdBy: actorName,
    members: uniqueMembers,
    messages: [
      {
        id: `msg-${Date.now()}`,
        author: actorName,
        text: `${actorName} created this team group.`,
        createdAt: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      },
    ],
  }

  state.teams.unshift(team)
  state.notifications.unshift({
    id: `n-${Date.now()}`,
    text: `${actorName} created team group ${team.name}.`,
    read: false,
  })
  response.status(201).json({ team, teams: state.teams, notifications: state.notifications })
})

app.get('/api/teams/:teamId/messages/:messageId/attachment', (request, response) => {
  const team = state.teams.find((item) => item.id === request.params.teamId)
  const message = team?.messages.find((item) => item.id === request.params.messageId)
  const attachment = message?.attachment

  if (!team || !message || !attachment?.content) {
    response.status(404).json({ error: 'Attachment not found' })
    return
  }

  const fileBuffer = Buffer.from(attachment.content, 'base64')
  response.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream')
  response.setHeader('Content-Length', String(fileBuffer.length))
  response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.name || 'team-document')}"`)
  response.send(fileBuffer)
})

app.post('/api/teams/:id/messages', upload.single('attachment'), (request, response) => {
  const team = state.teams.find((item) => item.id === request.params.id)
  if (!team) {
    response.status(404).json({ error: 'Team group not found' })
    return
  }

  const text = String(request.body.text || '').trim()
  const actorName = request.body.actorName || 'Employee'
  const attachmentFile = request.file || null
  if (!text && !attachmentFile) {
    response.status(400).json({ error: 'Message or document is required' })
    return
  }

  if (attachmentFile && attachmentFile.size > 5 * 1024 * 1024) {
    response.status(400).json({ error: 'Team documents must be 5 MB or smaller' })
    return
  }

  const attachment = attachmentFile
    ? {
        id: `att-${Date.now()}`,
        name: attachmentFile.originalname || 'team-document',
        mimeType: attachmentFile.mimetype || 'application/octet-stream',
        size: attachmentFile.size,
        content: attachmentFile.buffer.toString('base64'),
      }
    : null

  const message = {
    id: `msg-${Date.now()}`,
    author: actorName,
    text: text || `${actorName} shared ${attachment.name}.`,
    createdAt: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
    attachment,
  }
  team.messages.push(message)
  response.status(201).json({ message, team, teams: state.teams })
})

app.post('/api/attendance/sync', (_request, response) => {
  state.syncCount += 1
  state.attendance = state.attendance.map((item, index) => ({
    ...item,
    present: item.present + (index === state.syncCount % state.attendance.length ? 2 : 0),
    late: Math.max(0, item.late - (index === 1 ? 1 : 0)),
  }))
  state.insights[0] = {
    ...state.insights[0],
    title: 'Fresh device sync recalculated late-arrival risk',
    signal: `Device sync completed ${state.syncCount} time${state.syncCount === 1 ? '' : 's'}; late arrivals were recalculated from live attendance.`,
    attentionPoint: 'Revenue Operations still needs attention during the first hour on peak late-arrival days.',
  }
  response.json({ attendance: state.attendance, insights: state.insights, syncCount: state.syncCount })
})

app.post('/api/leave', async (request, response) => {
  const type = request.body.type || 'Leave'
  const specialCategory = request.body.specialCategory || null
  const requestedOn = request.body.requestedOn || new Date().toISOString().slice(0, 10)
  const startDate = request.body.startDate || ''
  const endDate = request.body.endDate || startDate

  if (!startDate) {
    response.status(400).json({ error: 'Leave start date is required' })
    return
  }

  const leave = {
    id: `leave-${Date.now()}`,
    person: request.body.person || 'Aarav Mehta',
    type: specialCategory ? `${type} - ${specialCategory}` : type,
    requestType: type,
    specialCategory,
    requestedOn,
    startDate,
    endDate,
    dates: startDate === endDate ? startDate : `${startDate} to ${endDate}`,
    status: 'Pending',
    approver: null,
  }
  state.leaveRequests.unshift(leave)
  updateEmployeeStatusesFromLeaveRequests()
  await syncLeaveRequestToSupabase(leave)
  await syncEmployeesToSupabase()
  state.notifications.unshift({ id: `n-${Date.now()}`, text: `${leave.person} submitted ${leave.type}.`, read: false })
  response.status(201).json({ leave, leaveRequests: state.leaveRequests, employees: state.employees, notifications: state.notifications })
})

app.patch('/api/leave/:id', async (request, response) => {
  const leave = state.leaveRequests.find((item) => item.id === request.params.id)
  if (!leave) {
    response.status(404).json({ error: 'Leave request not found' })
    return
  }
  const nextStatus = request.body.status || 'Approved'
  const actorName = request.body.actorName || 'Unknown user'
  const actorRole = request.body.actorRole || 'employee'
  const isHigherOfficer = ['admin', 'manager'].includes(actorRole)
  const isOwner = leave.person === actorName

  if (leave.status !== 'Pending') {
    response.status(409).json({ error: 'Only pending leave requests can be changed' })
    return
  }

  if (nextStatus === 'Withdrawn') {
    if (!isOwner) {
      response.status(403).json({ error: 'Only the employee who created this request can withdraw it' })
      return
    }
    leave.status = 'Withdrawn'
    leave.approver = null
    updateEmployeeStatusesFromLeaveRequests()
    await syncLeaveRequestToSupabase(leave)
    await syncEmployeesToSupabase()
    state.notifications.unshift({ id: `n-${Date.now()}`, text: `${leave.person} withdrew a leave request.`, read: false })
    response.json({ leave, leaveRequests: state.leaveRequests, employees: state.employees, notifications: state.notifications })
    return
  }

  if (!['Approved', 'Cancelled'].includes(nextStatus)) {
    response.status(400).json({ error: 'Unsupported leave status' })
    return
  }

  if (!isHigherOfficer || isOwner) {
    response.status(403).json({ error: 'Leave approval must be completed by a higher officer' })
    return
  }

  leave.status = nextStatus
  leave.approver = actorName
  updateEmployeeStatusesFromLeaveRequests()
  await syncLeaveRequestToSupabase(leave)
  await syncEmployeesToSupabase()
  state.notifications.unshift({ id: `n-${Date.now()}`, text: `${actorName} ${nextStatus.toLowerCase()} ${leave.person}'s leave.`, read: false })
  response.json({ leave, leaveRequests: state.leaveRequests, employees: state.employees, notifications: state.notifications })
})

app.post('/api/payroll/generate', (request, response) => {
  const month = 'June 2026'
  const pending = state.payrollApprovals.find((approval) => approval.month === month && approval.status === 'Pending')
  if (pending) {
    response.status(409).json({ error: `${month} payroll is already awaiting approval` })
    return
  }

  const grossTotal = state.employees.reduce((sum, employee) => sum + employee.salaryDetails.monthlyGross, 0)
  const deductions = state.employees.reduce((sum, employee) => sum + employee.salaryDetails.monthlyDeductions, 0)
  const approval = {
    id: `payroll-approval-${Date.now()}`,
    month,
    employees: state.employees.length,
    grossTotal,
    deductions,
    netTotal: grossTotal - deductions,
    status: 'Pending',
    requestedBy: request.body.actorName || 'Payroll user',
    reviewedBy: null,
  }

  state.payrollApprovals.unshift(approval)
  state.notifications.unshift({ id: `n-${Date.now()}`, text: `${month} payroll batch is awaiting management approval.`, read: false })
  response.status(201).json({ approval, payrollApprovals: state.payrollApprovals, salarySlips: state.salarySlips, notifications: state.notifications })
})

app.patch('/api/payroll/approvals/:id', async (request, response) => {
  if (request.body.actorRole !== 'admin') {
    response.status(403).json({ error: 'Only Management Admin can approve payroll batches' })
    return
  }

  const approval = state.payrollApprovals.find((item) => item.id === request.params.id)
  if (!approval) {
    response.status(404).json({ error: 'Payroll approval request not found' })
    return
  }

  if (approval.status !== 'Pending') {
    response.status(409).json({ error: 'Only pending payroll batches can be reviewed' })
    return
  }

  const nextStatus = request.body.status === 'Rejected' ? 'Rejected' : 'Approved'
  approval.status = nextStatus
  approval.reviewedBy = request.body.actorName || 'Management Admin'

  if (nextStatus === 'Approved') {
    const existingSlip = state.salarySlips.find((slip) => slip.month === approval.month)
    if (!existingSlip) {
      state.employees.forEach((employee) => {
        state.salarySlips.unshift({
          id: `slip-${employee.id}-${approval.month.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          month: approval.month,
          employee: employee.name,
          employeeCode: employee.employeeCode,
          gross: employee.salaryDetails.monthlyGross,
          deductions: employee.salaryDetails.monthlyDeductions,
          net: employee.salaryDetails.monthlyTakeHome,
          salaryDetails: employee.salaryDetails,
        })
      })
    }
    await syncSalarySlipsToSupabase()
  }

  state.notifications.unshift({
    id: `n-${Date.now()}`,
    text: `${approval.month} payroll batch ${nextStatus.toLowerCase()} by ${approval.reviewedBy}.`,
    read: false,
  })
  response.json({ approval, payrollApprovals: state.payrollApprovals, salarySlips: state.salarySlips, notifications: state.notifications })
})

app.get('/api/payroll/slips/:id/download', (request, response) => {
  const slip = state.salarySlips.find((item) => item.id === request.params.id)
  if (!slip) {
    response.status(404).send('Salary slip not found')
    return
  }
  response.setHeader('Content-Type', 'text/plain')
  response.setHeader('Content-Disposition', `attachment; filename="${slip.id}.txt"`)
  response.send(
    [
      'AI-HRMS Salary Slip',
      `Employee: ${slip.employee}`,
      slip.employeeCode ? `Employee ID: ${slip.employeeCode}` : null,
      `Month: ${slip.month}`,
      `Gross salary: ${formatMoney(slip.gross)}`,
      `Deductions: ${formatMoney(slip.deductions || 0)}`,
      `Net salary: ${formatMoney(slip.net)}`,
      slip.salaryDetails ? `Basic: ${formatMoney(Math.round(slip.salaryDetails.basicAnnual / 12))}` : null,
      slip.salaryDetails ? `HRA: ${formatMoney(Math.round(slip.salaryDetails.hraAnnual / 12))}` : null,
      slip.salaryDetails ? `Special allowance: ${formatMoney(Math.round(slip.salaryDetails.specialAllowanceAnnual / 12))}` : null,
      slip.salaryDetails ? `Employee PF: ${formatMoney(Math.round(slip.salaryDetails.employeePfAnnual / 12))}` : null,
      'Generated by AI-HRMS payroll service.',
    ].filter(Boolean).join('\n'),
  )
})

app.post('/api/recruitment/parse', upload.array('resumes', 25), async (request, response) => {
  const files = request.files || []
  const jobDescription = request.body.jobDescription || ''
  const appliedJob = state.jobs.find((job) => job.id === request.body.appliedJobId) || state.jobs[0]

  if (files.length > 25) {
    response.status(400).json({ error: 'A maximum of 25 resumes can be screened at one time' })
    return
  }

  const candidates = files.length
    ? await Promise.all(
        files.map(async (file) => {
          const text = await extractResumeText(file)
          return candidateFromText(file, text)
        }),
      )
    : [state.candidate]

  const results = candidates.map((candidate) => {
    const openRoleMatch = matchCandidateToOpenRoles(candidate)
    return {
      candidate,
      match: openRoleMatch.bestRole || matchCandidate(jobDescription, candidate),
      manualMatch: matchCandidate(jobDescription, candidate),
      roleMatches: openRoleMatch.roleMatches,
      bestRole: openRoleMatch.bestRole,
      appliedFor: appliedJob
        ? { jobId: appliedJob.id, title: appliedJob.title, department: appliedJob.department }
        : null,
    }
  })

  state.candidateResults = results
  state.candidate = results[0].candidate

  response.json({
    candidate: state.candidate,
    candidates,
    results,
  })
})

app.post('/api/recruitment/match', (request, response) => {
  const openRoleMatch = matchCandidateToOpenRoles(state.candidate)
  response.json({
    candidate: state.candidate,
    match: matchCandidate(request.body.jobDescription || ''),
    roleMatches: openRoleMatch.roleMatches,
    bestRole: openRoleMatch.bestRole,
  })
})

app.post('/api/recruitment/shortlist', async (request, response) => {
  const candidateResult = state.candidateResults.find((result) => result.candidate.fileName === request.body.fileName)
  const candidate = candidateResult?.candidate || state.candidate
  const match = candidateResult?.bestRole || candidateResult?.match || matchCandidateToOpenRoles(candidate).bestRole
  const shortlist = {
    id: `shortlist-${Date.now()}`,
    candidate: candidate.name,
    email: candidate.email,
    phone: candidate.phone,
    fileName: candidate.fileName,
    summary: candidate.summary,
    skills: candidate.skills,
    appliedFor: candidateResult?.appliedFor || { title: request.body.appliedFor || request.body.jobTitle || 'AI Product Engineer' },
    jobTitle: request.body.jobTitle || match?.title || 'AI Product Engineer',
    score: request.body.score || match?.score || 0,
    bestRole: match?.title || request.body.jobTitle || 'AI Product Engineer',
    roleMatches: candidateResult?.roleMatches || matchCandidateToOpenRoles(candidate).roleMatches,
    status: 'HR review required',
    notified: false,
    notifiedAt: null,
  }
  state.shortlists.unshift(shortlist)
  await syncShortlistedCandidateToSupabase(shortlist)
  state.notifications.unshift({
    id: `n-${Date.now()}`,
    text: `${shortlist.candidate} sent to shortlist. Final decision remains with HR.`,
    read: false,
  })
  response.status(201).json({ shortlist, shortlists: state.shortlists, notifications: state.notifications })
})

app.post('/api/recruitment/shortlist/:id/notify', async (request, response) => {
  const shortlist = state.shortlists.find((item) => item.id === request.params.id)
  if (!shortlist) {
    response.status(404).json({ error: 'Shortlisted candidate not found' })
    return
  }

  const emailResult = await sendEmail({
    to: shortlist.email,
    ...candidateNotificationContent(shortlist),
  })

  if (!emailResult.sent) {
    response.status(502).json({ error: `Email could not be sent: ${emailResult.error}` })
    return
  }

  shortlist.notified = true
  shortlist.notifiedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  shortlist.status = 'Candidate notified'
  shortlist.emailMessage = `Interview update sent to ${shortlist.email} for ${shortlist.jobTitle}.`
  shortlist.emailProviderId = emailResult.providerId
  await syncShortlistedCandidateToSupabase(shortlist)

  state.notifications.unshift({
    id: `n-${Date.now()}`,
    text: `${shortlist.candidate} notified at ${shortlist.email}.`,
    read: false,
  })
  response.json({ shortlist, shortlists: state.shortlists, notifications: state.notifications })
})

app.post('/api/recruitment/shortlist/notify-all', async (_request, response) => {
  const pending = state.shortlists.filter((item) => !item.notified)
  const notifiedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  const failures = []

  for (const shortlist of pending) {
    const emailResult = await sendEmail({
      to: shortlist.email,
      ...candidateNotificationContent(shortlist),
    })

    if (!emailResult.sent) {
      failures.push({ candidate: shortlist.candidate, email: shortlist.email, error: emailResult.error })
      continue
    }

    shortlist.notified = true
    shortlist.notifiedAt = notifiedAt
    shortlist.status = 'Candidate notified'
    shortlist.emailMessage = `Interview update sent to ${shortlist.email} for ${shortlist.jobTitle}.`
    shortlist.emailProviderId = emailResult.providerId
  }
  await syncShortlistedCandidatesToSupabase()
  const sentCount = pending.length - failures.length

  state.notifications.unshift({
    id: `n-${Date.now()}`,
    text: `${sentCount} shortlisted candidate${sentCount === 1 ? '' : 's'} notified by HR${failures.length ? `; ${failures.length} failed` : ''}.`,
    read: false,
  })
  response.json({ notifiedCount: sentCount, failures, shortlists: state.shortlists, notifications: state.notifications })
})

app.post('/api/recruitment/shortlist/:id/video-interview', async (request, response) => {
  const actorRole = request.body.actorRole || 'employee'
  if (!['admin', 'recruiter'].includes(actorRole)) {
    response.status(403).json({ error: 'Only HR Recruiter or Management Admin can schedule candidate interviews' })
    return
  }

  const shortlist = state.shortlists.find((item) => item.id === request.params.id)
  if (!shortlist) {
    response.status(404).json({ error: 'Shortlisted candidate not found' })
    return
  }

  const scheduledFor = String(request.body.scheduledFor || '').trim()
  if (!scheduledFor) {
    response.status(400).json({ error: 'Video interview date and time are required' })
    return
  }

  const scheduledDate = new Date(scheduledFor)
  if (Number.isNaN(scheduledDate.getTime())) {
    response.status(400).json({ error: 'Video interview date and time are invalid' })
    return
  }

  const actorName = request.body.actorName || 'HR Recruiter'
  const meetingLink =
    String(request.body.meetingLink || '').trim() ||
    `https://meet.google.com/aihrms-${shortlist.id.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase()}`
  const interview = {
    scheduledFor,
    scheduledForLabel: scheduledDate.toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      hour12: true,
    }),
    interviewer: String(request.body.interviewer || actorName).trim(),
    meetingLink,
    notes: String(request.body.notes || '').trim(),
    scheduledBy: actorName,
    scheduledAt: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
  }

  const emailResult = await sendEmail({
    to: shortlist.email,
    ...videoInterviewEmailContent(shortlist, interview),
  })

  if (!emailResult.sent) {
    response.status(502).json({ error: `Video interview email could not be sent: ${emailResult.error}` })
    return
  }

  shortlist.videoInterview = interview
  shortlist.status = 'Video interview scheduled'
  shortlist.notified = true
  shortlist.notifiedAt = interview.scheduledAt
  shortlist.emailMessage = [
    `Video interview invite sent to ${shortlist.email}.`,
    `Role: ${shortlist.bestRole || shortlist.jobTitle}.`,
    `When: ${interview.scheduledForLabel}.`,
    `Meeting: ${meetingLink}.`,
  ].join(' ')
  shortlist.emailProviderId = emailResult.providerId
  await syncShortlistedCandidateToSupabase(shortlist)

  state.notifications.unshift({
    id: `n-${Date.now()}`,
    text: `${actorName} scheduled a video interview for ${shortlist.candidate}.`,
    read: false,
  })

  response.json({ shortlist, shortlists: state.shortlists, notifications: state.notifications })
})

app.post('/api/recruitment/shortlist/:id/screening/start', async (request, response) => {
  const actorRole = request.body.actorRole || 'employee'
  if (!['admin', 'recruiter'].includes(actorRole)) {
    response.status(403).json({ error: 'Only HR Recruiter or Management Admin can start AI screening' })
    return
  }

  const shortlist = state.shortlists.find((item) => item.id === request.params.id)
  if (!shortlist) {
    response.status(404).json({ error: 'Shortlisted candidate not found' })
    return
  }

  const screening = ensureScreeningSession(shortlist, request.body.actorName || 'HR Recruiter')
  const emailResult = await sendEmail({
    to: shortlist.email,
    ...screeningInviteEmailContent(shortlist, screening),
  })

  if (!emailResult.sent) {
    response.status(502).json({ error: `AI screening invite could not be sent: ${emailResult.error}` })
    return
  }

  shortlist.status = shortlist.selected ? shortlist.status : 'AI screening in progress'
  shortlist.aiScreening.invited = true
  shortlist.aiScreening.invitedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  shortlist.aiScreening.emailProviderId = emailResult.providerId
  await syncShortlistedCandidateToSupabase(shortlist)
  state.notifications.unshift({
    id: `n-${Date.now()}`,
    text: `AI screening invite sent to ${shortlist.candidate}.`,
    read: false,
  })

  response.status(201).json({ screening, shortlist, shortlists: state.shortlists, notifications: state.notifications })
})

app.post('/api/recruitment/shortlist/:id/screening/message', async (request, response) => {
  const actorRole = request.body.actorRole || 'employee'
  if (!['admin', 'recruiter'].includes(actorRole)) {
    response.status(403).json({ error: 'Only HR Recruiter or Management Admin can record AI screening responses' })
    return
  }

  const shortlist = state.shortlists.find((item) => item.id === request.params.id)
  if (!shortlist) {
    response.status(404).json({ error: 'Shortlisted candidate not found' })
    return
  }

  const text = String(request.body.text || '').trim()
  const mode = request.body.mode === 'voice' ? 'voice' : 'text'

  if (!text) {
    response.status(400).json({ error: 'Screening answer is required' })
    return
  }

  const screening = ensureScreeningSession(shortlist, request.body.actorName || 'HR Recruiter')
  const createdAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  screening.messages.push({
    id: `screen-msg-${Date.now()}-candidate`,
    sender: 'candidate',
    mode,
    text,
    createdAt,
  })

  if (mode === 'voice') {
    screening.voiceTranscripts.push({
      id: `voice-${Date.now()}`,
      text,
      createdAt,
    })
  }

  const nextQuestionIndex = screening.currentQuestionIndex + 1
  screening.currentQuestionIndex = nextQuestionIndex

  if (nextQuestionIndex < screening.questions.length) {
    screening.messages.push({
      id: `screen-msg-${Date.now()}-ai`,
      sender: 'ai',
      mode: 'text',
      text: screening.questions[nextQuestionIndex],
      createdAt,
    })
  } else {
    screening.status = 'Completed'
  }

  screening.evaluation = createScreeningEvaluation(shortlist, screening)
  shortlist.aiScreening = screening
  shortlist.status = screening.status === 'Completed' ? 'AI screening completed' : 'AI screening in progress'
  await syncShortlistedCandidateToSupabase(shortlist)

  response.json({ screening, shortlist, shortlists: state.shortlists, notifications: state.notifications })
})

app.get('/api/public/screening/:id', (request, response) => {
  const shortlist = findShortlistByScreeningInvite(request, response)

  if (!shortlist) {
    return
  }

  response.json({ screening: publicScreeningPayload(shortlist) })
})

app.post('/api/public/screening/:id/message', async (request, response) => {
  const shortlist = findShortlistByScreeningInvite(request, response)

  if (!shortlist) {
    return
  }

  const text = String(request.body.text || '').trim()
  const mode = request.body.mode === 'voice' ? 'voice' : 'text'

  if (!text) {
    response.status(400).json({ error: 'Answer is required' })
    return
  }

  const screening = ensureScreeningSession(shortlist)

  if (screening.status === 'Completed') {
    response.status(409).json({ error: 'This screening is already completed' })
    return
  }

  const createdAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  screening.messages.push({
    id: `screen-msg-${Date.now()}-candidate`,
    sender: 'candidate',
    mode,
    text,
    createdAt,
  })

  if (mode === 'voice') {
    screening.voiceTranscripts.push({
      id: `voice-${Date.now()}`,
      text,
      createdAt,
    })
  }

  const nextQuestionIndex = screening.currentQuestionIndex + 1
  screening.currentQuestionIndex = nextQuestionIndex

  if (nextQuestionIndex < screening.questions.length) {
    screening.messages.push({
      id: `screen-msg-${Date.now()}-ai`,
      sender: 'ai',
      mode: 'text',
      text: screening.questions[nextQuestionIndex],
      createdAt,
    })
  } else {
    screening.status = 'Completed'
    shortlist.status = 'AI screening completed'
    state.notifications.unshift({
      id: `n-${Date.now()}`,
      text: `${shortlist.candidate} completed AI screening for ${shortlist.bestRole || shortlist.jobTitle}.`,
      read: false,
    })
  }

  screening.evaluation = createScreeningEvaluation(shortlist, screening)
  await syncShortlistedCandidateToSupabase(shortlist)

  response.json({ screening: publicScreeningPayload(shortlist) })
})

app.patch('/api/recruitment/shortlist/:id/selection', async (request, response) => {
  const actorRole = request.body.actorRole || 'employee'
  if (!['admin', 'recruiter'].includes(actorRole)) {
    response.status(403).json({ error: 'Only HR Recruiter or Management Admin can mark candidates as selected' })
    return
  }

  const shortlist = state.shortlists.find((item) => item.id === request.params.id)
  if (!shortlist) {
    response.status(404).json({ error: 'Shortlisted candidate not found' })
    return
  }

  const actorName = request.body.actorName || 'HR Recruiter'
  shortlist.status = 'Selected by HR'
  shortlist.selected = true
  shortlist.selectedBy = actorName
  shortlist.selectedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  shortlist.selectionNote = `Final selection marked by ${actorName}. AI score was advisory only.`
  await syncShortlistedCandidateToSupabase(shortlist)

  state.notifications.unshift({
    id: `n-${Date.now()}`,
    text: `${actorName} marked ${shortlist.candidate} as selected for ${shortlist.bestRole || shortlist.jobTitle}.`,
    read: false,
  })

  response.json({ shortlist, shortlists: state.shortlists, notifications: state.notifications })
})

app.delete('/api/recruitment/shortlist/:id', async (request, response) => {
  const shortlist = state.shortlists.find((item) => item.id === request.params.id)
  if (!shortlist) {
    response.status(404).json({ error: 'Shortlisted candidate not found' })
    return
  }

  state.shortlists = state.shortlists.filter((item) => item.id !== request.params.id)
  if (supabaseAdmin) {
    await supabaseAdmin
      .from('shortlisted_candidates')
      .delete()
      .eq('app_record_id', request.params.id)
  }
  response.json({ removed: shortlist, shortlists: state.shortlists })
})

app.delete('/api/recruitment/shortlist', async (_request, response) => {
  const removedCount = state.shortlists.length
  state.shortlists = []
  await syncShortlistedCandidatesToSupabase()
  response.json({ removedCount, shortlists: state.shortlists })
})

function answerHrQuery(queryText) {
  const query = String(queryText || '').toLowerCase()
  return query.includes('payslip')
    ? 'Your May 2026 payslip is available in Payroll > Salary slips. You can download it from the salary slip list.'
    : query.includes('attendance')
      ? 'Your attendance this month is 96%, with one late login.'
      : query.includes('leave')
        ? 'You have 8 leave days available: 5 casual, 2 sick, and 1 earned leave.'
        : 'I can help with leave balance, attendance, salary slips, and HR policy questions.'
}

app.post('/api/ai/chat', (request, response) => {
  response.json({ answer: answerHrQuery(request.body.query) })
})

app.post('/api/ai/voice', (request, response) => {
  const transcript = String(request.body.transcript || '').trim()

  if (transcript) {
    state.voiceListening = false
    response.json({
      listening: false,
      transcript,
      answer: answerHrQuery(transcript),
    })
    return
  }

  state.voiceListening = !state.voiceListening
  response.json({
    listening: state.voiceListening,
    transcript: state.voiceListening ? 'Listening for an HR voice query...' : 'Voice query stopped.',
    answer: '',
  })
})

app.post('/api/notifications/read', async (_request, response) => {
  state.notifications = state.notifications.map((notification) => ({ ...notification, read: true }))
  await syncNotificationsToSupabase()
  response.json({ notifications: state.notifications })
})

app.patch('/api/notifications/:id/read', async (request, response) => {
  const notification = state.notifications.find((item) => item.id === request.params.id)
  if (!notification) {
    response.status(404).json({ error: 'Notification not found' })
    return
  }

  notification.read = true
  await syncNotificationToSupabase(notification)
  response.json({ notification, notifications: state.notifications })
})

app.get('/api/dashboard/export', (_request, response) => {
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('Content-Disposition', 'attachment; filename="ai-hrms-dashboard-export.json"')
  response.send(JSON.stringify(getBootstrap(), null, 2))
})

if (existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath))
  app.get(/.*/, (request, response, next) => {
    if (request.path.startsWith('/api')) {
      next()
      return
    }

    response.sendFile(clientIndexPath)
  })
}

await loadHrmsStateFromSupabase()
await loadAnalyticsFromSupabase()
updateEmployeeStatusesFromLeaveRequests()
await saveHrmsStateToSupabase()
await syncEmployeesToSupabase()
await syncLeaveRequestsToSupabase()
await syncShortlistedCandidatesToSupabase()
await syncAnnouncementsToSupabase()
await syncNotificationsToSupabase()
await syncJobsToSupabase()
await syncSalarySlipsToSupabase()
await syncModuleRecordsToSupabase(cloneData(state))

const server = app.listen(port, () => {
  console.log(`AI-HRMS API running on http://localhost:${port}`)
})

server.keepAliveTimeout = 65000
setInterval(() => {
  pullExternalSupabaseStateChanges().catch((error) => {
    console.warn(`[storage] Supabase live pull failed: ${error.message}`)
  })
}, 7000)
setInterval(() => {}, 60 * 60 * 1000)
