/**
 * One PDF template for every report type (schema "standard-v1").
 * Same order, same units, same visuals for parent, clinician and therapist copies; only the audience section
 * changes. Charts are drawn with pdfkit primitives, so no native canvas dependency is needed.
 */
const PDFDocument = require('pdfkit');

const C = {
  navy: '#1E3A8A',
  navyDark: '#172554',
  gold: '#D4AF37',
  ink: '#0F172A',
  body: '#334155',
  muted: '#64748B',
  border: '#D6DCE5',
  panel: '#F5F7FB',
  track: '#E5E9F0',
  ok: '#15803D',
  okSoft: '#DCFCE7',
  warn: '#B45309',
  warnSoft: '#FEF3C7',
  bad: '#B91C1C',
  badSoft: '#FEE2E2',
  greySoft: '#EEF1F5',
};

const MARGIN = 44;

/** Helvetica (WinAnsi) has no arrow glyph; keep text printable. */
function t(v) {
  if (v == null) return '';
  return String(v).replace(/→/g, 'to').replace(/\s+/g, ' ').trim();
}

function fmtDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function pct(v) {
  return v == null ? '—' : `${v}%`;
}

function signedPts(v) {
  if (v == null) return '—';
  if (v > 0) return `+${v} pts`;
  if (v < 0) return `${v} pts`;
  return '0 pts';
}

function zoneColors(zone) {
  if (zone === 'ok' || zone === 'low') return { fg: C.ok, bg: C.okSoft, label: zone === 'ok' ? 'Typical' : 'Low' };
  if (zone === 'monitor' || zone === 'medium') return { fg: C.warn, bg: C.warnSoft, label: zone === 'monitor' ? 'Monitor' : 'Medium' };
  if (zone === 'refer' || zone === 'high') return { fg: C.bad, bg: C.badSoft, label: zone === 'refer' ? 'Refer' : 'High' };
  return { fg: C.muted, bg: C.greySoft, label: zone === 'incomplete' ? 'Incomplete' : 'Unknown' };
}

function trendColor(trend) {
  if (trend === 'improving') return C.ok;
  if (trend === 'declining') return C.bad;
  return C.muted;
}

class Writer {
  constructor(doc) {
    this.doc = doc;
    this.left = MARGIN;
    this.right = doc.page.width - MARGIN;
    this.width = this.right - this.left;
    this.bottom = doc.page.height - MARGIN - 18;
    this.y = MARGIN;
  }

  ensure(h) {
    if (this.y + h > this.bottom) {
      this.doc.addPage();
      this.y = MARGIN;
    }
  }

  text(str, x, y, opts = {}) {
    const { size = 9.5, color = C.body, bold = false, width, align, lineGap = 1.5 } = opts;
    this.doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(size)
      .fillColor(color)
      .text(t(str), x, y, { width, align, lineGap });
    return this.doc.y;
  }

  heightOf(str, width, size = 9.5, bold = false) {
    return this.doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).heightOfString(t(str), { width, lineGap: 1.5 });
  }

  /** @param {number} [keepWith] space the first block of the section needs, so a heading never sits alone */
  sectionTitle(title, hint, keepWith = 20) {
    this.ensure(48 + keepWith);
    this.y += 6;
    this.doc.save().rect(this.left, this.y + 1, 3, 13).fill(C.gold).restore();
    this.text(title, this.left + 10, this.y, { size: 12, bold: true, color: C.navy });
    if (hint) this.text(hint, this.left + 10, this.y + 15, { size: 8, color: C.muted, width: this.width - 10 });
    this.y += hint ? 30 : 20;
  }

  pill(label, x, y, colors, minW = 0) {
    const doc = this.doc;
    doc.font('Helvetica-Bold').fontSize(7.5);
    const w = Math.max(minW, doc.widthOfString(t(label)) + 12);
    doc.save().roundedRect(x, y, w, 13, 6.5).fill(colors.bg).restore();
    doc.fillColor(colors.fg).text(t(label), x, y + 3, { width: w, align: 'center' });
    return w;
  }

  bar(x, y, w, h, value, color) {
    const v = Math.max(0, Math.min(100, Number(value) || 0));
    this.doc.save().roundedRect(x, y, w, h, h / 2).fill(C.track).restore();
    if (v > 0) this.doc.save().roundedRect(x, y, Math.max(h, (w * v) / 100), h, h / 2).fill(color).restore();
  }

  bullets(items, x, width, opts = {}) {
    const list = (items || []).map(t).filter(Boolean);
    if (!list.length) {
      this.ensure(14);
      this.text(opts.empty || 'None recorded.', x, this.y, { color: C.muted, width });
      this.y = this.doc.y + 4;
      return;
    }
    for (const line of list) {
      const h = this.heightOf(line, width - 12);
      this.ensure(h + 4);
      this.doc.save().circle(x + 3, this.y + 4.5, 1.8).fill(opts.dot || C.navy).restore();
      this.text(line, x + 12, this.y, { width: width - 12 });
      this.y = this.doc.y + 3;
    }
  }
}

