import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProtectedImage, ProtectedVideo } from '../ui/ProtectedMedia';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { AlertCircle, CalendarDays, CheckCircle2, FileUp, Loader2, Sparkles, Timer, UploadCloud } from 'lucide-react';
import { parentAPI } from '../../api';

type ActivityRef = { name?: string; materials?: string };

type Row = {
  _id?: string;
  caseId?: string;
  title?: string;
  activityName?: string;
  instructions?: string;
  materials?: string;
  frequency?: string;
  duration?: string;
  dueDate?: string;
  status?: string;
  childName?: string;
  isLate?: boolean;
  activityId?: ActivityRef | string | null;
  submissionUrl?: string;
  parentSubmission?: {
    fileUrl?: string;
    submissionUrl?: string;
    fileType?: string;
    submittedAt?: string;
  };
  therapistFeedback?: {
    comment?: string | null;
    feedback?: string | null;
    rating?: number | null;
    reviewedAt?: string | null;
  };
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'border bg-muted text-foreground',
  submitted: 'border border-[color-mix(in_oklab,var(--action-secondary)_30%,var(--border))] bg-secondary text-secondary-foreground',
  reviewed: 'border border-[color-mix(in_oklab,var(--accent)_35%,var(--border))] bg-[color-mix(in_oklab,var(--accent)_14%,var(--card))] text-foreground',
  completed: 'border border-[color-mix(in_oklab,var(--action-secondary)_22%,var(--border))] bg-[color-mix(in_oklab,var(--action-secondary)_10%,var(--card))] text-foreground',
};

const STATUS_META: Record<
  string,
  { label: string; icon: typeof Timer; sort: number; tone: 'muted' | 'secondary' | 'accent' | 'primary' }
> = {
  pending: { label: 'Pending', icon: Timer, sort: 1, tone: 'muted' },
  submitted: { label: 'Submitted', icon: UploadCloud, sort: 2, tone: 'secondary' },
  reviewed: { label: 'Reviewed', icon: Sparkles, sort: 3, tone: 'accent' },
  completed: { label: 'Completed', icon: CheckCircle2, sort: 4, tone: 'primary' },
};

