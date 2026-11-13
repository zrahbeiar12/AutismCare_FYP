import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Calendar, PenLine } from 'lucide-react';
import { formatChildResponseDisplay } from './sessionFormat';

export type SessionRow = {
  _id?: string;
  sessionDate?: string;
  duration?: number;
  goalsTargeted?: string[];
  activitiesUsed?: string[];
  childResponse?: string;
  status?: string;
  noteState?: string;
  parentInstructions?: string;
  notes?: string;
};

const STATUS_CLASS: Record<string, string> = {
  completed: 'bg-blue-50 text-blue-900 border-blue-200',
  missed: 'bg-yellow-50 text-yellow-900 border-yellow-200',
  rescheduled: 'bg-blue-50 text-blue-900 border-blue-200',
};

type Props = {
  sessions: SessionRow[];
  /** Required when showAddButton is true (default). Omit when the parent renders its own action. */
  onAdd?: () => void;
  onEdit?: (s: SessionRow) => void;
  /** Therapist signs the clinical note (draft → signed). */
  onSign?: (s: SessionRow) => void | Promise<void>;
  addButtonLabel?: string;
  /** Case file: card list aligned with global Sessions page (no inline modal). */
  variant?: 'table' | 'cards';
  /** When false, hides the toolbar add button (e.g. parent puts + Add New Session in card header). */
  showAddButton?: boolean;
};

export function SessionList({
  sessions,
  onAdd,
  onEdit,
  onSign,
  addButtonLabel = '+ Add New Session',
  variant = 'table',
  showAddButton = true,
}: Props) {
  const showEdit = typeof onEdit === 'function';
  const showSign = typeof onSign === 'function';
  const cards = variant === 'cards';

  return (
    <div className="space-y-4">
      {showAddButton ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {cards
              ? 'Sessions for this child only. Same data powers clinician analytics.'
              : 'Structured logs feed clinician progress and trend analytics.'}
          </p>
          <Button
            type="button"
            size="sm"
            className="shrink-0 rounded-lg border bg-card text-sm font-medium text-black shadow-sm hover:bg-background"
            onClick={() => onAdd?.()}
          >
            {addButtonLabel}
          </Button>
        </div>
      ) : null}

      {sessions.length === 0 ? (
        <p className="rounded-lg border-dashed border bg-muted/80 p-8 text-center text-sm text-muted-foreground">
          No sessions logged yet. Use Add New Session to record goals, activities, and parent-facing instructions.
        </p>
      ) : cards ? (
        <ul className="space-y-3">
          {sessions.map((s) => {
            const dt = s.sessionDate ? new Date(s.sessionDate) : null;
            const dateStr = dt
              ? dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
              : '—';
            const timeStr = dt ? dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—';
            const st = (s.status || 'completed').toLowerCase();
            const completed = st === 'completed';
            const noteSt = String(s.noteState || 'draft').toLowerCase();
            const canSign = showSign && s._id && noteSt === 'draft' && completed;
            return (
              <li
                key={String(s._id)}
                className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-1 gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-100">
                    <Calendar className="h-5 w-5 text-blue-700" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
                      <span className="font-semibold text-foreground">{dateStr}</span>
                      <span className="text-sm text-muted-foreground">{timeStr}</span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      Goals: {(s.goalsTargeted || []).join(', ') || '—'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4 border-t border pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Duration</p>
                    <p className="text-sm font-semibold text-foreground">
                      {s.duration != null && s.duration > 0 ? `${s.duration} min` : '—'}
                    </p>
                  </div>
                  {completed ? (
                    <div>
                      <p className="text-xs text-muted-foreground">Response</p>
                      <p className="text-sm font-semibold text-foreground">{formatChildResponseDisplay(s.childResponse)}</p>
                    </div>
                  ) : null}
                  <Badge variant="outline" className={`text-xs font-normal capitalize ${STATUS_CLASS[st] || 'border'}`}>
                    {st}
                  </Badge>
                  {noteSt !== 'draft' ? (
                    <Badge variant="secondary" className="text-xs capitalize">
                      Note: {noteSt}
                    </Badge>
                  ) : null}
                  {showEdit ? (
                    <Button type="button" variant="outline" size="sm" className="border" onClick={() => onEdit!(s)}>
                      Edit
                    </Button>
                  ) : null}
                  {canSign ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      onClick={() => void onSign!(s)}
                    >
                      <PenLine className="mr-1 h-3.5 w-3.5" />
                      Sign note
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-background/90 hover:bg-background/90">
                <TableHead className="text-foreground">Date</TableHead>
                <TableHead className="text-foreground">Duration</TableHead>
                <TableHead className="text-foreground">Goals targeted</TableHead>
                <TableHead className="text-foreground">Child response</TableHead>
                <TableHead className="text-foreground">Status</TableHead>
                {showEdit || showSign ? <TableHead className="w-[160px] text-foreground">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => {
                const st = (s.status || 'completed').toLowerCase();
                const noteSt = String(s.noteState || 'draft').toLowerCase();
                const canSign = showSign && s._id && noteSt === 'draft' && st === 'completed';
                return (
                  <TableRow key={String(s._id)} className="border">
                    <TableCell className="whitespace-nowrap text-sm text-foreground">
                      {s.sessionDate ? new Date(s.sessionDate).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-foreground">
                      {s.duration != null && s.duration > 0 ? `${s.duration} min` : '—'}
                    </TableCell>
                    <TableCell className="max-w-[220px] text-sm text-foreground">
                      {(s.goalsTargeted || []).join(', ') || '—'}
                    </TableCell>
                    <TableCell className="max-w-[180px] text-sm text-foreground">
                      {formatChildResponseDisplay(s.childResponse)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs font-normal capitalize ${STATUS_CLASS[st] || 'border'}`}>
                        {st}
                      </Badge>
                    </TableCell>
                    {showEdit || showSign ? (
                      <TableCell className="space-x-2">
                        {showEdit ? (
                          <Button type="button" variant="outline" size="sm" className="border" onClick={() => onEdit!(s)}>
                            Edit
                          </Button>
                        ) : null}
                        {canSign ? (
                          <Button type="button" variant="secondary" size="sm" onClick={() => void onSign!(s)}>
                            Sign
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
