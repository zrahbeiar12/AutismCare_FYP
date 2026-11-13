import { useCallback, useEffect, startTransition, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Loader2, Copy, Pencil, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { activityAPI, therapistAPI } from '../../api';
import type { ActivityTemplate } from './activityTypes';
import { FILTER_DOMAIN_OPTIONS } from './activityTypes';
import { ActivityTemplateFormDialog } from './ActivityTemplateFormDialog';

/** Friendlier labels for domain badges (UI only) */
const DOMAIN_DISPLAY: Record<string, string> = {
  Speech: 'Speech Therapy',
  OT: 'Occupational Therapy',
  Sensory: 'Sensory',
  Behavioral: 'Behavioral Therapy',
  'Behavioral (ABA)': 'ABA',
  AAC: 'AAC',
  PECS: 'PECS',
};

function domainLabel(domain: string | undefined) {
  if (!domain) return '—';
  return DOMAIN_DISPLAY[domain] || domain;
}

function previewText(s: string | undefined, max = 120) {
  const t = String(s || '').trim();
  if (!t) return '—';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Objective column: prefer explicit objective; fall back to legacy `instructions` only (not procedure). */
function objectivePreview(a: { objective?: string; instructions?: string }) {
  const o = String(a.objective || '').trim();
  if (o) return o;
  return String(a.instructions || '').trim();
}

function ProcedureContent({ procedure }: { procedure?: string }) {
  const raw = String(procedure || '').trim();
  if (!raw) {
    return <p className="text-sm text-muted-foreground">—</p>;
  }
  const lines = raw
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 1) {
    return (
      <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-foreground marker:text-muted-foreground">
        {lines.slice(0, 8).map((line, i) => (
          <li key={i} className="pl-0.5">
            {line.replace(/^\d+[\).\s]+/, '').trim()}
          </li>
        ))}
      </ol>
    );
  }
  return <p className="mt-1.5 text-sm leading-relaxed text-foreground">{previewText(raw, 320)}</p>;
}

function isPlatformTemplate(a: ActivityTemplate) {
  // The server states ownership explicitly; only fall back to createdBy for older payloads without the flag.
  if (typeof a.isPlatformTemplate === 'boolean') return a.isPlatformTemplate;
  return a.createdBy == null || a.createdBy === '';
}

type Props = {
  caseId?: string;
  onAssignSuccess?: () => void | Promise<void>;
};