function drawHeader(w, data) {
  const doc = w.doc;
  const h = 78;
  doc.save().rect(0, 0, doc.page.width, h).fill(C.navy).restore();
  doc.save().rect(0, h, doc.page.width, 3).fill(C.gold).restore();
  w.text('AutismCare', w.left, 18, { size: 10, bold: true, color: C.gold });
  w.text(data.title || 'Progress Report', w.left, 32, { size: 18, bold: true, color: '#FFFFFF', width: w.width * 0.66 });
  w.text(`Generated ${fmtDate(data.generatedAt)}`, w.left, 22, { size: 8.5, color: '#DBE4FF', width: w.width, align: 'right' });
  w.text(`Case ref ${data.caseRef || '—'}`, w.left, 35, { size: 8.5, color: '#DBE4FF', width: w.width, align: 'right' });
  w.y = h + 18;
}

function drawChildPanel(w, data) {
  const rowsL = [
    ['Child', data.child?.name],
    ['Age', data.child?.ageText],
    ['Gender', data.child?.gender],
    ['Date of birth', fmtDate(data.child?.dateOfBirth)],
  ];
  const period =
    data.period?.firstSessionDate
      ? `${fmtDate(data.period.firstSessionDate)} – ${fmtDate(data.period.lastSessionDate)}${data.period.weeks ? ` (${data.period.weeks} wk)` : ''}`
      : 'No sessions yet';
  const rowsR = [
    ['Parent / guardian', data.parentName],
    ['Therapist', data.therapistName ? `${data.therapistName}${data.therapistSpecialization ? `, ${data.therapistSpecialization}` : ''}` : null],
    ['Therapy period', period],
    ['Case status', data.case?.status ? String(data.case.status).replace(/_/g, ' ') : null],
  ];
  const h = 16 + rowsL.length * 16;
  w.ensure(h + 8);
  const doc = w.doc;
  doc.save().roundedRect(w.left, w.y, w.width, h, 6).fill(C.panel).restore();
  doc.save().roundedRect(w.left, w.y, w.width, h, 6).lineWidth(0.8).strokeColor(C.border).stroke().restore();
  const colW = w.width / 2;
  const draw = (rows, x0) =>
    rows.forEach(([k, v], i) => {
      const y = w.y + 10 + i * 16;
      w.text(k, x0, y, { size: 8, color: C.muted, width: 92 });
      w.text(v || '—', x0 + 94, y - 0.5, { size: 9.5, color: C.ink, bold: k === 'Child', width: colW - 110 });
    });
  draw(rowsL, w.left + 12);
  draw(rowsR, w.left + colW + 4);
  w.y += h + 10;
}

function drawSummary(w, data) {
  const width = w.width - 24;
  const h = w.heightOf(data.summary, width, 10.5) + 18;
  w.ensure(h + 6);
  w.doc.save().roundedRect(w.left, w.y, w.width, h, 6).fill('#EEF2FF').restore();
  w.doc.save().rect(w.left, w.y, 3, h).fill(C.navy).restore();
  w.text(data.summary, w.left + 14, w.y + 9, { size: 10.5, color: C.navyDark, width });
  w.y += h + 12;
}

