import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProtectedLink, ProtectedImage, ProtectedVideo } from '../../ui/ProtectedMedia';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Textarea } from '../../ui/textarea';
import { Label } from '../../ui/label';
import { Badge } from '../../ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { Loader2 } from 'lucide-react';
import { therapistAPI } from '../../../api';
import { AssignActivityForm } from '../AssignActivityForm';
import type { TherapistCaseFileData } from './caseFileTypes';

type ActivityRef = { name?: string };

type AssignmentRow = {
  _id?: string;
  title?: string;
  instructions?: string;
  materials?: string;
  frequency?: string;
  duration?: string;
  dueDate?: string;
  status?: string;
  activityId?: ActivityRef | string | null;
  sourceActivityId?: ActivityRef | string | null;
  parentSubmission?: { fileUrl?: string; submissionUrl?: string; fileType?: string; submittedAt?: string };
  therapistFeedback?: { comment?: string; feedback?: string; rating?: number | null; reviewedAt?: string };
};

type Props = {
  caseId: string;
  data: TherapistCaseFileData;
  onRefresh: () => Promise<void>;
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'border bg-muted text-foreground',
  submitted: 'border-border bg-secondary/50 text-primary',
  reviewed: 'border-border bg-accent/10 text-accent-foreground',
  completed: 'border-border bg-secondary text-primary',
};

