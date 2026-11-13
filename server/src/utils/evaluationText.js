/**
 * Clinical evaluation fields are either legacy free text or structured CDSS objects
 * (e.g. diagnosis: { primary, severityLevel, confidence, rationale }). Turn either into readable text.
 */
function clean(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

function diagnosisText(d) {
  if (d == null) return '';
  if (typeof d !== 'object') return clean(d);
  const primary = clean(d.primary);
  const severity = clean(d.severityLevel);
  const parts = [];
  if (primary) parts.push(severity ? `${primary} (${severity})` : primary);
  if (clean(d.rationale)) parts.push(clean(d.rationale));
  return parts.join(' — ');
}

/** Generic: strings as-is; objects → their non-empty text values (arrays joined); nested one level. */
function evaluationText(v) {
  if (v == null) return '';
  if (typeof v !== 'object') return clean(v);
  if (Array.isArray(v)) return v.map(evaluationText).filter(Boolean).join(', ');
  return Object.entries(v)
    .filter(([k]) => !['_id', 'id', 'confidence'].includes(k))
    .map(([, val]) => evaluationText(val))
    .filter(Boolean)
    .join('; ');
}

module.exports = { diagnosisText, evaluationText };