function drawStatTiles(w, s) {
  const tiles = [
    {
      label: 'Overall progress',
      value: pct(s.overallProgressPct),
      sub: `${s.overallTrendLabel}${s.dataConfidence ? ` · ${s.dataConfidence} data confidence` : ''}`,
      bar: s.overallProgressPct,
    },
    {
      label: 'Change since baseline',
      value: signedPts(s.improvementPts),
      sub: s.baselinePct != null ? `${s.baselinePct}% to ${s.currentPct}% (goal average)` : 'Baseline not set',
      color: s.improvementPts > 0 ? C.ok : s.improvementPts < 0 ? C.bad : C.ink,
    },
    {
      label: 'Sessions completed',
      value: String(s.sessionsCompleted ?? 0),
      sub: s.attendancePct != null ? `${s.attendancePct}% attendance` : 'Attendance not recorded',
      bar: s.attendancePct,
    },
    {
      label: 'Home practice',
      value: pct(s.homePracticePct),
      sub: `${s.assignmentsCompleted ?? 0} of ${s.assignmentsTotal ?? 0} activities done`,
      bar: s.homePracticePct,
    },
  ];
  const gap = 10;
  const tw = (w.width - gap * 3) / 4;
  const th = 74;
  w.ensure(th + 26);
  tiles.forEach((tile, i) => {
    const x = w.left + i * (tw + gap);
    w.doc.save().roundedRect(x, w.y, tw, th, 6).lineWidth(0.8).strokeColor(C.border).stroke().restore();
    w.text(tile.label.toUpperCase(), x + 10, w.y + 9, { size: 7, bold: true, color: C.muted, width: tw - 20 });
    w.text(tile.value, x + 10, w.y + 21, { size: 19, bold: true, color: tile.color || C.navy, width: tw - 20 });
    if (tile.bar != null) w.bar(x + 10, w.y + 46, tw - 20, 4, tile.bar, C.navy);
    w.text(tile.sub || '', x + 10, w.y + 55, { size: 7.5, color: C.muted, width: tw - 20 });
  });
  w.y += th + 8;
  const statusZone = s.clinicalStatus === 'on_track' ? 'ok' : s.clinicalStatus === 'needs_attention' ? 'monitor' : s.clinicalStatus === 'high_concern' ? 'refer' : 'unknown';
  w.text('Clinical status', w.left, w.y + 2, { size: 8, color: C.muted });
  let x = w.left + 66;
  x += w.pill(s.clinicalStatusLabel, x, w.y, zoneColors(statusZone)) + 14;
  w.text(`Goals achieved: ${s.goalsAchieved ?? 0} of ${s.goalsTotal ?? 0}`, x, w.y + 2, { size: 8.5, color: C.body });
  w.y += 22;
}

function drawDomains(w, domains) {
  w.sectionTitle('Progress by area', 'Average current performance of the goals in each area of the therapy plan.', 24 * Math.max(1, domains.length));
  if (!domains.length) {
    w.text('No goals with scored sessions yet.', w.left, w.y, { color: C.muted });
    w.y += 18;
    return;
  }
  for (const d of domains) {
    w.ensure(22);
    w.text(d.label, w.left, w.y + 1, { size: 9.5, bold: true, color: C.ink, width: 110 });
    w.bar(w.left + 115, w.y + 3, w.width - 240, 8, d.scorePct, C.navy);
    w.text(pct(d.scorePct), w.right - 118, w.y + 1, { size: 9.5, bold: true, color: C.ink, width: 40, align: 'right' });
    w.text(d.trendLabel, w.right - 70, w.y + 1.5, { size: 8.5, color: trendColor(d.trend), width: 70, align: 'right' });
    w.y += 20;
  }
  w.y += 4;
}