function resolveUploadUrl(filePath: string) {
  if (!filePath) return '';
  if (filePath.startsWith('http')) return filePath;
  const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
  const origin = base.replace(/\/api\/?$/, '');
  return `${origin}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
}

export function HomeAssignmentsCaseTab({ caseId, data, onRefresh }: Props) {
  const assignments = useMemo(() => (data.assignments || []) as AssignmentRow[], [data.assignments]);

  const [error, setError] = useState<string | null>(null);

  const [reviewId, setReviewId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [rating, setRating] = useState<string>('');
  const [reviewSaving, setReviewSaving] = useState(false);

  const submitReview = async (id: string, markComplete: boolean) => {
    try {
      setReviewSaving(true);
      setError(null);
      await therapistAPI.reviewHomeAssignment(id, {
        feedback: feedback.trim(),
        comment: feedback.trim(),
        rating: rating ? Number(rating) : undefined,
        markComplete,
      });
      setReviewId(null);
      setFeedback('');
      setRating('');
      await onRefresh();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err.response?.data?.message || 'Failed to save review');
    } finally {
      setReviewSaving(false);
    }
  };

  const activityName = useCallback((a: AssignmentRow) => {
    const act = a.activityId && typeof a.activityId === 'object' ? a.activityId : null;
    const leg = a.sourceActivityId && typeof a.sourceActivityId === 'object' ? a.sourceActivityId : null;
    return act?.name || leg?.name || a.title || 'Activity';
  }, []);

  return (
    <div className="space-y-6">
      <AssignActivityForm
        fixedCaseId={caseId}
        onSuccess={async () => {
          await onRefresh();
        }}
      />

      {error ? (
        <div className="rounded-md border bg-muted px-3 py-2 text-sm text-destructive">{error}</div>
      ) : null}

      <Card className="border bg-card shadow-sm">
        <CardHeader className="border-b border">
          <CardTitle className="text-base font-semibold text-foreground">Home assignments</CardTitle>
          <CardDescription className="text-muted-foreground">Track parent submissions and provide feedback.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {assignments.length === 0 ? (
            <p className="rounded-lg border-dashed border bg-muted/80 px-4 py-10 text-center text-sm text-muted-foreground">
              No assignments yet. Assign an activity above to appear here.
            </p>
          ) : (
            <ul className="space-y-4">
              {assignments.map((a) => {
                const st = String(a.status || 'pending').toLowerCase();
                const badgeClass = STATUS_STYLES[st] || STATUS_STYLES.pending;
                const ps = a.parentSubmission;
                const fb = a.therapistFeedback;
                const showReview = st === 'submitted' || st === 'reviewed';
                const fileAbs = ps?.submissionUrl || ps?.fileUrl ? resolveUploadUrl(String(ps.submissionUrl || ps.fileUrl)) : '';

                return (
                  <li key={String(a._id)} className="rounded-xl border bg-card p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground">{activityName(a)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Due {a.dueDate ? new Date(a.dueDate).toLocaleDateString() : '—'}
                        </p>
                      </div>
                      <Badge variant="outline" className={`shrink-0 capitalize ${badgeClass}`}>
                        {st}
                      </Badge>
                    </div>
                    {a.instructions ? (
                      <p className="mt-3 text-sm leading-relaxed text-foreground">{a.instructions}</p>
                    ) : null}
                    {a.frequency ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Frequency: </span>
                        {a.frequency}
                      </p>
                    ) : null}
                    {a.duration ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Duration: </span>
                        {a.duration}
                      </p>
                    ) : null}
                    {a.materials ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Materials: </span>
                        {a.materials}
                      </p>
                    ) : null}

                    {(ps?.submissionUrl || ps?.fileUrl) && (st === 'submitted' || st === 'reviewed' || st === 'completed') ? (
                      <div className="mt-4 rounded-lg border bg-muted/80 p-3">
                        <p className="text-xs font-medium text-foreground">Parent submission</p>
                        <p className="text-xs text-muted-foreground">
                          {ps.submittedAt ? new Date(ps.submittedAt).toLocaleString() : ''} · {ps.fileType || 'file'}
                        </p>
                        {ps.fileType === 'image' ? (
                          <ProtectedImage
                            src={fileAbs}
                            alt="Submission"
                            className="mt-2 max-h-56 rounded-md border object-contain"
                          />
                        ) : ps.fileType === 'video' ? (
                          <ProtectedVideo src={fileAbs} className="mt-2 max-h-56 w-full rounded-md border" controls />
                        ) : (
                          <ProtectedLink
                            href={fileAbs}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-sm text-primary underline"
                          >
                            Open file
                          </ProtectedLink>
                        )}
                      </div>
                    ) : null}

                    {fb?.comment || fb?.feedback || (fb?.rating != null && fb.rating > 0) ? (
                      <div className="mt-3 rounded-lg border bg-card px-3 py-2">
                        <p className="text-xs font-medium text-foreground">Your feedback</p>
                        {fb.rating ? <p className="text-sm text-foreground">Rating: {fb.rating}/5</p> : null}
                        {fb.feedback || fb.comment ? (
                          <p className="text-sm text-foreground">{fb.feedback || fb.comment}</p>
                        ) : null}
                      </div>
                    ) : null}

                    {showReview ? (
                      <div className="mt-4 border-t border pt-4">
                        {reviewId === String(a._id) ? (
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <Label className="text-foreground">Feedback</Label>
                              <Textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} className="border" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-foreground">Rating (optional)</Label>
                              <Select value={rating || undefined} onValueChange={setRating}>
                                <SelectTrigger className="border bg-card">
                                  <SelectValue placeholder="1–5" />
                                </SelectTrigger>
                                <SelectContent>
                                  {([1, 2, 3, 4, 5] as const).map((n) => (
                                    <SelectItem key={n} value={String(n)}>
                                      {n}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="default"
                                disabled={reviewSaving}
                                onClick={() => void submitReview(String(a._id), false)}
                              >
                                {reviewSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Submit feedback
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="border"
                                disabled={reviewSaving}
                                onClick={() => void submitReview(String(a._id), true)}
                              >
                                Mark as completed
                              </Button>
                              <Button type="button" size="sm" variant="ghost" onClick={() => setReviewId(null)}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button type="button" size="sm" variant="outline" className="border" onClick={() => setReviewId(String(a._id))}>
                            {st === 'submitted' ? 'Review submission' : 'Update feedback'}
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
