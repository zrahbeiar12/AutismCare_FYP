import { useEffect, useMemo, useState } from 'react';
import { ProtectedLink } from '../ui/ProtectedMedia';
import { AlertCircle, CheckCircle, FlaskConical, Loader2, Plus } from 'lucide-react';
import { caseAPI, labRequestsAPI, labTestsAPI } from '../../api';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

type ChildCaseRow = {
  _id: string;
  childId: string;
  childName?: string;
};

type LabTestRow = {
  _id: string;
  test_name: string;
  category?: string;
  description?: string;
  price?: number;
  duration?: string;
  lab?: { _id: string; labName?: string; accreditation?: string };
};

type LabOption = {
  test_id: string;
  test_name: string;
  category?: string;
  lab_id: string;
  labName: string;
  accreditation?: string;
};

type ClinicianRequestRow = {
  _id: string;
  child_id: string;
  test_name: string;
  category?: string;
  labName?: string;
  status: string;
  notes?: string;
  report_url?: string;
  createdAt?: string;
  childName?: string;
};

type Filter = 'ALL' | 'pending' | 'in_progress' | 'completed';

function formatDate(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return '—';
  }
}

function statusStyle(status: string) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'bg-emerald-50 text-emerald-900 border-emerald-200';
  if (s === 'in_progress') return 'bg-blue-50 text-blue-900 border-blue-200';
  return 'bg-amber-50 text-amber-900 border-amber-200';
}