function drawGoals(w, goals) {
  w.sectionTitle('Goal progress', 'Baseline and target come from the therapy plan; current is the recent session average.', 60);
  if (!goals.length) {
    w.text('No goals in the therapy plan yet.', w.left, w.y, { color: C.muted });
    w.y += 18;
    return;
  }
  const cols = [
    { k: 'name', h: 'Goal', w: 0.27 },
    { k: 'domain', h: 'Area', w: 0.19 },
    { k: 'baselinePct', h: 'Baseline', w: 0.1, f: pct, a: 'right' },
    { k: 'currentPct', h: 'Current', w: 0.09, f: pct, a: 'right' },
    { k: 'targetPct', h: 'Target', w: 0.08, f: pct, a: 'right' },
    { k: 'changePts', h: 'Change', w: 0.1, f: signedPts, a: 'right' },
    { k: 'status', h: 'Status', w: 0.17 },
  ];
  const xs = [];
  let acc = w.left;
  for (const c of cols) {
    xs.push(acc);
    acc += c.w * w.width;
  }
  const header = () => {
    w.ensure(40);
    w.doc.save().rect(w.left, w.y, w.width, 18).fill(C.navy).restore();
    cols.forEach((c, i) =>
      w.text(c.h, xs[i] + 6, w.y + 5, { size: 8, bold: true, color: '#FFFFFF', width: c.w * w.width - 12, align: c.a || 'left' })
    );
    w.y += 18;
  };
  header();
  goals.forEach((g, idx) => {
    const nameH = w.heightOf(g.name, cols[0].w * w.width - 12, 8.5);
    const areaH = w.heightOf(g.domain, cols[1].w * w.width - 12, 8.5);
    const rh = Math.max(22, Math.max(nameH, areaH) + 10);
    if (w.y + rh > w.bottom) {
      w.doc.addPage();
      w.y = MARGIN;
      header();
    }
    if (idx % 2 === 1) w.doc.save().rect(w.left, w.y, w.width, rh).fill(C.panel).restore();
    cols.forEach((c, i) => {
      const cw = c.w * w.width - 12;
      if (c.k === 'status') {
        const zone = /achieved|target/i.test(g.status) ? 'ok' : /support/i.test(g.status) ? 'refer' : /not started/i.test(g.status) ? 'unknown' : 'monitor';
        w.pill(g.status, xs[i] + 6, w.y + 4, zoneColors(zone));
        return;
      }
      const raw = g[c.k];
      const val = c.f ? c.f(raw) : raw || '—';
      const color = c.k === 'changePts' ? (raw > 0 ? C.ok : raw < 0 ? C.bad : C.body) : C.ink;
      w.text(val, xs[i] + 6, w.y + 5, { size: 8.5, color, bold: c.k === 'currentPct', width: cw, align: c.a || 'left' });
    });
    w.doc.save().moveTo(w.left, w.y + rh).lineTo(w.right, w.y + rh).lineWidth(0.5).strokeColor(C.border).stroke().restore();
    w.y += rh;
  });
  w.y += 10;
}

function drawTrend(w, trend) {
  w.sectionTitle('Progress over time', 'Average score of each session day, as a percentage.', trend.length < 2 ? 20 : 180);
  if (trend.length < 2) {
    w.text('A trend line appears after two or more scored session days.', w.left, w.y, { color: C.muted });
    w.y += 18;
    return;
  }
  const h = 150;
  w.ensure(h + 30);
  const doc = w.doc;
  const x0 = w.left + 30;
  const x1 = w.right - 8;
  const y0 = w.y + 6;
  const y1 = y0 + h - 20;
  [0, 25, 50, 75, 100].forEach((v) => {
    const y = y1 - ((y1 - y0) * v) / 100;
    doc.save().moveTo(x0, y).lineTo(x1, y).lineWidth(0.5).strokeColor(v === 0 ? C.muted : C.track).stroke().restore();
    w.text(`${v}%`, w.left, y - 4, { size: 7, color: C.muted, width: 26, align: 'right' });
  });
  const n = trend.length;
  const px = (i) => x0 + ((x1 - x0) * i) / (n - 1);
  const py = (v) => y1 - ((y1 - y0) * Math.max(0, Math.min(100, v))) / 100;
  doc.save();
  doc.moveTo(px(0), py(trend[0].pct));
  trend.forEach((p, i) => {
    if (i) doc.lineTo(px(i), py(p.pct));
  });
  doc.lineWidth(1.8).strokeColor(C.navy).stroke();
  doc.restore();
  trend.forEach((p, i) => {
    doc.save().circle(px(i), py(p.pct), 2.4).fill(i === n - 1 ? C.gold : C.navy).restore();
  });
  const last = trend[n - 1];
  w.text(`${last.pct}%`, px(n - 1) - 30, py(last.pct) - 13, { size: 8, bold: true, color: C.navy, width: 30, align: 'right' });
  const step = Math.max(1, Math.ceil(n / 6));
  for (let i = 0; i < n; i += step) {
    w.text(fmtDate(trend[i].date).replace(/ \d{4}$/, ''), px(i) - 25, y1 + 5, { size: 7, color: C.muted, width: 50, align: 'center' });
  }
  if ((n - 1) % step !== 0) {
    w.text(fmtDate(last.date).replace(/ \d{4}$/, ''), px(n - 1) - 25, y1 + 5, { size: 7, color: C.muted, width: 50, align: 'center' });
  }
  w.y = y1 + 24;
}