function resolveUploadUrl(filePath: string) {
  if (!filePath) return '';
  if (filePath.startsWith('http')) return filePath;
  const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
  const origin = base.replace(/\/api\/?$/, '');
  return `${origin}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
}

function formatDue(dueDate?: string) {
  if (!dueDate) return '—';
  const dt = new Date(dueDate);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function activityTitle(a: Row) {
  const act = a.activityId && typeof a.activityId === 'object' ? a.activityId : null;
  const named = (a as Row & { activityName?: string }).activityName?.trim();
  return named || a.title?.trim() || act?.name?.trim() || 'Home activity';
}

function hasTherapistFeedback(tf: Row['therapistFeedback'] | undefined) {
  if (!tf || typeof tf !== 'object') return false;
  const c = String(tf.comment || tf.feedback || '').trim();
  if (c) return true;
  if (tf.rating != null && tf.rating > 0) return true;
  if (tf.reviewedAt) return true;
  return false;
}

export function ParentHomeAssignments() {
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [fileDraft, setFileDraft] = useState<Record<string, File | undefined>>({});
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'submitted' | 'reviewed' | 'completed'>('all');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await parentAPI.getHomeAssignments();
      const body = res.data as { data?: Row[] };
      setItems(Array.isArray(body?.data) ? body.data : []);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err.response?.data?.message || 'Failed to load assignments');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const base = { all: items.length, pending: 0, submitted: 0, reviewed: 0, completed: 0 };
    for (const it of items) {
      const st = String(it.status || 'pending').toLowerCase();
      if (st === 'pending' || st === 'submitted' || st === 'reviewed' || st === 'completed') base[st] += 1;
    }
    return base;
  }, [items]);

  const visible = useMemo(() => {
    const list = statusFilter === 'all' ? items : items.filter((it) => String(it.status || 'pending').toLowerCase() === statusFilter);
    return [...list].sort((a, b) => {
      const sa = String(a.status || 'pending').toLowerCase();
      const sb = String(b.status || 'pending').toLowerCase();
      const oa = STATUS_META[sa]?.sort ?? 99;
      const ob = STATUS_META[sb]?.sort ?? 99;
      if (oa !== ob) return oa - ob;
      const da = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const db = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
      return da - db;
    });
  }, [items, statusFilter]);

  const submitFile = async (id: string, file: File | null) => {
    if (!file) {
      setError('Choose an image or video file.');
      return;
    }
    try {
      setUploadingId(id);
      setError(null);
      const fd = new FormData();
      fd.append('file', file);
      await parentAPI.submitAssignmentEvidence(id, fd);
      setFileDraft((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err.response?.data?.message || 'Upload failed');
    } finally {
      setUploadingId(null);
    }
  };

  const markComplete = async (id: string) => {
    try {
      setCompleteId(id);
      setError(null);
      await parentAPI.completeAssignment(id);
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err.response?.data?.message || 'Could not update');
    } finally {
      setCompleteId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Home Activities</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Complete therapist-assigned activities and upload a photo or video. You’ll see feedback once it’s reviewed.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="border"
              onClick={() => void load()}
              disabled={loading}
              title="Refresh list"
            >
              Refresh
            </Button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold text-foreground">Something went wrong</p>
            <p className="mt-0.5 text-muted-foreground">{error}</p>
          </div>
        </div>
      ) : null}

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {(['pending', 'submitted', 'reviewed', 'completed'] as const).map((k) => {
          const meta = STATUS_META[k];
          const Icon = meta.icon;
          const isActive = statusFilter === k;
          const count = counts[k];
          const tone =
            meta.tone === 'accent'
              ? 'border-[color-mix(in_oklab,var(--accent)_35%,var(--border))] bg-[color-mix(in_oklab,var(--accent)_10%,var(--card))]'
              : meta.tone === 'secondary'
                ? 'border-[color-mix(in_oklab,var(--action-secondary)_28%,var(--border))] bg-[color-mix(in_oklab,var(--action-secondary)_10%,var(--card))]'
                : meta.tone === 'primary'
                  ? 'border-[color-mix(in_oklab,var(--primary)_25%,var(--border))] bg-[color-mix(in_oklab,var(--primary)_8%,var(--card))]'
                  : 'bg-card';
          return (
            <button
              key={k}
              type="button"
              onClick={() => setStatusFilter((prev) => (prev === k ? 'all' : k))}
              className={[
                'group rounded-xl border p-4 text-left shadow-sm transition-all',
                'focus-visible:outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                'hover:-translate-y-0.5 hover:shadow-md',
                tone,
                isActive ? 'ring-2 ring-[color-mix(in_oklab,var(--ring)_35%,transparent)]' : '',
              ].join(' ')}
              aria-pressed={isActive}
              title={`Show ${meta.label.toLowerCase()} activities`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{meta.label}</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">{count}</p>
                </div>
                <div className="rounded-xl border bg-background/60 p-2.5 shadow-sm">
                  <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {k === 'pending'
                  ? 'Upload a photo/video to submit.'
                  : k === 'submitted'
                    ? 'Waiting for therapist review.'
                    : k === 'reviewed'
                      ? 'Feedback is ready to read.'
                      : 'Finished and archived.'}
              </p>
            </button>
          );
        })}
      </div>

      {/* Results */}
      {visible.length === 0 ? (
        <div className="rounded-xl border-dashed border bg-muted/60 px-6 py-14 text-center sm:px-10">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">No activities to show.</span>{' '}
            {statusFilter === 'all'
              ? 'When your therapist assigns one, it will appear here.'
              : 'Try a different filter to see other activities.'}
          </p>
          {statusFilter !== 'all' ? (
            <div className="mt-6 flex justify-center">
              <Button type="button" variant="outline" className="border" onClick={() => setStatusFilter('all')}>
                Clear filter
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {visible.map((a) => {
            const st = String(a.status || 'pending').toLowerCase();
            const badgeClass = STATUS_STYLES[st] || STATUS_STYLES.pending;
            const fb = a.therapistFeedback;
            const ps = a.parentSubmission;
            const rawUrl = a.submissionUrl || ps?.submissionUrl || ps?.fileUrl || '';
            const fileAbs = rawUrl ? resolveUploadUrl(rawUrl) : '';
            const showTherapistFeedback =
              (st === 'reviewed' || st === 'completed') && hasTherapistFeedback(fb);
            const meta = STATUS_META[st] ?? STATUS_META.pending;
            const StatusIcon = meta.icon;
            const id = String(a._id);
            const draft = fileDraft[id];
            const dueText = formatDue(a.dueDate);

            return (
              <li key={String(a._id)}>
                <Card className="overflow-hidden border bg-card shadow-sm">
                  <CardHeader className="ds-card-header-strip pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border bg-background/60 shadow-sm">
                            <StatusIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                          </span>
                          <CardTitle className="min-w-0 truncate text-base font-semibold text-foreground">
                            {activityTitle(a)}
                          </CardTitle>
                        </div>
                        <CardDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="font-medium text-foreground">{a.childName || 'Child'}</span>
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                            Due {dueText}
                          </span>
                          {a.isLate && st === 'pending' ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-[color-mix(in_oklab,var(--accent)_35%,var(--border))] bg-[color-mix(in_oklab,var(--accent)_14%,var(--card))] px-2 py-0.5 text-xs font-semibold text-foreground">
                              Overdue
                            </span>
                          ) : null}
                        </CardDescription>
                      </div>
                      <Badge variant="outline" className={`shrink-0 capitalize ${badgeClass}`}>
                        {st}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-5">
                    {a.instructions ? (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Instructions</p>
                        <p className="text-sm leading-relaxed text-foreground">{a.instructions}</p>
                      </div>
                    ) : null}
                    {a.frequency ? (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Frequency</p>
                        <p className="text-sm text-foreground">{a.frequency}</p>
                      </div>
                    ) : null}
                    {a.duration ? (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Duration</p>
                        <p className="text-sm text-foreground">{a.duration}</p>
                      </div>
                    ) : null}
                    {a.materials ? (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Materials</p>
                        <p className="text-sm text-foreground">{a.materials}</p>
                      </div>
                    ) : null}

                    {st === 'pending' ? (
                      <div className="rounded-xl border bg-background/50 p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <Label className="text-sm font-semibold text-foreground">Upload evidence</Label>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Upload a clear photo or short video of the activity. One submission per assignment.
                            </p>
                          </div>
                          <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-semibold text-foreground">
                            <FileUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                            Photo / Video
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
                            disabled={uploadingId === id}
                            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-semibold file:text-foreground"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              setFileDraft((prev) => ({ ...prev, [id]: f }));
                            }}
                          />

                          {draft ? (
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
                              <p className="min-w-0 truncate text-xs font-medium text-foreground" title={draft.name}>
                                Selected: {draft.name}
                              </p>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2"
                                onClick={() =>
                                  setFileDraft((prev) => {
                                    const next = { ...prev };
                                    delete next[id];
                                    return next;
                                  })
                                }
                              >
                                Remove
                              </Button>
                            </div>
                          ) : null}

                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <Button
                              type="button"
                              variant="accent"
                              className="h-11 font-semibold shadow-sm"
                              disabled={uploadingId === id || !draft}
                              onClick={() => void submitFile(id, draft ?? null)}
                            >
                              {uploadingId === id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" aria-hidden />}
                              Submit
                            </Button>
                            <p className="text-xs text-muted-foreground">
                              Tip: good lighting helps your therapist review faster.
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {rawUrl && st !== 'pending' ? (
                      <div className="rounded-xl border bg-background/70 p-3 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Submission</p>
                        <p className="text-xs text-muted-foreground">{ps?.submittedAt ? new Date(ps.submittedAt).toLocaleString() : ''}</p>
                        {ps.fileType === 'image' ? (
                          <ProtectedImage src={fileAbs} alt="" className="mt-2 max-h-48 rounded-md border object-contain" />
                        ) : ps.fileType === 'video' ? (
                          <ProtectedVideo src={fileAbs} className="mt-2 max-h-48 w-full rounded-md border" controls />
                        ) : null}
                      </div>
                    ) : null}

                    {showTherapistFeedback ? (
                      <div className="rounded-xl border bg-[color-mix(in_oklab,var(--action-secondary)_10%,var(--card))] p-3 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Therapist feedback</p>
                        {fb?.rating != null && fb.rating > 0 ? (
                          <p className="mt-1 text-sm text-foreground">
                            Rating: <span className="font-medium">{fb.rating}/5</span>
                          </p>
                        ) : null}
                        {fb?.feedback || fb?.comment ? (
                          <p className="mt-1.5 text-sm leading-relaxed text-foreground">
                            {fb.feedback || fb.comment}
                          </p>
                        ) : null}
                        {fb?.reviewedAt ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Reviewed{' '}
                            {new Date(fb.reviewedAt).toLocaleDateString(undefined, {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                            })}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {st === 'reviewed' ? (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-muted-foreground">
                          Mark as complete after you’ve read the feedback.
                        </p>
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          className="h-10 font-semibold"
                          disabled={completeId === id}
                          onClick={() => void markComplete(id)}
                        >
                          {completeId === id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />}
                          Acknowledge complete
                        </Button>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
