import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Calendar as CalendarIcon, Clock, MapPin, Video, Plus, Filter, X, ChevronLeft, ChevronRight, FileText, Upload, AlertCircle, CheckCircle } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { appointmentAPI, parentAPI } from '../../api';
import { childAPI } from '../../api';
import { APPOINTMENT_STATUS, normalizeAppointmentStatus } from '../../utils/workflowStatus';
import { CaseStatusBadge } from '../CaseStatusBadge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

// ─── Status Config ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  PENDING: { color: 'text-accent-foreground', bg: 'bg-accent/15', label: 'Pending' },
  APPROVED: { color: 'text-primary', bg: 'bg-secondary', label: 'Approved' },
  REJECTED: { color: 'text-destructive', bg: 'bg-muted', label: 'Rejected' },
  COMPLETED: { color: 'text-foreground', bg: 'bg-muted', label: 'Completed' },
  CANCELLED: { color: 'text-destructive', bg: 'bg-muted', label: 'Cancelled' },
};

const TYPE_LABELS: Record<string, string> = {
  DIAGNOSTIC: 'Diagnostic',
  THERAPY: 'Therapy',
  LAB_TEST: 'Lab Test',
};

interface Child {
  _id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

interface Professional {
  _id: string;
  name: string;
  email: string;
  specialization: string | null;
  role: string;
}

interface Appointment {
  _id: string;
  appointmentType: string;
  preferredDate: string;
  preferredTime: string;
  finalDate?: string;
  finalTime?: string;
  mode: string;
  reason: string;
  status: string;
  rejectionReason?: string;
  completionNotes?: string;
  additionalNotes?: string;
  documents?: string[];
  professional: {
    _id: string;
    firstName?: string;
    lastName?: string;
    labName?: string;
    specialization?: string;
    role: string;
  };
  childInfo?: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
  };
  rescheduleHistory?: Array<{
    oldDate: string;
    oldTime: string;
    newDate: string;
    newTime: string;
    changedAt: string;
  }>;
  auditTrail?: Array<{
    action: string;
    timestamp: string;
    details?: string;
  }>;
  createdAt: string;
}

// ─── Booking Form Component ──────────────────────────────────────────────────