function drawScreening(w, screening) {
  w.sectionTitle('Screening results', 'Latest M-CHAT-R (autism likelihood) and ASQ-3 (development by domain).', 150);
  const m = screening?.mchat;
  w.ensure(24);
  w.text('M-CHAT-R', w.left, w.y + 2, { size: 9.5, bold: true, color: C.ink, width: 80 });
  if (m) {
    let x = w.left + 84;
    w.text(`Score ${m.totalScore ?? '—'} / ${m.maxScore || 20}`, x, w.y + 2, { size: 9.5, color: C.ink, width: 90 });
    x += 92;
    x += w.pill(`${zoneColors(m.riskLevel).label} likelihood`, x, w.y, zoneColors(m.riskLevel)) + 10;
    w.text(`Completed ${fmtDate(m.completedAt)}`, x, w.y + 2.5, { size: 8, color: C.muted, width: 160 });
  } else {
    w.text('Not completed', w.left + 84, w.y + 2, { color: C.muted });
  }
  w.y += 22;

  const a = screening?.asq3;
  w.ensure(24);
  w.text('ASQ-3', w.left, w.y + 2, { size: 9.5, bold: true, color: C.ink, width: 80 });
  if (!a) {
    w.text('Not completed', w.left + 84, w.y + 2, { color: C.muted });
    w.y += 22;
    return;
  }
  w.text(`${a.intervalMonths ? `${a.intervalMonths}-month questionnaire` : 'Questionnaire'} · completed ${fmtDate(a.completedAt)}`, w.left + 84, w.y + 2, {
    size: 8.5,
    color: C.body,
    width: w.width - 84,
  });
  w.y += 18;
  for (const d of a.domains || []) {
    w.ensure(18);
    const z = zoneColors(d.zone);
    w.text(d.domain, w.left + 84, w.y + 2, { size: 9, color: C.ink, width: 110 });
    w.bar(w.left + 196, w.y + 5, 140, 6, d.score != null ? (d.score / (d.maxScore || 60)) * 100 : 0, z.fg);
    w.text(`${d.score ?? '—'} / ${d.maxScore || 60}`, w.left + 342, w.y + 2, { size: 8.5, color: C.ink, width: 42, align: 'right' });
    w.text(d.referralCutoff != null ? `cutoff ${d.referralCutoff}` : '', w.left + 390, w.y + 2.5, { size: 7.5, color: C.muted, width: 50 });
    w.pill(z.label, w.right - 62, w.y + 1, z, 62);
    w.y += 17;
  }
  w.y += 6;
}

function drawHighlights(w, highlights) {
  w.sectionTitle('Highlights', undefined, 60);
  const colW = (w.width - 16) / 2;
  const startY = w.y;
  const startPage = w.doc.bufferedPageRange().count;
  w.text('Gains', w.left, w.y, { size: 9, bold: true, color: C.ok });
  w.y += 14;
  w.bullets(highlights?.improvements, w.left, colW, { dot: C.ok });
  const leftEnd = w.y;
  const samePage = w.doc.bufferedPageRange().count === startPage;
  w.y = samePage ? startY : w.y + 6;
  const x = samePage ? w.left + colW + 16 : w.left;
  w.text('Needs attention', x, w.y, { size: 9, bold: true, color: C.bad });
  w.y += 14;
  w.bullets(highlights?.needsAttention, x, colW, { dot: C.bad, empty: 'Nothing flagged.' });
  w.y = Math.max(w.y, samePage ? leftEnd : w.y) + 4;
}