export function ActivityLibraryScreen({ caseId, onAssignSuccess }: Props) {
  const [items, setItems] = useState<ActivityTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ActivityTemplate | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignActivity, setAssignActivity] = useState<ActivityTemplate | null>(null);
  const [assignTarget, setAssignTarget] = useState<'home' | 'plan'>('home');
  const [assignDue, setAssignDue] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** When the library is opened from the dashboard (no case route), therapist picks a case to assign. */
  const [assignCaseIdOverride, setAssignCaseIdOverride] = useState<string | null>(null);
  const [assignChildName, setAssignChildName] = useState<string | null>(null);
  const [casePickOpen, setCasePickOpen] = useState(false);
  const [casePickLoading, setCasePickLoading] = useState(false);
  const [casePickOptions, setCasePickOptions] = useState<Array<{ caseId: string; childName: string }>>([]);
  const [casePickForActivity, setCasePickForActivity] = useState<ActivityTemplate | null>(null);

  const effectiveCaseId = caseId || assignCaseIdOverride || '';

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => window.clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (domainFilter && domainFilter !== 'all') params.domain = domainFilter;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      const axiosRes = await activityAPI.listTemplates(params);
      const body = axiosRes.data as { data?: ActivityTemplate[] } | undefined;
      const list = Array.isArray(body?.data) ? body.data : [];
      setItems(list);
      setLoadError(null);
    } catch {
      const msg = 'Could not load activities. Check your connection and try again.';
      setLoadError(msg);
      toast.error('Failed to load activities');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [domainFilter, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearFilters = () => {
    setDomainFilter('all');
    setSearch('');
    setDebouncedSearch('');
  };

  const hasActiveFilters = domainFilter !== 'all' || debouncedSearch.trim().length > 0;

  const handleFormSaved = useCallback(() => {
    void load();
  }, [load]);

  const closeActivityForm = useCallback(() => {
    setFormOpen(false);
    setEditing(null);
  }, []);

  const openCreate = () => {
    startTransition(() => {
      setEditing(null);
      setFormOpen(true);
    });
  };

  const openEdit = (a: ActivityTemplate) => {
    startTransition(() => {
      setEditing(a);
      setFormOpen(true);
    });
  };

  /** Platform templates are read-only in place; clone first, then open the new copy for editing. */
  const handleEditOrClonePlatform = async (a: ActivityTemplate) => {
    if (!isPlatformTemplate(a)) {
      openEdit(a);
      return;
    }
    try {
      const res = await activityAPI.cloneTemplate(a._id);
      const created = (res.data as { data?: ActivityTemplate } | undefined)?.data;
      if (created && created._id) {
        toast.success('Created your copy — you can edit it now');
        await load();
        startTransition(() => {
          setEditing(created);
          setFormOpen(true);
        });
      } else {
        toast.error('Clone did not return a template');
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Could not create an editable copy');
    }
  };

  const handleClone = async (a: ActivityTemplate) => {
    try {
      await activityAPI.cloneTemplate(a._id);
      toast.success('Activity cloned');
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Clone failed');
    }
  };

  const beginAssignFlow = (a: ActivityTemplate, cid: string, childName?: string) => {
    setAssignActivity(a);
    setAssignChildName(childName || casePickOptions.find((o) => o.caseId === cid)?.childName || null);
    if (!caseId) setAssignCaseIdOverride(cid);
    setAssignTarget('home');
    const d = new Date();
    d.setDate(d.getDate() + 7);
    setAssignDue(d.toISOString().slice(0, 10));
    setAssignOpen(true);
  };

  const openAssign = async (a: ActivityTemplate) => {
    if (caseId) {
      beginAssignFlow(a, caseId);
      return;
    }
    if (assignCaseIdOverride) {
      beginAssignFlow(a, assignCaseIdOverride);
      return;
    }
    setCasePickForActivity(a);
    setCasePickOpen(true);
    setCasePickLoading(true);
    setCasePickOptions([]);
    try {
      const res = await therapistAPI.getDashboardSummary();
      const rows = (res.data?.data?.assignedCases || []) as Array<{
        caseId?: string;
        childName?: string;
        referralStatus?: string;
      }>;
      // Only cases where this therapist has started therapy can receive activities (the server rejects others),
      // and a case can appear once per referral, so de-duplicate by case.
      const seen = new Set<string>();
      const opts = rows
        .filter((r) => r?.caseId && r.referralStatus === 'in-progress')
        .filter((r) => (seen.has(String(r.caseId)) ? false : (seen.add(String(r.caseId)), true)))
        .map((r) => ({ caseId: String(r.caseId), childName: String(r.childName || 'Child') }));
      setCasePickOptions(opts);
      if (opts.length === 0) {
        toast.error('No cases in active therapy yet. Start therapy from Assigned Cases, then try again.');
        setCasePickOpen(false);
        setCasePickForActivity(null);
        return;
      }
      if (opts.length === 1) {
        setAssignCaseIdOverride(opts[0].caseId);
        setCasePickOpen(false);
        beginAssignFlow(a, opts[0].caseId, opts[0].childName);
        setCasePickForActivity(null);
      }
    } catch {
      toast.error('Could not load your cases to assign this activity.');
      setCasePickOpen(false);
      setCasePickForActivity(null);
    } finally {
      setCasePickLoading(false);
    }
  };

  const submitAssign = async () => {
    const cid = effectiveCaseId;
    if (!cid || !assignActivity) return;
    if (assignTarget === 'home' && !assignDue) {
      toast.error('Due date is required for home assignments');
      return;
    }
    try {
      setAssignSaving(true);
      await activityAPI.assign(assignActivity._id, {
        caseId: cid,
        assignTo: assignTarget,
        ...(assignTarget === 'home' ? { dueDate: new Date(assignDue).toISOString() } : {}),
      });
      toast.success(assignTarget === 'home' ? 'Home assignment created' : 'Activity added to therapy plan');
      setAssignOpen(false);
      if (!caseId) setAssignCaseIdOverride(null);
      if (onAssignSuccess) await onAssignSuccess();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Assignment failed');
    } finally {
      setAssignSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Page header — matches primary screens (Therapy Plans, Sessions) */}
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Activity Library</h1>
        <p className="text-base text-muted-foreground">Browse, search, and manage therapy activities.</p>
      </header>

      {/* Toolbar */}
      <div className="rounded-xl border/90 bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
          <div className="min-w-0 flex-1 space-y-3">
            <Label className="sr-only">Search activities</Label>
            <div className="flex h-11 w-full min-w-0 items-center gap-3 rounded-lg border bg-background/50 px-3.5 shadow-sm transition-all focus-within:border focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/30">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                autoComplete="off"
                aria-label="Search activities"
                className="h-full min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
                placeholder="Search activities by name, objective, or materials…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setDebouncedSearch(search);
                }}
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="w-full sm:max-w-[220px]">
                <Label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Domain
                </Label>
                <Select value={domainFilter} onValueChange={setDomainFilter}>
                  <SelectTrigger className="h-11 border bg-card shadow-sm transition-colors hover:border">
                    <SelectValue placeholder="All domains" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Domains</SelectItem>
                    {FILTER_DOMAIN_OPTIONS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <Button
            type="button"
            id="activity-library-new-template"
            variant="primary"
            className="h-11 shrink-0 rounded-lg px-5 text-sm font-semibold shadow-sm transition-all active:scale-[0.98] lg:min-w-[180px]"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openCreate();
            }}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden strokeWidth={2.5} />
            New Activity
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border/80 bg-muted/15 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <p className="font-semibold text-foreground">Edit, Clone, and Assign</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 marker:text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Edit</span> — change your own template. For{' '}
            <span className="font-medium text-foreground">Platform</span> activities, Edit first creates your editable copy,
            then opens it.
          </li>
          <li>
            <span className="font-medium text-foreground">Clone</span> — duplicate any activity as a new template in your
            library (handy to customize a platform activity without losing the original).
          </li>
          <li>
            <span className="font-medium text-foreground">Assign</span> — send to a{' '}
            <span className="font-medium text-foreground">home assignment</span> (parent dashboard) or add to the case{' '}
            <span className="font-medium text-foreground">therapy plan</span>. From this page, if you are not inside a case
            file, you will pick which assigned case to use (or one is chosen automatically if you only have one).
          </li>
        </ul>
      </div>

      {loadError && !loading ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm text-foreground">{loadError}</p>
          <Button type="button" variant="outline" size="sm" className="shrink-0 border-destructive/40" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border-dashed border bg-muted/80 px-6 py-14 text-center sm:px-10">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">No activities found.</span>{' '}
            {hasActiveFilters
              ? 'Try adjusting search or domain, or create a new activity.'
              : 'Create an activity to use in therapy plans, sessions, and home assignments.'}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              type="button"
              className="rounded-lg bg-primary px-6 font-semibold text-white shadow-sm hover:bg-blue-800"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openCreate();
              }}
            >
              <Plus className="mr-2 h-4 w-4" strokeWidth={2.5} />
              New Activity
            </Button>
            {hasActiveFilters ? (
              <Button type="button" variant="outline" className="border" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {items.map((a) => {
            const objText = objectivePreview(a);
            const showInstructionsFallback = !String(a.objective || '').trim() && String(a.instructions || '').trim();
            return (
            <li
              key={a._id}
              className="group flex min-h-[280px] flex-col overflow-hidden rounded-2xl border bg-card shadow-sm ring-1 ring-border/60 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="border-b border-border/80 bg-muted/30 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 flex-1 text-lg font-semibold leading-snug tracking-tight text-foreground">
                    {a.name}
                  </h2>
                  <Badge
                    variant="secondary"
                    className="shrink-0 rounded-md border border-border/60 bg-background px-2.5 py-0.5 text-xs font-medium text-foreground"
                  >
                    {a.difficulty || 'Medium'}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {isPlatformTemplate(a) ? (
                    <Badge
                      variant="outline"
                      className="rounded-md border bg-card text-xs font-medium text-foreground"
                    >
                      Platform
                    </Badge>
                  ) : null}
                  <Badge
                    variant="outline"
                    className="rounded-md border bg-background text-xs font-medium text-foreground"
                  >
                    {domainLabel(a.domain)}
                  </Badge>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-0 px-5 pb-5 pt-4">
                <div className="space-y-4 text-sm">
                  <div className="rounded-lg bg-muted/20 p-3.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Objective</p>
                    {showInstructionsFallback ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">Showing instructions (no separate objective)</p>
                    ) : null}
                    <p className="mt-1.5 leading-relaxed text-foreground">{objText ? previewText(objText, 220) : '—'}</p>
                  </div>
                  <div className="rounded-lg bg-muted/20 p-3.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Procedure</p>
                    <div className="mt-1 text-foreground">
                      <ProcedureContent procedure={a.procedure} />
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Materials</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-foreground">
                      {a.materials ? previewText(a.materials, 240) : '—'}
                    </p>
                  </div>
                </div>

                {a.frequency ? (
                  <p className="mt-4 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">Suggested frequency: </span>
                    {a.frequency}
                  </p>
                ) : null}
              </div>

              <div className="mt-auto border-t border-border/80 bg-muted/10 px-5 py-4">
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 min-w-0 w-full border bg-card px-2 font-bold text-foreground shadow-sm transition-all hover:border hover:bg-background active:scale-[0.98] sm:px-3"
                    title={
                      isPlatformTemplate(a)
                        ? 'Creates your copy, then opens the editor (platform templates are read-only)'
                        : 'Open this template in the editor'
                    }
                    onClick={() => void handleEditOrClonePlatform(a)}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 min-w-0 w-full border bg-card px-2 font-medium text-foreground shadow-sm transition-all hover:border hover:bg-background active:scale-[0.98] sm:px-3"
                    onClick={() => void handleClone(a)}
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    Clone
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="accent"
                    className="h-10 min-w-0 w-full px-2 font-bold shadow-sm transition-all active:scale-[0.98] sm:px-3"
                    onClick={() => void openAssign(a)}
                    title={
                      caseId
                        ? 'Assign to home or therapy plan for this case'
                        : 'Assign — pick a case if you have more than one'
                    }
                  >
                    Assign
                  </Button>
                </div>
              </div>
            </li>
            );
          })}
        </ul>
      )}

      {formOpen ? (
        <ActivityTemplateFormDialog
          key={editing?._id ?? 'new'}
          editing={editing}
          onClose={closeActivityForm}
          onSaved={handleFormSaved}
        />
      ) : null}

      <Dialog
        open={casePickOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCasePickOpen(false);
            setCasePickForActivity(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[min(85dvh,32rem)] flex-col gap-0 overflow-hidden border bg-card p-0 sm:max-w-md">
          <DialogHeader className="shrink-0 border-b px-5 py-4">
            <DialogTitle>Choose a case</DialogTitle>
            <DialogDescription>
              {casePickForActivity
                ? `Assign “${casePickForActivity.name}” to one of your assigned cases.`
                : 'Select which case should receive this assignment.'}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            {casePickLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ul className="space-y-2">
                {casePickOptions.map((opt) => (
                  <li key={opt.caseId}>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-auto w-full justify-start py-3 text-left"
                      onClick={() => {
                        const act = casePickForActivity;
                        if (!act) return;
                        setAssignCaseIdOverride(opt.caseId);
                        setCasePickOpen(false);
                        setCasePickForActivity(null);
                        beginAssignFlow(act, opt.caseId, opt.childName);
                      }}
                    >
                      <span className="font-medium text-foreground">{opt.childName}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCasePickOpen(false);
                setCasePickForActivity(null);
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={assignOpen}
        onOpenChange={(open) => {
          setAssignOpen(open);
          if (!open && !caseId) setAssignCaseIdOverride(null);
        }}
      >
        <DialogContent className="border bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-foreground">Assign activity</DialogTitle>
          </DialogHeader>
          {assignActivity ? (
            <p className="text-sm font-medium text-foreground">{assignActivity.name}</p>
          ) : null}
          {assignChildName ? (
            <p className="text-sm text-muted-foreground">
              For <span className="font-semibold text-foreground">{assignChildName}</span>
            </p>
          ) : null}
          <RadioGroup
            value={assignTarget}
            onValueChange={(v) => setAssignTarget(v as 'home' | 'plan')}
            className="grid gap-3 pt-2"
          >
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-background has-[:checked]:border has-[:checked]:bg-background">
              <RadioGroupItem value="home" id="assign-home" className="mt-0.5" />
              <div>
                <span className="text-sm font-medium text-foreground">Home assignment</span>
                <p className="text-xs text-muted-foreground">Parent sees instructions and materials on their dashboard</p>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-background has-[:checked]:border has-[:checked]:bg-background">
              <RadioGroupItem value="plan" id="assign-plan" className="mt-0.5" />
              <div>
                <span className="text-sm font-medium text-foreground">Therapy plan</span>
                <p className="text-xs text-muted-foreground">Adds this activity to the case therapy plan (requires a plan)</p>
              </div>
            </label>
          </RadioGroup>
          {assignTarget === 'home' ? (
            <div className="space-y-1.5 pt-2">
              <Label className="text-foreground">Due date</Label>
              <Input type="date" value={assignDue} onChange={(e) => setAssignDue(e.target.value)} className="border" />
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="border"
              onClick={() => {
                setAssignOpen(false);
                if (!caseId) setAssignCaseIdOverride(null);
              }}
              disabled={assignSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              className="font-semibold"
              onClick={() => void submitAssign()}
              disabled={assignSaving || (assignTarget === 'home' && !assignDue)}
            >
              {assignSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
