import { useEffect, useMemo, useState } from 'react';
import { ProtectedLink } from '../ui/ProtectedMedia';
import { labRequestsAPI, labTestsAPI } from '../../api';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Badge } from '../ui/badge';
import { FlaskConical, Loader2, Plus, UploadCloud } from 'lucide-react';

type LabTestRow = {
  _id: string;
  test_name: string;
  category?: string;
};

type LabOption = {
  test_id: string;
  test_name: string;
  category?: string;
  lab_id: string;
  labName: string;
  accreditation?: string;
};

type ChildLabRequestRow = {
  _id: string;
  test_name: string;
  category?: string;
  labName?: string;
  accreditation?: string;
  status: 'pending' | 'in_progress' | 'completed' | string;
  notes?: string;
  report_url?: string;
  createdAt?: string;
};

function prettyDate(value?: string) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '—';
  }
}

function resolveUploadUrl(filePath?: string) {
  if (!filePath) return '';
  if (filePath.startsWith('http')) return filePath;
  const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
  const origin = base.replace(/\/api\/?$/, '');
  return `${origin}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
}

function statusVariant(status: string) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'bg-emerald-50 text-emerald-900 border-emerald-200';
  if (s === 'in_progress') return 'bg-blue-50 text-blue-900 border-blue-200';
  return 'bg-amber-50 text-amber-900 border-amber-200';
}

export function ChildCaseLabModule({ childId }: { childId?: string }) {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<ChildLabRequestRow[]>([]);
  const [tests, setTests] = useState<LabTestRow[]>([]);
  const [labs, setLabs] = useState<LabOption[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedTestName, setSelectedTestName] = useState('');
  const [selectedLabTestId, setSelectedLabTestId] = useState('');
  const [notes, setNotes] = useState('');

  const selectedLab = useMemo(
    () => labs.find((row) => String(row.test_id) === String(selectedLabTestId)) || null,
    [labs, selectedLabTestId]
  );

  const uniqueTests = useMemo(() => {
    const seen = new Set<string>();
    return tests.filter((t) => {
      const key = String(t.test_name || '').toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [tests]);

  const loadRequests = async () => {
    if (!childId) return;
    const { data } = await labRequestsAPI.getByChild(childId);
    setRequests(Array.isArray(data?.data) ? data.data : []);
  };

  useEffect(() => {
    if (!childId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const [testsRes, reqRes] = await Promise.all([labTestsAPI.getAll(), labRequestsAPI.getByChild(childId)]);
        if (cancelled) return;
        setTests(Array.isArray(testsRes.data?.data) ? testsRes.data.data : []);
        setRequests(Array.isArray(reqRes.data?.data) ? reqRes.data.data : []);
      } catch (e: any) {
        if (!cancelled) setError(e.response?.data?.message || 'Failed to load lab module');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [childId]);

  useEffect(() => {
    if (!selectedTestName) {
      setLabs([]);
      setSelectedLabTestId('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setError('');
        const { data } = await labTestsAPI.getByTest(selectedTestName);
        if (cancelled) return;
        const rows = Array.isArray(data?.data) ? data.data : [];
        setLabs(rows);
        setSelectedLabTestId(rows[0]?.test_id || '');
      } catch (e: any) {
        if (!cancelled) setError(e.response?.data?.message || 'Failed to load labs for selected test');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTestName]);

  const resetForm = () => {
    setSelectedTestName('');
    setSelectedLabTestId('');
    setLabs([]);
    setNotes('');
  };

  const submitRequest = async () => {
    if (!childId || !selectedLab) return;
    try {
      setSubmitting(true);
      setError('');
      await labRequestsAPI.create({
        child_id: childId,
        lab_id: selectedLab.lab_id,
        test_id: selectedLab.test_id,
        notes,
      });
      await loadRequests();
      resetForm();
      setOpen(false);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to create lab request');
    } finally {
      setSubmitting(false);
    }
  };

  const openRequestModal = () => {
    setError('');
    setOpen(true);
  };

  return (
    <Card className="border shadow-sm bg-card">
      <CardHeader className="border-b border bg-blue-50/50">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2 text-blue-900">
              <FlaskConical className="h-5 w-5" />
              Lab Tests & Reports
            </CardTitle>
            <CardDescription>Clinician to lab workflow for this child case</CardDescription>
          </div>
          <Button
            size="sm"
            type="button"
            onClick={openRequestModal}
            disabled={!childId}
            title={!childId ? 'Child record is required to request a lab test for this case.' : undefined}
          >
            <Plus className="mr-1 h-4 w-4" />
            Request
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-5 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading lab requests...
          </div>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lab requests for this child yet.</p>
        ) : (
          requests.map((row) => (
            <div key={row._id} className="rounded-lg border p-3 bg-background/50">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-foreground">{row.test_name || 'Lab test'}</p>
                <Badge variant="outline" className={statusVariant(row.status)}>
                  {row.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {row.labName || 'Lab'} {row.accreditation ? `· ${row.accreditation}` : ''} · {prettyDate(row.createdAt)}
              </p>
              {row.notes ? <p className="text-sm mt-2 text-foreground">{row.notes}</p> : null}
              {row.report_url ? (
                <ProtectedLink
                  className="inline-flex items-center gap-1 text-sm mt-2 text-primary hover:underline"
                  href={resolveUploadUrl(row.report_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <UploadCloud className="h-4 w-4" />
                  Open report
                </ProtectedLink>
              ) : null}
            </div>
          ))
        )}
      </CardContent>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Request Lab Test</DialogTitle>
            <DialogDescription>Select test, choose lab, add notes, and submit.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-1">1. Select Test</p>
              <select
                value={selectedTestName}
                onChange={(e) => setSelectedTestName(e.target.value)}
                className="w-full rounded-md border bg-card p-2 text-sm"
              >
                <option value="">Select a test</option>
                {uniqueTests.map((test) => (
                  <option key={test._id} value={test.test_name}>
                    {test.test_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-sm font-medium mb-1">2. Select Lab</p>
              <select
                value={selectedLabTestId}
                onChange={(e) => setSelectedLabTestId(e.target.value)}
                disabled={!labs.length}
                className="w-full rounded-md border bg-card p-2 text-sm disabled:opacity-60"
              >
                <option value="">Select a lab</option>
                {labs.map((row) => (
                  <option key={row.test_id} value={row.test_id}>
                    {row.labName} {row.accreditation ? `(${row.accreditation})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-sm font-medium mb-1">3. Add Notes</p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Optional clinical notes for the lab"
                className="w-full rounded-md border bg-card p-2 text-sm"
              />
            </div>

            <Button onClick={submitRequest} disabled={!selectedLab || submitting} className="w-full">
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                '4. Submit Request'
              )}
            </Button>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
