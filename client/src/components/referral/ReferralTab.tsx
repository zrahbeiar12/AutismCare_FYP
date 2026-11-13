import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { referralAPI, caseAPI } from '../../services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Loader2, AlertCircle, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { savePdfResponse } from '../reports/downloadReportPdf';

interface ReferralTabProps {
  caseId: string;
}

const therapistTypes = [
  'Speech Therapist',
  'Occupational Therapist',
  'Behavioral Therapist',
  'AAC Specialist',
  'PECS Specialist',
];

const priorities = ['high', 'medium', 'low'];

const priorityBadgeClass: Record<string, string> = {
  high: 'bg-muted text-destructive border',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-blue-100 text-blue-800 border-blue-200',
};

const statusBadgeClass: Record<string, string> = {
  pending: 'bg-muted text-foreground border',
  accepted: 'bg-blue-100 text-blue-800 border-blue-200',
  'in-progress': 'bg-blue-100 text-blue-800 border-blue-200',
};

export function ReferralTab({ caseId }: ReferralTabProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [finalEvaluationExists, setFinalEvaluationExists] = useState(false);
  const [caseStatus, setCaseStatus] = useState<string>('');

  const [therapistType, setTherapistType] = useState('');
  const [priority, setPriority] = useState('');
  const [notes, setNotes] = useState('');

  const canCreate = useMemo(
    () =>
      finalEvaluationExists &&
      (caseStatus === 'DIAGNOSIS_READY' || caseStatus === 'THERAPY') &&
      !!therapistType &&
      !!priority,
    [finalEvaluationExists, caseStatus, therapistType, priority]
  );

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [refRes, caseRes] = await Promise.all([
        referralAPI.getByCase(caseId),
        caseAPI.getById(caseId),
      ]);
      const data = refRes.data;
      setItems(data?.data || []);
      setFinalEvaluationExists(!!data?.meta?.finalEvaluationExists);
      setCaseStatus(String(caseRes.data?.data?.status || '').toUpperCase());
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load referrals');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!canCreate) return;
    try {
      setSaving(true);
      setError(null);
      await referralAPI.create({
        caseId,
        therapistType,
        priority,
        notes: notes.trim(),
      });
      setTherapistType('');
      setPriority('');
      setNotes('');
      await load();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to create referral');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border shadow-sm bg-card">
        <CardHeader className="border-b border bg-blue-50/40">
          <CardTitle className="text-base text-blue-900">Create Referral</CardTitle>
          <CardDescription>
            Assign this case to a therapist pathway after clinical evaluation.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          {!finalEvaluationExists && (
            <div className="rounded-lg border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
              Finalize clinical evaluation first
            </div>
          )}
          {caseStatus && !['DIAGNOSIS_READY', 'THERAPY'].includes(caseStatus) ? (
            <div className="rounded-lg border bg-muted px-4 py-3 text-sm text-muted-foreground">
              Not available in current stage
            </div>
          ) : null}
          {error && (
            <div className="rounded-lg border bg-muted px-4 py-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Therapist Type</Label>
              <Select value={therapistType} onValueChange={setTherapistType} disabled={!finalEvaluationExists || saving}>
                <SelectTrigger>
                  <SelectValue placeholder="Select therapist type" />
                </SelectTrigger>
                <SelectContent>
                  {therapistTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority} disabled={!finalEvaluationExists || saving}>
                <SelectTrigger>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  {priorities.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional referral notes for therapist."
              rows={4}
              disabled={!finalEvaluationExists || saving}
            />
          </div>

          <Button
            onClick={handleCreate}
            disabled={!canCreate || saving}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create Referral
          </Button>
        </CardContent>
      </Card>

      <Card className="border shadow-sm bg-card">
        <CardHeader className="border-b border bg-blue-50/40">
          <CardTitle className="text-base text-blue-900">Referral History</CardTitle>
          <CardDescription>All referrals linked to this case</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {loading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border-dashed border bg-background p-4 text-sm text-muted-foreground">
              No referrals yet.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item._id}
                  className="rounded-lg border bg-card px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                >
                  <div>
                    <p className="font-medium text-foreground">{item.therapistType}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString()}
                    </p>
                    {item.notes ? <p className="text-sm text-foreground mt-1">{item.notes}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={priorityBadgeClass[item.priority] || ''}>
                      {item.priority}
                    </Badge>
                    <Badge variant="outline" className={statusBadgeClass[item.status] || ''}>
                      {item.status}
                    </Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          const res = await referralAPI.letterPdf(item._id);
                          savePdfResponse(res, `Referral_${item._id}.pdf`);
                        } catch {
                          toast.error('Could not create the referral letter');
                        }
                      }}
                    >
                      <FileDown className="mr-1.5 h-4 w-4" />
                      Referral letter
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
