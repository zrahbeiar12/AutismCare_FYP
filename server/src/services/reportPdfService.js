const { getCurrentTime } = require('../utils/time.js');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const REPORTS_DIR = path.join(process.cwd(), 'uploads', 'reports');

const { PdfLayout, safeText } = require('./pdf/pdfLayout.js');
const { renderTrendChartPng } = require('./pdf/chartRenderer.js');
const { renderStandardReportPdf } = require('./pdf/standardReportPdf.js');

function ensureDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function normalizeTherapyDuration(therapyDuration) {
  if (therapyDuration == null) return '';
  if (typeof therapyDuration === 'string') return safeText(therapyDuration);
  if (typeof therapyDuration === 'number') return `${therapyDuration} weeks`;
  if (typeof therapyDuration === 'object') {
    const weeks = therapyDuration?.weeks ?? therapyDuration?.totalWeeks;
    const start = safeText(therapyDuration?.startDate);
    const end = safeText(therapyDuration?.endDate);
    if (weeks != null) return `${weeks} weeks${start && end ? ` (${start} – ${end})` : ''}`;
    if (start || end) return `${start || '—'} – ${end || '—'}`;
  }
  return safeText(therapyDuration);
}

function formatPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const pct = n <= 1 ? n * 100 : n;
  return `${pct.toFixed(0)}%`;
}

function normalizeGoalProgressRows(goalProgressTable) {
  const rows = Array.isArray(goalProgressTable) ? goalProgressTable : [];
  return rows.slice(0, 24).map((r) => ({
    goal: safeText(r?.goal || r?.name || r?.title) || '—',
    status: safeText(r?.status) || '—',
    baseline: r?.baseline != null ? String(r.baseline) : safeText(r?.start) || '—',
    current: r?.current != null ? String(r.current) : safeText(r?.latest) || '—',
  }));
}

function normalizeDomainPerformanceRows(domainPerformance) {
  const rows = Array.isArray(domainPerformance) ? domainPerformance : [];
  return rows.slice(0, 24).map((d) => ({
    domain: safeText(d?.name || d?.domain) || '—',
    score: d?.score != null ? `${String(d.score)} / 5` : '—',
    status: safeText(d?.status) || '—',
  }));
}

/**
 * Build a simple clinical PDF from integrated report `data` object.
 * @returns {Promise<string>} relative URL path e.g. /uploads/reports/xxx.pdf
 */
