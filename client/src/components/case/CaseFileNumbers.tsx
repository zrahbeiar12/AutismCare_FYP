import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { caseAPI } from '../../api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

/**
 * Case file number (assigned automatically, sequential per organisation) and the hospital's own MR number
 * (entered by the clinician, unique within the organisation).
 */
export function CaseFileNumbers({
  caseId,
  fileNumber,
  mrNumber,
}: {
  caseId: string;
  fileNumber?: string | null;
  mrNumber?: string | null;
}) {
  const [savedMr, setSavedMr] = useState(mrNumber || '');
  const [draft, setDraft] = useState(mrNumber || '');
  const [file, setFile] = useState(fileNumber || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSavedMr(mrNumber || '');
    setDraft(mrNumber || '');
    setFile(fileNumber || '');
  }, [mrNumber, fileNumber]);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await caseAPI.updateMrNumber(caseId, draft.trim());
      setSavedMr(data?.data?.mrNumber || '');
      setDraft(data?.data?.mrNumber || '');
      if (data?.data?.fileNumber) setFile(data.data.fileNumber);
      toast.success(draft.trim() ? 'MR number saved' : 'MR number cleared');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Could not save MR number');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/40 p-3 sm:grid-cols-2">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">File number</p>
        <p className="font-mono text-sm font-semibold text-foreground">{file || 'Assigned on registration'}</p>
      </div>
      <div>
        <label htmlFor={`mr-${caseId}`} className="text-xs uppercase tracking-wide text-muted-foreground">
          Hospital MR number
        </label>
        <div className="mt-1 flex gap-2">
          <Input
            id={`mr-${caseId}`}
            value={draft}
            maxLength={40}
            placeholder="e.g. 2026-00451"
            onChange={(e) => setDraft(e.target.value)}
            className="h-9"
          />
          <Button type="button" size="sm" disabled={saving || draft.trim() === savedMr} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