function resolveUploadUrl(filePath?: string) {
  if (!filePath) return '';
  if (filePath.startsWith('http')) return filePath;
  const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
  const origin = base.replace(/\/api\/?$/, '');
  return `${origin}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
}

export function ClinicianLabReports() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [requests, setRequests] = useState<ClinicianRequestRow[]>([]);
  const [cases, setCases] = useState<ChildCaseRow[]>([]);
  const [tests, setTests] = useState<LabTestRow[]>([]);

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedChildId, setSelectedChildId] = useState('');
  const [selectedTestName, setSelectedTestName] = useState('');
  const [labsForTest, setLabsForTest] = useState<LabOption[]>([]);
  const [selectedLabTestId, setSelectedLabTestId] = useState('');
  const [notes, setNotes] = useState('');

  const filteredRequests = useMemo(() => {
    if (filter === 'ALL') return requests;
    return requests.filter((r) => String(r.status).toLowerCase() === filter);
  }, [requests, filter]);

  const uniqueTests = useMemo(() => {
    const map = new Map<string, LabTestRow>();
    for (const row of tests) {
      const key = String(row.test_name || '').toLowerCase();
      if (key && !map.has(key)) map.set(key, row);
    }
    return [...map.values()];
  }, [tests]);

  const loadRequests = async (caseRows: ChildCaseRow[]) => {
    const settled = await Promise.all(
      caseRows.map(async (row) => {
        try {
          const { data } = await labRequestsAPI.getByChild(row.childId);
          const list = Array.isArray(data?.data) ? data.data : [];
          return list.map((r: any) => ({
            ...r,
            childName: row.childName || r.childName || 'Child',
          }));
        } catch {
          return [];
        }
      })
    );
    return settled.flat();
  };

  const reload = async () => {
    try {
      setLoading(true);
      setError('');
      const [casesRes, testsRes] = await Promise.all([caseAPI.list(), labTestsAPI.getAll()]);
      const caseRows = (casesRes.data?.data || []) as ChildCaseRow[];
      const testRows = (testsRes.data?.data || []) as LabTestRow[];
      setCases(caseRows);
      setTests(testRows);
      const reqRows = await loadRequests(caseRows);
      setRequests(reqRows);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load clinician lab workflow');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (!selectedTestName) {
      setLabsForTest([]);
      setSelectedLabTestId('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await labTestsAPI.getByTest(selectedTestName);
        if (cancelled) return;
        const rows = (Array.isArray(data?.data) ? data.data : []) as LabOption[];
        setLabsForTest(rows);
        setSelectedLabTestId(rows[0]?.test_id || '');
      } catch (e: any) {
        if (!cancelled) setError(e.response?.data?.message || 'Failed to fetch labs for selected test');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTestName]);

  const resetForm = () => {
    setSelectedChildId('');
    setSelectedTestName('');
    setLabsForTest([]);
    setSelectedLabTestId('');
    setNotes('');
  };

  const selectedLab = useMemo(
    () => labsForTest.find((x) => String(x.test_id) === String(selectedLabTestId)) || null,
    [labsForTest, selectedLabTestId]
  );

  const createRequest = async () => {
    if (!selectedChildId || !selectedLab) return;
    try {
      setSubmitting(true);
      setError('');
      await labRequestsAPI.create({
        child_id: selectedChildId,
        lab_id: selectedLab.lab_id,
        test_id: selectedLab.test_id,
        notes: notes.trim(),
      });
      setSuccess('Lab request created successfully.');
      setTimeout(() => setSuccess(''), 2500);
      setOpen(false);
      resetForm();
      await reload();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to create lab request');
    } finally {
      setSubmitting(false);
    }
  };

  const openRequestModal = () => {
    setError('');
    setSuccess('');
    setOpen(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Lab Reports</h2>
          <p className="text-sm text-muted-foreground">Request and track lab tests by child case.</p>
        </div>
        <button
          type="button"
          onClick={openRequestModal}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Request Lab Test
        </button>
      </div>

      {success ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-primary">
          <CheckCircle className="h-4 w-4" />
          <span className="text-sm font-medium">{success}</span>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted p-3 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{error}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(['ALL', 'pending', 'in_progress', 'completed'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {f === 'ALL' ? 'All Requests' : f.replace('_', ' ')}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading requests...
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">No lab requests yet.</div>
      ) : (
        <div className="grid gap-3">
          {filteredRequests.map((row) => (
            <div key={row._id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-foreground">{row.test_name || 'Lab Test'}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.childName || 'Child'} · {row.labName || 'Lab'} · {formatDate(row.createdAt)}
                  </p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyle(row.status)}`}>
                  {row.status}
                </span>
              </div>
              {row.notes ? <p className="mt-2 text-sm text-foreground">{row.notes}</p> : null}
              {row.report_url ? (
                <ProtectedLink
                  href={resolveUploadUrl(row.report_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm text-primary hover:underline"
                >
                  Open report
                </ProtectedLink>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setOpen(false);
            resetForm();
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="shrink-0 border-b px-6 py-4 text-left">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-primary p-2 text-primary-foreground">
                <FlaskConical className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <DialogTitle>Request Lab Test</DialogTitle>
                <DialogDescription>
                  Select child, select test, choose lab, add notes, and submit.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[calc(90vh-11rem)] min-h-0 space-y-4 overflow-y-auto overscroll-contain px-6 py-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">1. Select Child</label>
                  <select
                    className="w-full rounded-md border bg-card px-3 py-2 text-sm"
                    autoFocus
                    value={selectedChildId}
                    onChange={(e) => setSelectedChildId(e.target.value)}
                  >
                    <option value="">Select a child case</option>
                    {cases.map((c) => (
                      <option key={`${c._id}-${c.childId}`} value={String(c.childId)}>
                        {c.childName || 'Child'} ({String(c.childId).slice(-6)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">2. Select Test</label>
                  <select
                    className="w-full rounded-md border bg-card px-3 py-2 text-sm"
                    value={selectedTestName}
                    onChange={(e) => setSelectedTestName(e.target.value)}
                  >
                    <option value="">Select a test</option>
                    {uniqueTests.map((t) => (
                      <option key={t._id} value={t.test_name}>
                        {t.test_name} {t.category ? `(${t.category})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">3. Select Lab</label>
                  <select
                    className="w-full rounded-md border bg-card px-3 py-2 text-sm disabled:opacity-60"
                    value={selectedLabTestId}
                    disabled={!labsForTest.length}
                    onChange={(e) => setSelectedLabTestId(e.target.value)}
                  >
                    <option value="">Select a lab</option>
                    {labsForTest.map((l) => (
                      <option key={l.test_id} value={l.test_id}>
                        {l.labName} {l.accreditation ? `(${l.accreditation})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">4. Notes (optional)</label>
                  <textarea
                    rows={4}
                    className="w-full rounded-md border bg-card px-3 py-2 text-sm"
                    placeholder="Add clinical notes for lab..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
          </div>

          <DialogFooter className="shrink-0 border-t px-6 py-4 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!selectedChildId || !selectedLab || submitting}
              onClick={() => void createRequest()}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit request'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