async function writeIntegratedReportPdf(reportId, data) {
  ensureDir();
  const filename = `${String(reportId)}.pdf`;
  const absPath = path.join(REPORTS_DIR, filename);
  const doc = new PDFDocument({ margin: 48, size: 'LETTER', bufferPages: true });
  const stream = fs.createWriteStream(absPath);
  doc.pipe(stream);

  const childName = safeText(data?.childInfo?.childName) || 'Child';
  const parentName = safeText(data?.childInfo?.parentName) || '';
  const caseId = safeText(data?.childInfo?.caseId) || '';
  const generatedAt = safeText(data?.generatedAt) || getCurrentTime().toISOString();

  const layout = new PdfLayout(doc, { brandName: 'AutismCare' });
  layout.writeHeader({
    title: 'Integrated Therapy Progress Report',
    subtitle: 'Clinical summary and progress overview',
    generatedAt,
  });

  const om = data?.overallMetrics || {};
  layout.writePatientInfoBox({
    childName,
    parentName,
    caseId,
    therapyDuration: normalizeTherapyDuration(data?.therapyDuration),
  });

  layout.section(
    'Overall Summary',
    () => {
      layout.keyValueGrid(
        [
          ['Composite score (0–5)', om?.overallScore != null ? String(om.overallScore) : '—'],
          ['Improvement rate', om?.improvementRate != null ? String(om.improvementRate) : '—'],
          ['Home practice consistency', om?.consistency != null ? formatPct(om.consistency) : '—'],
          ['Sessions completed', data?.sessionsCompleted != null ? String(data.sessionsCompleted) : '—'],
        ],
        { columns: 2 }
      );
    },
    { minHeight: 140 }
  );

  layout.section(
    'Goal Progress',
    () => {
      const rows = normalizeGoalProgressRows(data?.goalProgressTable);
      if (!rows.length) {
        doc.fillColor(layout.colors.muted).text('—');
        layout.setBodyFont();
        return;
      }
      layout.table({
        columns: [
          { key: 'goal', header: 'Goal', widthPct: 46 },
          { key: 'status', header: 'Status', widthPct: 18 },
          { key: 'baseline', header: 'Baseline', widthPct: 18 },
          { key: 'current', header: 'Current', widthPct: 18 },
        ],
        rows,
        maxRows: 18,
      });
    },
    { minHeight: 180 }
  );

  layout.section(
    'Domain Performance',
    () => {
      const rows = normalizeDomainPerformanceRows(data?.domainPerformance);
      if (!rows.length) {
        doc.fillColor(layout.colors.muted).text('—');
        layout.setBodyFont();
        return;
      }
      layout.table({
        columns: [
          { key: 'domain', header: 'Domain', widthPct: 46 },
          { key: 'score', header: 'Score', widthPct: 22 },
          { key: 'status', header: 'Clinical status', widthPct: 32 },
        ],
        rows,
        maxRows: 18,
      });
    },
    { minHeight: 180 }
  );

  layout.section(
    'Trend Overview',
    () => {
      doc.fillColor(layout.colors.muted).font('Helvetica').fontSize(9).text(
        'Visual trend charts are included when available. If chart rendering is unavailable on the server, this section will display a text summary instead.',
        { width: layout.contentWidth }
      );
      layout.setBodyFont();
      doc.moveDown(0.5);

      const trend = data?.trendGraphData;
      const labels = Array.isArray(trend?.labels) ? trend.labels : [];
      const series = Array.isArray(trend?.series) ? trend.series : [];

      if (!labels.length || !series.length) {
        doc.fillColor(layout.colors.muted).text('—');
        layout.setBodyFont();
        return;
      }

      // Try chart image rendering, fall back to a compact text table.
      // Note: renderTrendChartPng returns null if chart deps are missing.
      doc.moveDown(0.2);
    },
    { minHeight: 220 }
  );

  // Embed chart after the section has created the container and moved cursor (keeps flow predictable).
  // We do it here so we can await the image render.
  const trendPng = await renderTrendChartPng(data?.trendGraphData);
  if (trendPng) {
    const imgW = layout.contentWidth;
    const imgH = Math.floor((imgW * 3) / 8); // approx 960x360 aspect
    layout.ensureSpace(imgH + 30);
    doc.image(trendPng, layout.left, doc.y, { width: imgW });
    doc.moveDown(0.8);
  } else {
    // Fallback text summary if chart isn't available.
    const trend = data?.trendGraphData;
    const labels = Array.isArray(trend?.labels) ? trend.labels : [];
    const series = Array.isArray(trend?.series) ? trend.series : [];
    if (labels.length && series.length) {
      layout.section(
        'Trend Data (Fallback)',
        () => {
          const rows = labels.slice(0, 12).map((label, idx) => {
            const out = { label: safeText(label) || '—' };
            series.slice(0, 3).forEach((s, j) => {
              const key = `s${j + 1}`;
              out[key] = s?.data?.[idx] != null ? String(s.data[idx]) : '—';
            });
            return out;
          });
          layout.table({
            columns: [
              { key: 'label', header: 'Period', widthPct: 40 },
              { key: 's1', header: safeText(series?.[0]?.label) || 'Series 1', widthPct: 20 },
              { key: 's2', header: safeText(series?.[1]?.label) || 'Series 2', widthPct: 20 },
              { key: 's3', header: safeText(series?.[2]?.label) || 'Series 3', widthPct: 20 },
            ],
            rows,
            maxRows: 12,
          });
        },
        { minHeight: 160 }
      );
    }
  }

  layout.section(
    'Recommendations',
    () => {
      layout.bulletList(data?.recommendations, { max: 20 });
    },
    { minHeight: 120 }
  );

  layout.section(
    'Clinical Notes',
    () => {
      const notes = safeText(data?.notes);
      if (!notes) {
        doc.fillColor(layout.colors.muted).text('—');
        layout.setBodyFont();
        return;
      }
      doc.fillColor(layout.colors.ink).text(notes, { width: layout.contentWidth, lineGap: 2 });
      layout.setBodyFont();
    },
    { minHeight: 120 }
  );

  layout.writeFooterAllPages();
  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return `/uploads/reports/${filename}`;
}