function BookingForm({
  children,
  onClose,
  onSuccess,
  embedded = false,
}: {
  children: Child[];
  onClose: () => void;
  onSuccess: () => void;
  /** When true, render as a main-panel card (sidebar stays visible) instead of a modal dialog. */
  embedded?: boolean;
}) {
  const [formData, setFormData] = useState({
    childId: '',
    appointmentType: '',
    professionalId: '',
    preferredDate: '',
    preferredTime: '',
    reason: '',
    mode: 'IN_PERSON',
    additionalNotes: '',
  });
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [casesByChildId, setCasesByChildId] = useState<Record<string, { caseId: string; status: string }>>({});
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadingProfessionals, setLoadingProfessionals] = useState(false);

  useEffect(() => {
    parentAPI.getCases()
      .then((res) => {
        const rows = (res.data?.data || []) as Array<{ caseId: string; childId: string; status?: string }>;
        const map: Record<string, { caseId: string; status: string }> = {};
        rows.forEach((r) => {
          map[String(r.childId)] = { caseId: String(r.caseId), status: String(r.status || '') };
        });
        setCasesByChildId(map);
      })
      .catch(() => setCasesByChildId({}));
  }, []);

  const selectedCase = formData.childId ? casesByChildId[String(formData.childId)] : null;
  const selectedCaseStatus = String(selectedCase?.status || '');
  const canBookAppointment = ['REVIEW'].includes(selectedCaseStatus);

  // Fetch professionals when type changes
  useEffect(() => {
    if (!formData.appointmentType) {
      setProfessionals([]);
      setFormData(prev => ({ ...prev, professionalId: '' }));
      return;
    }
    setLoadingProfessionals(true);
    appointmentAPI.getAvailableProfessionals(formData.appointmentType)
      .then(res => {
        setProfessionals(res.data.data);
        setFormData(prev => ({ ...prev, professionalId: '' }));
      })
      .catch(() => setProfessionals([]))
      .finally(() => setLoadingProfessionals(false));
  }, [formData.appointmentType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!selectedCase?.caseId) {
        throw new Error('No case found for this child. Start screening first.');
      }
      if (!canBookAppointment) {
        throw new Error('Complete screening before booking clinician appointment.');
      }
      const fd = new FormData();
      fd.append('caseId', String(selectedCase.caseId));
      fd.append('childId', formData.childId);
      fd.append('appointmentType', formData.appointmentType);
      fd.append('professionalId', formData.professionalId);
      fd.append('preferredDate', formData.preferredDate);
      fd.append('preferredTime', formData.preferredTime);
      fd.append('reason', formData.reason);
      fd.append('mode', formData.mode);
      fd.append('additionalNotes', formData.additionalNotes);
      if (files) {
        Array.from(files).forEach(file => fd.append('documents', file));
      }

      await appointmentAPI.create(fd);
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create appointment');
    } finally {
      setLoading(false);
    }
  };

  // Get min date (tomorrow)
  const today = new Date();
  today.setDate(today.getDate() + 1);
  const minDate = today.toISOString().split('T')[0];

  const formInner = (
    <>
          {error && (
            <div className="p-3 bg-muted border rounded-lg flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Child Selection */}
          <div className="form-field">
            <label className="block text-sm font-medium text-foreground">Select Child *</label>
            <select
              required
              autoFocus
              value={formData.childId}
              onChange={e => setFormData(prev => ({ ...prev, childId: e.target.value }))}
              className="input"
            >
              <option value="">Choose a child...</option>
              {children.map(c => (
                <option key={c._id} value={c._id}>{c.firstName} {c.lastName}</option>
              ))}
            </select>
            {formData.childId ? (
              <div className="mt-2">
                <CaseStatusBadge status={selectedCaseStatus || 'NEW'} />
              </div>
            ) : null}
            {formData.childId && !canBookAppointment ? (
              <p className="mt-2 text-xs text-muted-foreground">Not available in current stage</p>
            ) : null}
          </div>

          {/* Appointment Type */}
          <div className="form-field">
            <label className="block text-sm font-medium text-foreground">Appointment Type *</label>
            <select
              required
              value={formData.appointmentType}
              onChange={e => setFormData(prev => ({ ...prev, appointmentType: e.target.value }))}
              className="input"
            >
              <option value="">Choose type...</option>
              <option value="DIAGNOSTIC">Diagnostic (Clinician)</option>
              <option value="THERAPY">Therapy (Therapist)</option>
              <option value="LAB_TEST">Lab Test (Laboratory)</option>
            </select>
          </div>

          {/* Professional */}
          <div className="form-field">
            <label className="block text-sm font-medium text-foreground">Select Professional *</label>
            <select
              required
              value={formData.professionalId}
              onChange={e => setFormData(prev => ({ ...prev, professionalId: e.target.value }))}
              disabled={!formData.appointmentType || loadingProfessionals}
              className="input disabled:bg-muted"
            >
              <option value="">{loadingProfessionals ? 'Loading...' : 'Choose professional...'}</option>
              {professionals.map(p => (
                <option key={p._id} value={p._id}>
                  {p.name}{p.specialization ? ` — ${p.specialization}` : ''}
                </option>
              ))}
            </select>
            {formData.appointmentType && professionals.length === 0 && !loadingProfessionals && (
              <p className="text-xs text-destructive mt-1">No approved professionals available for this type</p>
            )}
          </div>

          {/* Date & Time */}
          <div className="form-grid-2">
            <div className="form-field">
              <label className="block text-sm font-medium text-foreground">Preferred Date *</label>
              <input
                type="date"
                required
                min={minDate}
                value={formData.preferredDate}
                onChange={e => setFormData(prev => ({ ...prev, preferredDate: e.target.value }))}
                className="input"
              />
            </div>
            <div className="form-field">
              <label className="block text-sm font-medium text-foreground">Preferred Time *</label>
              <input
                type="time"
                required
                value={formData.preferredTime}
                onChange={e => setFormData(prev => ({ ...prev, preferredTime: e.target.value }))}
                className="input"
              />
            </div>
          </div>

          {/* Mode */}
          <div className="form-field">
            <label className="block text-sm font-medium text-foreground">Mode *</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="IN_PERSON"
                  checked={formData.mode === 'IN_PERSON'}
                  onChange={e => setFormData(prev => ({ ...prev, mode: e.target.value }))}
                  className="text-primary focus-visible:ring-ring/50"
                />
                <MapPin className="w-4 h-4 text-primary" />
                <span className="text-sm">In-Person</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="ONLINE"
                  checked={formData.mode === 'ONLINE'}
                  onChange={e => setFormData(prev => ({ ...prev, mode: e.target.value }))}
                  className="text-primary focus-visible:ring-ring/50"
                />
                <Video className="w-4 h-4 text-primary" />
                <span className="text-sm">Online</span>
              </label>
            </div>
          </div>

          {/* Reason */}
          <div className="form-field">
            <label className="block text-sm font-medium text-foreground">Reason / Symptoms *</label>
            <textarea
              required
              rows={3}
              maxLength={2000}
              value={formData.reason}
              onChange={e => setFormData(prev => ({ ...prev, reason: e.target.value }))}
              className="input h-auto py-3"
              placeholder="Describe symptoms, concerns, or reason for appointment..."
            />
          </div>

          {/* Documents */}
          <div className="form-field">
            <label className="block text-sm font-medium text-foreground">Documents (optional)</label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 px-4 py-2 border rounded-lg cursor-pointer hover:bg-muted transition-colors">
                <Upload className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{files ? `${files.length} file(s)` : 'Upload files'}</span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  onChange={e => setFiles(e.target.files)}
                  className="hidden"
                />
              </label>
              <span className="text-xs text-muted-foreground">Max 25MB per file</span>
            </div>
          </div>

          {/* Additional Notes */}
          <div className="form-field">
            <label className="block text-sm font-medium text-foreground">Additional Notes</label>
            <textarea
              rows={2}
              maxLength={1000}
              value={formData.additionalNotes}
              onChange={e => setFormData(prev => ({ ...prev, additionalNotes: e.target.value }))}
              className="input h-auto py-3"
              placeholder="Any additional information..."
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !canBookAppointment}
              className="flex-1"
              variant="accent"
            >
              {loading ? 'Submitting...' : 'Book Appointment'}
            </Button>
          </div>
    </>
  );

  if (embedded) {
    return (
      <Card className="w-full max-w-3xl border-border shadow-md">
        <CardHeader className="border-b pb-4">
          <CardTitle>Book Appointment</CardTitle>
          <CardDescription>Schedule a healthcare appointment for your child.</CardDescription>
        </CardHeader>
        <CardContent className="max-h-[calc(100dvh-12rem)] overflow-y-auto pt-6">
          <form onSubmit={handleSubmit} className="form">
            {formInner}
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4 text-left">
          <DialogTitle>Book Appointment</DialogTitle>
          <DialogDescription>Schedule a healthcare appointment for your child.</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="form max-h-[calc(90vh-9rem)] min-h-0 overflow-y-auto overscroll-contain px-6 py-4"
        >
          {formInner}
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Timeline Component ──────────────────────────────────────────────────────

function AppointmentTimeline({ appointment }: { appointment: Appointment }) {
  const entries = [
    ...(appointment.auditTrail || []).map(a => ({
      action: a.action,
      date: a.timestamp,
      details: a.details || ''
    })),
    ...(appointment.rescheduleHistory || []).map(r => ({
      action: 'RESCHEDULED',
      date: r.changedAt,
      details: `From ${new Date(r.oldDate).toLocaleDateString()} ${r.oldTime} → ${new Date(r.newDate).toLocaleDateString()} ${r.newTime}`
    }))
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (entries.length === 0) return null;

  return (
    <div className="mt-3 p-3 bg-muted rounded-lg">
      <p className="text-xs font-semibold text-muted-foreground mb-2">Timeline</p>
      <div className="space-y-2">
        {entries.map((entry, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <div className="w-2 h-2 rounded-full bg-yellow-400 mt-1 flex-shrink-0" />
            <div>
              <span className="font-medium text-foreground">{entry.action}</span>
              <span className="text-muted-foreground ml-2">{new Date(entry.date).toLocaleString()}</span>
              {entry.details && <p className="text-muted-foreground mt-0.5">{entry.details}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface AppointmentsSectionProps {
  initialShowBooking?: boolean;
  formOnly?: boolean;
}

export function AppointmentsSection({ initialShowBooking = false, formOnly = false }: AppointmentsSectionProps = {}) {
  const [showBooking, setShowBooking] = useState(initialShowBooking);
  const [bookingAcknowledged, setBookingAcknowledged] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 0 });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, limit: 10 };
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.type = typeFilter;

      const res = await appointmentAPI.getMyAppointments(params);
      setAppointments(res.data.data);
      setPagination(res.data.pagination);
    } catch {
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, typeFilter]);

  const fetchChildren = async () => {
    try {
      const res = await childAPI.getChildren();
      setChildren(res.data.data || []);
    } catch {
      setChildren([]);
    }
  };

  useEffect(() => { if (!formOnly) fetchAppointments(); }, [fetchAppointments, formOnly]);
  useEffect(() => { fetchChildren(); }, []);

  const handleCancel = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this appointment?')) return;
    try {
      await appointmentAPI.cancel(id);
      fetchAppointments();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to cancel');
    }
  };

  const handleBookingSuccess = () => {
    setShowBooking(false);
    setBookingAcknowledged(true);
    setPage(1);
    setStatusFilter('');
    fetchAppointments();
  };

  const getProfName = (prof: Appointment['professional']) =>
    prof.labName || `Dr. ${prof.firstName} ${prof.lastName}`;

  const upcomingStatuses: string[] = [APPOINTMENT_STATUS.PENDING, APPOINTMENT_STATUS.APPROVED];
  const pastStatuses: string[] = [APPOINTMENT_STATUS.COMPLETED, APPOINTMENT_STATUS.REJECTED, APPOINTMENT_STATUS.CANCELLED];

  const upcoming = appointments.filter(a => upcomingStatuses.includes(normalizeAppointmentStatus(a.status)));
  const past = appointments.filter(a => pastStatuses.includes(normalizeAppointmentStatus(a.status)));

  if (formOnly) {
    return (
      <div className="w-full min-w-0 space-y-6">
        {showBooking ? (
          <BookingForm
            children={children}
            embedded
            onClose={() => setShowBooking(false)}
            onSuccess={handleBookingSuccess}
          />
        ) : bookingAcknowledged ? (
          <Card className="border-primary/25 bg-primary/5">
            <CardContent className="flex flex-col items-center justify-center gap-4 px-6 py-12 text-center sm:px-10">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
                <CheckCircle className="h-8 w-8 text-primary" />
              </div>
              <div className="space-y-2 max-w-md">
                <h2 className="text-xl font-semibold text-foreground">Request received</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Your appointment request was submitted successfully. You will see it under{' '}
                  <span className="font-medium text-foreground">Appointments → Appointment status</span> once it is
                  listed, and you will be notified when it is reviewed.
                </p>
              </div>
              <Button
                variant="accent"
                className="mt-2"
                onClick={() => {
                  setBookingAcknowledged(false);
                  setShowBooking(false);
                }}
              >
                Done
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setShowBooking(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Book another appointment
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 px-6">
              <CalendarIcon className="mb-4 h-12 w-12 text-muted-foreground" />
              <h2 className="text-xl font-semibold text-foreground mb-2">Book Appointment</h2>
              <p className="text-muted-foreground text-center mb-6 max-w-md">
                Schedule a healthcare appointment for your child
              </p>
              <Button
                variant="accent"
                onClick={() => setShowBooking(true)}
              >
                <Plus className="w-4 h-4 mr-2" />
                Book Appointment
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-1">Appointments</h2>
        <p className="text-muted-foreground">Manage your children's healthcare appointments</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Filter:</span>
            </div>
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
              className="input h-9 w-auto px-3 py-1.5 text-sm"
            >
              <option value="">All Statuses</option>
              {Object.entries(STATUS_CONFIG).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
              className="input h-9 w-auto px-3 py-1.5 text-sm"
            >
              <option value="">All Types</option>
              {Object.entries(TYPE_LABELS).map(([key, val]) => (
                <option key={key} value={key}>{val}</option>
              ))}
            </select>
            {(statusFilter || typeFilter) && (
              <button
                onClick={() => { setStatusFilter(''); setTypeFilter(''); setPage(1); }}
                className="text-xs text-primary hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Appointments */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : appointments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <CalendarIcon className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">No appointments found</h3>
            <p className="text-muted-foreground text-center mb-4">
              {statusFilter || typeFilter ? 'Try adjusting your filters.' : 'No appointments found. Use the Book Appointment menu to schedule one.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="upcoming">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upcoming">Active ({upcoming.length})</TabsTrigger>
            <TabsTrigger value="past">Past ({past.length})</TabsTrigger>
          </TabsList>

          {[{ key: 'upcoming', items: upcoming }, { key: 'past', items: past }].map(({ key, items }) => (
            <TabsContent key={key} value={key} className="space-y-4 mt-4">
              {items.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No {key} appointments
                  </CardContent>
                </Card>
              ) : items.map(apt => {
                const normStatus = normalizeAppointmentStatus(apt.status);
                const sc = STATUS_CONFIG[normStatus] || { color: 'text-foreground', bg: 'bg-muted', label: normStatus || String(apt.status) };
                const isExpanded = expandedId === apt._id;

                return (
                  <Card
                    key={apt._id}
                    className={`border-l-4 transition-shadow hover:shadow-lg ${
                      normStatus === APPOINTMENT_STATUS.APPROVED
                        ? 'border-l-primary'
                        : normStatus === APPOINTMENT_STATUS.PENDING
                          ? 'border-l-accent'
                          : normStatus === APPOINTMENT_STATUS.REJECTED
                            ? 'border-l-destructive'
                            : normStatus === APPOINTMENT_STATUS.COMPLETED
                              ? 'border-l-border'
                              : 'border-l-border'
                    }`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-1">
                            <CardTitle className="text-lg text-foreground">
                              {TYPE_LABELS[apt.appointmentType] || apt.appointmentType}
                            </CardTitle>
                            <Badge className={`${sc.bg} ${sc.color} border-0`}>{sc.label}</Badge>
                            <Badge className={apt.mode === 'ONLINE' ? 'bg-secondary text-primary border-0' : 'bg-muted text-foreground border-0'}>
                              {apt.mode === 'ONLINE' ? <><Video className="w-3 h-3 mr-1" /> Online</> : <><MapPin className="w-3 h-3 mr-1" /> In-Person</>}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{getProfName(apt.professional)}</p>
                          {apt.professional.specialization && (
                            <p className="text-xs text-muted-foreground">{apt.professional.specialization}</p>
                          )}
                        </div>
                        <div className="text-right text-sm text-muted-foreground">
                          <div className="flex items-center gap-1 justify-end">
                            <CalendarIcon className="w-4 h-4" />
                            {new Date(apt.finalDate || apt.preferredDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </div>
                          <div className="flex items-center gap-1 justify-end mt-1">
                            <Clock className="w-4 h-4" />
                            {apt.finalTime || apt.preferredTime}
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Patient</p>
                          <p className="font-medium text-foreground">
                            {apt.childInfo ? `${apt.childInfo.firstName} ${apt.childInfo.lastName}` : 'N/A'}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Reason</p>
                          <p className="text-foreground line-clamp-2">{apt.reason}</p>
                        </div>
                      </div>

                      {apt.rejectionReason && (
                        <div className="p-3 bg-muted rounded-lg">
                          <p className="text-xs text-destructive font-medium mb-1">Rejection Reason:</p>
                          <p className="text-sm text-destructive">{apt.rejectionReason}</p>
                        </div>
                      )}

                      {apt.completionNotes && (
                        <div className="p-3 bg-primary/20 rounded-lg">
                          <p className="text-xs text-primary font-medium mb-1">Completion Notes:</p>
                          <p className="text-sm text-primary">{apt.completionNotes}</p>
                        </div>
                      )}

                      {isExpanded && <AppointmentTimeline appointment={apt} />}

                      <div className="flex gap-2 pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setExpandedId(isExpanded ? null : apt._id)}
                        >
                          {isExpanded ? 'Hide Details' : 'View History'}
                        </Button>
                        {(normStatus === APPOINTMENT_STATUS.PENDING || normStatus === APPOINTMENT_STATUS.APPROVED) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:bg-muted"
                            onClick={() => handleCancel(apt._id)}
                          >
                            <X className="w-4 h-4 mr-1" /> Cancel
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {pagination.pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pagination.pages}
            onClick={() => setPage(p => p + 1)}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

    </div>
  );
}
