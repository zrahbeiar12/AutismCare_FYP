import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  type TooltipProps,
} from 'recharts';
import { cn } from '../ui/utils';

export type GoalTimePoint = {
  date: string | null;
  score: number;
  smoothedScore?: number;
  confidence?: number;
};

function GoalLineTooltip({
  active,
  payload,
  explanationSnippet,
}: TooltipProps<number, string> & { explanationSnippet?: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as GoalTimePoint & { x?: string };
  if (!p) return null;
  const d = p.date ? new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-slate-800">{d}</p>
      <p className="mt-1 text-slate-600">
        Score: <span className="font-semibold tabular-nums">{Number(p.score).toFixed(2)}</span> / 5
      </p>
      {p.smoothedScore != null && Number.isFinite(p.smoothedScore) ? (
        <p className="text-slate-600">
          Smoothed: <span className="font-semibold tabular-nums">{Number(p.smoothedScore).toFixed(2)}</span>
        </p>
      ) : null}
      {p.confidence != null ? (
        <p className="text-slate-600">
          Point confidence: <span className="tabular-nums">{(Number(p.confidence) * 100).toFixed(0)}%</span>
        </p>
      ) : null}
      {explanationSnippet ? <p className="mt-1 border-t border-slate-100 pt-1 text-slate-500">{explanationSnippet}</p> : null}
    </div>
  );
}

type Props = {
  data: GoalTimePoint[];
  className?: string;
  explanationSnippet?: string;
  height?: number;
};

export function GoalProgressLineChart({ data, className, explanationSnippet, height = 220 }: Props) {
  const chartData = (data || []).map((row) => ({
    ...row,
    x: row.date ? new Date(row.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—',
    smoothed: row.smoothedScore,
  }));
  const hasSmoothed = chartData.some((d) => d.smoothed != null && d.smoothed !== d.score);

  if (!chartData.length) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400',
          className
        )}
        style={{ height }}
      >
        No session points for this goal yet
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="x" tick={{ fontSize: 11, fill: '#64748b' }} height={36} />
          <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: '#64748b' }} />
          <Tooltip
            content={(props) => (
              <GoalLineTooltip {...(props as React.ComponentProps<typeof GoalLineTooltip>)} explanationSnippet={explanationSnippet} />
            )}
          />
          {hasSmoothed ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
          <Line
            type="monotone"
            dataKey="score"
            name="Score"
            stroke="#0f172a"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
          {hasSmoothed ? (
            <Line
              type="monotone"
              dataKey="smoothed"
              name="Smoothed"
              stroke="#94a3b8"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              connectNulls
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