async function writeGenericReportPdf(reportId, type, data) {
  ensureDir();
  const filename = `${String(reportId)}.pdf`;
  const absPath = path.join(REPORTS_DIR, filename);
  const doc = new PDFDocument({ margin: 48, size: 'LETTER', bufferPages: true });
  const stream = fs.createWriteStream(absPath);
  doc.pipe(stream);

  const reportType = safeText(type) || 'Report';
  const generatedAt = safeText(data?.generatedAt) || getCurrentTime().toISOString();
  const childName = safeText(data?.childInfo?.childName || data?.childName) || 'Child';
  const caseId = safeText(data?.caseId) || safeText(data?.childInfo?.caseId) || '';
  const parentName = safeText(data?.childInfo?.parentName || data?.parentName) || '';

  const summary = safeText(data?.summary || data?.headline || data?.note);
  const layout = new PdfLayout(doc, { brandName: 'AutismCare' });
  layout.writeHeader({
    title: reportType.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
    subtitle: 'Clinical report summary',
    generatedAt,
  });

  layout.writePatientInfoBox({
    childName,
    parentName,
    caseId,
    therapyDuration: normalizeTherapyDuration(data?.therapyDuration),
  });

  layout.section(
    'Summary',
    () => {
      if (!summary) {
        doc.fillColor(layout.colors.muted).text('—');
        layout.setBodyFont();
        return;
      }
      doc.fillColor(layout.colors.ink).text(summary, { width: layout.contentWidth, lineGap: 2 });
      layout.setBodyFont();
    },
    { minHeight: 120 }
  );

  const metrics = data?.overallMetrics || data?.metrics || null;
  if (metrics && typeof metrics === 'object') {
    const keys = Object.keys(metrics).slice(0, 8);
    layout.section(
      'Key Metrics',
      () => {
        if (!keys.length) {
          doc.fillColor(layout.colors.muted).text('—');
          layout.setBodyFont();
          return;
        }
        const pairs = keys.map((k) => [k, metrics[k] == null ? '—' : typeof metrics[k] === 'number' ? String(metrics[k]) : safeText(metrics[k])]);
        layout.keyValueGrid(pairs, { columns: 2 });
      },
      { minHeight: 140 }
    );
  }

  if (Array.isArray(data?.goalProgressTable) && data.goalProgressTable.length) {
    layout.section(
      'Goal Progress',
      () => {
        const rows = normalizeGoalProgressRows(data?.goalProgressTable);
        layout.table({
          columns: [
            { key: 'goal', header: 'Goal', widthPct: 46 },
            { key: 'status', header: 'Status', widthPct: 18 },
            { key: 'baseline', header: 'Baseline', widthPct: 18 },
            { key: 'current', header: 'Current', widthPct: 18 },
          ],
          rows,
          maxRows: 18,
        });
      },
      { minHeight: 180 }
    );
  }

  if (Array.isArray(data?.domainPerformance) && data.domainPerformance.length) {
    layout.section(
      'Domain Performance',
      () => {
        const rows = normalizeDomainPerformanceRows(data?.domainPerformance);
        layout.table({
          columns: [
            { key: 'domain', header: 'Domain', widthPct: 46 },
            { key: 'score', header: 'Score', widthPct: 22 },
            { key: 'status', header: 'Clinical status', widthPct: 32 },
          ],
          rows,
          maxRows: 18,
        });
      },
      { minHeight: 180 }
    );
  }

  const chartPng = await renderTrendChartPng(data?.trendGraphData);
  if (chartPng) {
    layout.section(
      'Trend Overview',
      () => {
        const imgW = layout.contentWidth;
        const imgH = Math.floor((imgW * 3) / 8);
        layout.ensureSpace(imgH + 16);
        doc.image(chartPng, layout.left, doc.y, { width: imgW });
        doc.moveDown(0.8);
      },
      { minHeight: 220 }
    );
  }

  layout.section(
    'Recommendations',
    () => {
      layout.bulletList(data?.recommendations || data?.actions || data?.nextSteps, { max: 20 });
    },
    { minHeight: 120 }
  );

  layout.writeFooterAllPages();

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return `/uploads/reports/${filename}`;
}

/**
 * Standard (schema "standard-v1") reports: one template for every type and audience.
 * @returns {Promise<string>} relative URL path e.g. /uploads/reports/xxx.pdf
 */
async function writeStandardReportPdf(reportId, data) {
  ensureDir();
  const filename = `${String(reportId)}.pdf`;
  const stream = fs.createWriteStream(path.join(REPORTS_DIR, filename));
  const done = new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  renderStandardReportPdf(data || {}, stream);
  await done;
  return `/uploads/reports/${filename}`;
}

module.exports = {
  writeStandardReportPdf,
  writeIntegratedReportPdf,
  writeGenericReportPdf,
  REPORTS_DIR,
};
