import axios from 'axios';

function normalizeApiBaseUrl(raw) {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  // If user sets VITE_API_BASE_URL to the origin only, append `/api`.
  // If they already include `/api`, keep it.
  return value.endsWith('/api') ? value : `${value}/api`;
}

const API = axios.create({
  baseURL: normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL) || 'http://localhost:4000/api',
  withCredentials: true
});

// Request interceptor to add auth token
API.interceptors.request.use(
  (config) => {
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — auto-logout on 401 (stale/invalid token)
API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Token is invalid or user no longer exists — clear everything and redirect
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      localStorage.removeItem('firstName');
      localStorage.removeItem('lastName');
      localStorage.removeItem('email');
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('role');
      sessionStorage.removeItem('firstName');
      sessionStorage.removeItem('lastName');
      sessionStorage.removeItem('email');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Child API endpoints
export const childAPI = {
  getChildren: () => API.get('/child'),
  getChildById: (childId) => API.get(`/child/${childId}`),
  createChild: (childData) => API.post('/child', childData),
  updateChild: (childId, childData) => API.put(`/child/${childId}`, childData),
  deleteChild: (childId) => API.delete(`/child/${childId}`),
  getChildScreeningStatus: (childId) => API.get(`/screening/child/${childId}/screening-status`),
};

export const screeningAPI = {
  calculateScreening: (screeningData) => API.post('/screening/calculate-screening', screeningData),
  getQuestionnaireByType: (type) => API.get(`/screening/questionnaires/${type}`),
  getAvailableQuestionnaires: () => API.get('/screening/available-questionnaires'),
  getScreeningPlan: (childId) => API.get('/screening/screening-plan', { params: { childId } }),
  getScreeningHistory: () => API.get('/screening/screening-history'),
  getSubmissionById: (id) => API.get(`/screening/submission/${id}`),
  downloadSubmissionReport: (id) => API.get(`/screening/submission/${id}/download`, { responseType: 'blob' }),
  getChildScreeningStatus: (childId) => API.get(`/screening/child/${childId}/screening-status`),
  getScreeningStats: () => API.get('/screening/stats'),
  getAvailableCliniciansAndTherapists: () => API.get('/screening/available-clinicians-therapists')
};

export const facialScreeningAPI = {
  predict: (formData) =>
    API.post('/facial-screening/predict', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

// Lab API endpoints
export const labAPI = {
  // Lab technician endpoints
  getStats: () => API.get('/lab/stats'),
  getRequests: (params) => API.get('/lab/requests', { params }),
  getRequestById: (id) => API.get(`/lab/requests/${id}`),
  acceptRequest: (id) => API.patch(`/lab/requests/${id}/accept`),
  uploadReport: (formData, onUploadProgress) =>
    API.post('/lab/reports/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress
    }),
  getReportById: (id) => API.get(`/lab/reports/${id}`),
  getAllReports: () => API.get('/lab/reports'),

  // Clinician endpoints (no leading `/` so path stays under baseURL `/api`)
  getClinicianRequests: (params) => API.get('lab/clinician/requests', { params }),
  getClinicianRequestById: (id) => API.get(`lab/clinician/requests/${id}`),
  releaseReport: (id) => API.patch(`lab/clinician/requests/${id}/release`),
  searchParents: (search) => API.get('lab/clinician/parents', { params: { search } }),
  createTestRequest: (data) => API.post('lab/clinician/requests', data),

  // Parent endpoints
  getParentReports: () => API.get('/lab/parent/reports')
};

// New lab catalog endpoints (discriminator-safe module)
export const labTestsAPI = {
  getMyTests: () => API.get('/lab-tests/my-tests', { timeout: 15000 }),
  getAll: () => API.get('/lab-tests/all', { timeout: 15000 }),
  getByTest: (testName) =>
    API.get(`/lab-tests/by-test/${encodeURIComponent(String(testName))}`, { timeout: 15000 }),
  create: (payload) => API.post('/lab-tests', payload, { timeout: 15000 }),
  update: (id, payload) => API.put(`/lab-tests/${id}`, payload, { timeout: 15000 }),
  remove: (id) => API.delete(`/lab-tests/${id}`, { timeout: 15000 }),
};

export const labRequestsAPI = {
  create: (payload) => API.post('/lab-requests', payload),
  getByChild: (childId) => API.get(`/lab-requests/by-child/${encodeURIComponent(String(childId))}`),
  getMyRequests: () => API.get('/lab-requests/my-requests'),
  accept: (id) => API.put(`/lab-requests/${id}/accept`),
  uploadReport: (id, payload) =>
    API.put(`/lab-requests/${id}/upload-report`, payload, payload instanceof FormData
      ? { headers: { 'Content-Type': 'multipart/form-data' } }
      : undefined),
};

// Therapist API endpoints
export const therapistAPI = {
  getDashboardStats: () => API.get('/therapist/dashboard-stats'),
  /** Metrics + lists (assignedCases, upcoming, alerts) for therapist home. */
  getDashboardSummary: () => API.get('therapist/dashboard-summary'),
  getDashboard: () => API.get('therapist/dashboard'),
  startTherapyFromReferral: (id) => API.patch(`therapist/referrals/${id}/start-therapy`),
  /** Therapist recommendation note stored as case clinician note (active therapy cases only). */
  addTherapistRecommendation: (payload) => API.post('therapist/recommendations', payload),
  /** Aggregated case file for tabbed UI (child, parent, referral, plan, sessions, assignments). */
  getCaseFile: (caseId) => API.get(`therapist/case/${caseId}`),
  createAssignment: (caseId, payload) => API.post(`/therapist/cases/${caseId}/assignments`, payload),
  getAssignmentsByCase: (caseId) => API.get(`/therapist/cases/${caseId}/assignments`),
  /** REST aliases: POST /api/assignments, GET /api/assignments/case/:caseId, PATCH review */
  createHomeAssignment: (payload) => API.post('assignments', payload),
  /** All assignments for logged-in therapist (childName, caseId, status, dueDate). */
  listAllHomeAssignments: () => API.get('assignments'),
  /** Dashboard metrics: active, completed, new submissions, behind schedule. */
  getHomeAssignmentsSummary: () => API.get('assignments/summary'),
  getHomeAssignmentsByCase: (caseId) => API.get(`assignments/case/${caseId}`),
  reviewHomeAssignment: (id, payload) => API.patch(`assignments/${id}/review`, payload),
  createSessionLog: (caseId, payload) => API.post(`/therapist/cases/${caseId}/sessions`, payload),
};

/** Session logs (also integrated with case file; same schema as therapist/cases/:caseId/sessions). */
export const sessionAPI = {
  /** All sessions for logged-in therapist (enriched with childName, therapyDomain). */
  listAll: () => API.get('/sessions'),
  create: (payload) => API.post('/sessions', payload),
  getByCase: (caseId) => API.get(`sessions/case/${caseId}`),
  update: (id, payload) => API.patch(`sessions/${id}`, payload),
  sign: (id) => API.patch(`sessions/${id}/sign`),
};

/** Recurring therapy schedules + generated session slots (not appointment booking). */
export const scheduleAPI = {
  create: (payload) => API.post('/schedules', payload),
  /** Therapist Schedule tab: one request for rules + slots (same auth as case file). */
  getTherapistScheduleBundle: (caseId) => API.get(`therapist/case/${caseId}/schedule-bundle`),
  getByCase: (caseId) => API.get(`therapist/case/${caseId}/schedules`),
  getSessionSlots: (caseId) => API.get(`therapist/case/${caseId}/session-slots`),
  updateSessionSlot: (slotId, payload) => API.patch(`therapist/session-slots/${slotId}`, payload),
  /** Parent / clinician / therapist — generic case access (used on parent dashboard). */
  getSessionSlotsPublic: (caseId) => API.get(`sessionslots/${caseId}`),
};

/** Activity library: templates + legacy CRUD (therapist-owned). */
export const activityAPI = {
  list: (params) => API.get('activities', { params }),
  create: (payload) => API.post('activities', payload),
  update: (id, payload) => API.patch(`activities/${id}`, payload),
  clone: (id) => API.post(`activities/${id}/clone`),
  /** Longer timeout: large template lists / slow DB can otherwise leave UI stuck on “Loading…”. */
  listTemplates: (params) => API.get('activities/templates', { params, timeout: 60000 }),
  createTemplate: (payload) => API.post('activities/templates', payload),
  updateTemplate: (id, payload) => API.patch(`activities/templates/${id}`, payload),
  cloneTemplate: (id) => API.post(`activities/templates/${id}/clone`),
  assign: (id, payload) => API.post(`activities/${id}/assign`, payload),
};

/** Therapist therapy plan CRUD (domains, long/short goals, activities). */
export const therapyPlanAPI = {
  list: () => API.get('therapy-plan'),
  create: (payload) => API.post('therapy-plan', payload),
  getByCase: (caseId) => API.get(`therapy-plan/${caseId}`),
  getAssignContext: (caseId) => API.get(`therapy-plan/case/${caseId}/assign-context`),
  assignPlan: (payload) => API.post('therapy-plan/assign', payload),
  update: (planId, payload) => API.patch(`therapy-plan/${planId}`, payload),
  /** Therapist requests clinician sign-off on the plan document. */
  submitForApproval: (planId) => API.post(`therapy-plan/submit-for-approval/${planId}`),
  /** POST /therapy-plan/duplicate { originalPlanId, caseId } (childId optional, from case if omitted) */
  duplicatePlan: (payload) => API.post('therapy-plan/duplicate', payload),
  duplicate: (planId, payload) => API.post(`therapy-plan/${planId}/duplicate`, payload),
};

// Parent API endpoints
export const parentAPI = {
  getScreenings: () => API.get('/parent/screenings'),
  /** ChildCase rows for parent (caseId, childId, childName) — integration dashboard. */
  getCases: () => API.get('/parent/cases'),
  /** Session summaries + parentInstructions (therapist → parent). */
  getCaseSessions: (caseId) => API.get(`parent/case/${caseId}/sessions`),
  /** Home assignments for one case (activity name, due date, status). */
  getCaseAssignments: (caseId) => API.get(`parent/case/${caseId}/assignments`),
  /** Lab orders for one case (status + released files). */
  getCaseLabRequests: (caseId) => API.get(`parent/case/${caseId}/lab-requests`),
  getHomeAssignments: () => API.get('/parent/home-assignments'),
  getAssignmentsByCase: (caseId) => API.get(`parent/assignments/${caseId}`),
  /** Multipart: pass browser FormData with field "file" (server sets submissionUrl from upload). */
  submitAssignmentEvidence: (id, formData) => API.patch(`parent/assignments/${id}/submit`, formData),
  /** JSON submit: { submissionUrl, fileType: 'image' | 'video' } */
  submitAssignmentEvidenceUrl: (id, payload) => API.patch(`parent/assignments/${id}/submit`, payload),
  completeAssignment: (id) => API.patch(`parent/assignments/${id}/complete`),
  /** Therapist session parentInstructions visible to parent (optional childId filter). */
  getTherapySessionInstructions: (params) =>
    API.get('/parent/therapy-session-instructions', { params }),
  /** Therapy session slots (scheduled times — not appointment booking). */
  getSessionSlots: (caseId) => API.get(`sessionslots/${caseId}`),
};

/** Case-centric integration (parent / clinician / therapist with case access). */
export const integrationAPI = {
  getCaseProgress: (caseId) => API.get(`case/${caseId}/progress`),
  getCaseSummary: (caseId) => API.get(`case/${caseId}/summary`),
};

// Clinician API endpoints (no leading `/` so path stays under baseURL `/api`)
export const clinicianAPI = {
  /** Bulk progress snapshots for clinician dashboard (single round-trip). */
  getCaseloadProgress: () => API.get('clinician/caseload-progress'),
  getScreeningReviews: () => API.get('clinician/screening-reviews'),
  /** Record screening triage decision (clear / monitor / refer). */
  recordScreeningDecision: (submissionId, payload) =>
    API.patch(`clinician/screening-reviews/${submissionId}/decision`, payload),
  /** Approve a therapy plan pending clinician review (PATCH). */
  approveTherapyPlan: (planId) => API.patch(`clinician/therapy-plans/${planId}/approve`),
};

// Child case management (clinician only)
export const caseAPI = {
  list: (params) => API.get('cases', { params }),
  getById: (id) => API.get(`cases/${id}`),
  updateMrNumber: (id, mrNumber) => API.patch(`cases/${id}/mr-number`, { mrNumber }),
};

// Clinical evaluations (clinician only)
export const evaluationAPI = {
  create: (payload) => API.post('evaluations', payload),
  listByCase: (caseId) => API.get(`evaluations/${caseId}`),
  getById: (id) => API.get(`evaluations/single/${id}`),
  updateVersion: (id, payload) => API.patch(`evaluations/${id}`, payload),
  getDevelopmentSummary: (caseId) => API.get(`evaluations/${caseId}/development-summary`),
};

// Referrals (clinician -> therapist workflow)
export const referralAPI = {
  // Clinician
  create: (payload) => API.post('referrals', payload),
  getByCase: (caseId) => API.get(`referrals/case/${caseId}`),

  // Therapist
  getAssigned: () => API.get('referrals/assigned'),
  accept: (id) => API.patch(`referrals/${id}/accept`),
  start: (id) => API.patch(`referrals/${id}/start`),
  letterPdf: (id) => API.get(`referrals/${id}/letter`, { responseType: 'blob' }),
};

// Therapy oversight (clinician read-only on therapy data + recommendation notes)
export const therapyAPI = {
  getPlan: (caseId) => API.get(`therapy/${caseId}/plan`),
  getSessions: (caseId) => API.get(`therapy/${caseId}/sessions`),
  getGoals: (caseId) => API.get(`therapy/${caseId}/goals`),
  getNotes: (caseId) => API.get(`therapy/${caseId}/notes`),
  addNote: (caseId, note) => API.post(`therapy/${caseId}/notes`, { note }),
};

// Progress monitoring analytics (clinician read-only)
export const progressAPI = {
  getOverview: (caseId) => API.get(`progress/${caseId}/overview`),
  getDomain: (caseId, domain) => API.get(`progress/${caseId}/domain/${encodeURIComponent(domain)}`),
  getSessions: (caseId) => API.get(`progress/${caseId}/sessions`),
};

/** Therapist case analytics (aggregated from sessions, plan, assignments). */
export const analyticsAPI = {
  getByCase: (caseId) => API.get(`analytics/${encodeURIComponent(String(caseId))}`),
};

/** Unified progress engine (therapist full; clinician full; parent summary). */
/** Unified clinical events, case timeline, shared case state, admin aggregates. */
export const clinicalIntelligenceAPI = {
  getCaseTimeline: (caseId) => API.get(`case-timeline/${encodeURIComponent(String(caseId))}`),
  getClinicalCaseState: (caseId) => API.get(`clinical-case-state/${encodeURIComponent(String(caseId))}`),
  getGlobalClinicalSummary: () => API.get('global-clinical-analytics/summary'),
};

export const progressEngineAPI = {
  getByCase: (caseId) => API.get(`progress-engine/${encodeURIComponent(String(caseId))}`),
  getSummary: (caseId) => API.get(`progress-engine/${encodeURIComponent(String(caseId))}/summary`),
};

/** Auto-generated therapy reports (therapist generates; parent/clinician read role-filtered types). */
export const reportAPI = {
  generate: (payload) => API.post('reports', payload),
  generateLegacy: (payload) => API.post('reports/generate', payload),
  /** POST /api/reports/generate/:caseId — integrated progress-engine report */
  generateByCaseId: (caseId) => API.post(`reports/generate/${encodeURIComponent(String(caseId))}`),
  listMine: (params) => API.get('reports', { params }),
  listByCase: (caseId) => API.get(`reports/${encodeURIComponent(String(caseId))}`),
  getById: (id) => API.get(`reports/view/${encodeURIComponent(String(id))}`),
  downloadPdf: (reportId) =>
    API.get(`reports/${encodeURIComponent(String(reportId))}/download`, { responseType: 'blob' }),
};

// Appointment API endpoints
export const appointmentAPI = {
  // Parent endpoints
  create: (formData) => API.post('/appointments', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  getMyAppointments: (params) => API.get('/appointments/my', { params }),
  cancel: (id) => API.put(`/appointments/${id}/cancel`),
  getAvailableProfessionals: (type) => API.get(`/appointments/professionals/${type}`),

  // Professional endpoints
  getProfessionalAppointments: (params) => API.get('/appointments/professional', { params }),
  approve: (id, data) => API.put(`/appointments/${id}/approve`, data),
  reject: (id, data) => API.put(`/appointments/${id}/reject`, data),
  reschedule: (id, data) => API.put(`/appointments/${id}/reschedule`, data),
  complete: (id, data) => API.put(`/appointments/${id}/complete`, data),

  // Admin endpoints
  getAll: (params) => API.get('/appointments/all', { params }),
  getStats: () => API.get('/appointments/stats')
};

/** Case-scoped messaging: parent, assigned therapist, and case clinician (Conversation + Message). */
export const messagingAPI = {
  listConversations: () => API.get('messaging/conversations'),
  getOrCreateConversation: (caseId) => API.get(`messaging/conversations/${caseId}`),
  listMessages: (conversationId) => API.get(`messaging/messages/${conversationId}`),
  sendMessage: (payload) => API.post('messaging/messages', payload),
};

// Notifications
export const notificationAPI = {
  list: (params) => API.get('notifications', { params }),
  getCount: () => API.get('notifications/count'),
  markRead: (id) => API.patch(`notifications/${id}/read`),
  markAllRead: () => API.patch('notifications/read-all'),
  remove: (id) => API.delete(`notifications/${id}`),
};

/** Admin operational APIs */
export const adminAPI = {
  getDashboardMetrics: () => API.get('/admin/dashboard-metrics'),
};

export default API;
