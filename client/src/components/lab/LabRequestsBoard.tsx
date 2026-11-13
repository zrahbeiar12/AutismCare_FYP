import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ProtectedLink } from '../ui/ProtectedMedia';
import { labRequestsAPI } from '../../api';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Loader2, CheckCircle2, Clock3, FlaskConical } from 'lucide-react';

type LabRequestRow = {
  _id: string;
  child_id: string;
  childName?: string;
  test_name?: string;
  category?: string;
  notes?: string;
  status: 'pending' | 'in_progress' | 'completed' | string;
  report_url?: string;
};

function resolveUploadUrl(filePath?: string) {
  if (!filePath) return '';
  if (filePath.startsWith('http')) return filePath;
  const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';
  const origin = base.replace(/\/api\/?$/, '');
  return `${origin}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
}

function Section({
  title,
  rows,
  onAccept,
  onUpload,
  busyId,
}: {
  title: string;
  rows: LabRequestRow[];
  onAccept: (id: string) => void;
  onUpload: (id: string) => void;
  busyId: string | null;
}) {
  return (
    <Card className="border shadow-sm bg-card">
      <CardHeader className="border-b border">
        <CardTitle className="text-base flex items-center gap-2">
          <FlaskConical className="h-4 w-4" />
          {title} ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-3">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No requests</p> : null}
        {rows.map((row) => (
          <div key={row._id} className="rounded-lg border p-3 bg-background/50">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-foreground">{row.test_name || 'Lab test'}</p>
              <Badge variant="outline" className="capitalize">
                {row.status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Child: {row.childName || row.child_id} {row.category ? `· ${row.category}` : ''}
            </p>
            {row.notes ? <p className="text-sm mt-2">{row.notes}</p> : null}

            {row.status === 'pending' ? (
              <Button
                size="sm"
                className="mt-3"
                onClick={() => onAccept(row._id)}
                disabled={busyId === row._id}
              >
                {busyId === row._id ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Accepting...
                  </>
                ) : (
                  <>
                    <Clock3 className="mr-2 h-4 w-4" /> Accept
                  </>
                )}
              </Button>
            ) : null}

            {row.status === 'in_progress' ? (
              <Button
                size="sm"
                className="mt-3"
                onClick={() => onUpload(row._id)}
                disabled={busyId === row._id}
              >
                {busyId === row._id ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" /> Upload report
                  </>
                )}
              </Button>
            ) : null}

            {row.status === 'completed' && row.report_url ? (
              <ProtectedLink
                href={resolveUploadUrl(row.report_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline mt-3 inline-block"
              >
                Open uploaded report
              </ProtectedLink>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function LabRequestsBoard() {
  const [rows, setRows] = useState<LabRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedUploadRequestId, setSelectedUploadRequestId] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const { data } = await labRequestsAPI.getMyRequests();
      setRows(Array.isArray(data?.data) ? data.data : []);
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load lab requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const pending = useMemo(() => rows.filter((r) => r.status === 'pending'), [rows]);
  const inProgress = useMemo(() => rows.filter((r) => r.status === 'in_progress'), [rows]);
  const completed = useMemo(() => rows.filter((r) => r.status === 'completed'), [rows]);

  const accept = async (id: string) => {
    try {
      setBusyId(id);
      await labRequestsAPI.accept(id);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to accept request');
    } finally {
      setBusyId(null);
    }
  };

  const upload = async (id: string) => {
    setSelectedUploadRequestId(id);
    uploadInputRef.current?.click();
  };

  const onUploadFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const id = selectedUploadRequestId;
    event.target.value = '';
    if (!file || !id) return;

    const formData = new FormData();
    formData.append('report', file);

    try {
      setBusyId(id);
      setError('');
      await labRequestsAPI.uploadReport(id, formData);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to upload report');
    } finally {
      setBusyId(null);
      setSelectedUploadRequestId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading lab requests...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <input
        ref={uploadInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
        onChange={onUploadFileChange}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Pending" rows={pending} onAccept={accept} onUpload={upload} busyId={busyId} />
        <Section title="In Progress" rows={inProgress} onAccept={accept} onUpload={upload} busyId={busyId} />
        <Section title="Completed" rows={completed} onAccept={accept} onUpload={upload} busyId={busyId} />
      </div>
    </div>
  );
}