function drawAudience(w, data) {
  const a = data.audience || {};
  const sub = (label) => {
    w.ensure(30);
    w.text(label, w.left, w.y, { size: 9.5, bold: true, color: C.ink });
    w.y += 14;
  };
  switch (a.kind) {
    case 'parent':
      w.sectionTitle('Ideas for home', 'From your child’s therapy plan and recent sessions.');
      w.bullets(a.homeTips, w.left, w.width);
      break;
    case 'clinician':
    case 'integrated':
      w.sectionTitle('Clinical notes');
      sub('Diagnosis');
      w.bullets(
        a.diagnosis
          ? [a.diagnosis.diagnosis, a.diagnosis.developmentalSummary && `Developmental summary: ${a.diagnosis.developmentalSummary}`].filter(Boolean)
          : [],
        w.left,
        w.width,
        { empty: 'No finalised clinical evaluation on file.' }
      );
      sub('Alerts');
      w.bullets((a.alerts || []).map((x) => `${x.severity === 'critical' ? 'Critical' : 'Warning'}: ${x.message}`), w.left, w.width, {
        dot: C.bad,
        empty: 'No active alerts.',
      });
      sub('Therapist observations');
      w.bullets(a.therapistObservations, w.left, w.width);
      break;
    case 'iep':
      w.sectionTitle('IEP review');
      sub('Long-term goal');
      w.bullets(a.longTermGoal ? [`${a.longTermGoal.title}${a.longTermGoal.description ? ` — ${a.longTermGoal.description}` : ''}`] : [], w.left, w.width);
      sub('Short-term goals and criteria');
      w.bullets(
        (a.shortTermGoals || []).map((g) => `${g.title}${g.criteria ? ` — ${g.criteria}` : ''}${g.reviewDate ? ` (review ${fmtDate(g.reviewDate)})` : ''}`),
        w.left,
        w.width
      );
      sub('Strategies');
      w.bullets((a.strategies || []).map((s) => (s.description ? `${s.title}: ${s.description}` : s.title)), w.left, w.width);
      w.ensure(16);
      w.text(`Next review by ${fmtDate(a.nextReviewBy)}`, w.left, w.y, { bold: true, color: C.navy });
      w.y += 16;
      break;
    case 'therapy':
      w.sectionTitle('Therapy plan');
      sub('Long-term goal');
      w.bullets(a.longTermGoal ? [`${a.longTermGoal.title}${a.longTermGoal.description ? ` — ${a.longTermGoal.description}` : ''}`] : [], w.left, w.width);
      sub('Activities');
      w.bullets((a.activities || []).map((s) => (s.description ? `${s.title}: ${s.description}` : s.title)), w.left, w.width);
      break;
    case 'session':
      w.sectionTitle('Recent sessions');
      w.bullets(
        (a.recentSessions || []).map(
          (s) => `${fmtDate(s.date)} · ${s.status}${s.durationMin ? ` · ${s.durationMin} min` : ''}${s.childResponse ? ` · response: ${s.childResponse}` : ''}${s.notes ? ` — ${s.notes}` : ''}`
        ),
        w.left,
        w.width
      );
      break;
    case 'monthly':
      w.sectionTitle('This month', `${fmtDate(a.periodStart)} – ${fmtDate(a.periodEnd)}`);
      w.ensure(16);
      w.text(`${a.sessionsThisMonth ?? 0} sessions completed, ${a.missedThisMonth ?? 0} missed.`, w.left, w.y, { color: C.ink });
      w.y += 16;
      sub('Therapist notes');
      w.bullets(a.therapistNotes, w.left, w.width);
      break;
    default:
      break;
  }
}

function drawFooters(doc, data) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // Writing below the bottom margin would make pdfkit start a new page; lift the margin while drawing.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - MARGIN + 4;
    doc.save().moveTo(MARGIN, y - 6).lineTo(doc.page.width - MARGIN, y - 6).lineWidth(0.5).strokeColor(C.border).stroke().restore();
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted);
    doc.text(`AutismCare · ${t(data.child?.name)} · Confidential`, MARGIN, y, { width: 300, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, doc.page.width - MARGIN - 100, y, { width: 100, align: 'right', lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }
}

/**
 * Render a standard-v1 report to a PDF stream.
 * @param {object} data report payload from buildStandardReport
 * @param {import('stream').Writable} out
 */
function renderStandardReportPdf(data, out) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: t(data.title), Author: 'AutismCare' } });
  doc.pipe(out);
  const w = new Writer(doc);

  drawHeader(w, data);
  drawChildPanel(w, data);
  drawSummary(w, data);
  drawStatTiles(w, data.stats || {});
  drawDomains(w, data.domains || []);
  drawGoals(w, data.goals || []);
  drawTrend(w, data.trend || []);
  drawScreening(w, data.screening || {});
  drawHighlights(w, data.highlights || {});
  drawAudience(w, data);

  w.sectionTitle('Recommendations');
  w.bullets(data.recommendations, w.left, w.width);

  w.ensure(40);
  w.y += 6;
  w.text(data.disclaimer, w.left, w.y, { size: 7.5, color: C.muted, width: w.width });

  drawFooters(doc, data);
  doc.end();
}

module.exports = { renderStandardReportPdf };
