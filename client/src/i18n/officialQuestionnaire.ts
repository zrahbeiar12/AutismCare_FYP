import { useEffect, useState } from 'react';
import type { Lang } from './strings';

/**
 * Official (validated, licensed) questionnaire translations, installed as static files:
 *   public/i18n/questionnaires/<instrument>-<lang>.json      e.g. mchat-ur.json, asq3-24-roman.json
 * Shape: { "source": "...", "items": { "<questionId>": "translated text" }, "options": { "yes": "...", ... } }
 * When no file is installed the questionnaire stays in English (never machine-translated).
 */
export type OfficialTranslation = {
  source?: string;
  items: Record<string, string>;
  options?: Record<string, string>;
};

const cache = new Map<string, Promise<OfficialTranslation | null>>();

function load(file: string): Promise<OfficialTranslation | null> {
  if (!cache.has(file)) {
    cache.set(
      file,
      fetch(`/i18n/questionnaires/${file}`, { cache: 'no-cache' })
        .then((r) => (r.ok && /json/i.test(r.headers.get('content-type') || '') ? r.json() : null))
        .then((j) => (j && typeof j.items === 'object' ? (j as OfficialTranslation) : null))
        .catch(() => null)
    );
  }
  return cache.get(file)!;
}

/** @param instrument "mchat" or "asq3-<interval>" */
export function useOfficialTranslation(instrument: string | null, lang: Lang) {
  const [data, setData] = useState<OfficialTranslation | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let alive = true;
    setData(null);
    setChecked(false);
    if (!instrument || lang === 'en') {
      setChecked(true);
      return undefined;
    }
    load(`${instrument}-${lang}.json`).then((d) => {
      if (!alive) return;
      setData(d);
      setChecked(true);
    });
    return () => {
      alive = false;
    };
  }, [instrument, lang]);
  return {
    /** Official item text, or the English original. */
    item: (questionId: string, english: string) => data?.items?.[questionId] || english,
    option: (value: string, fallback: string) => data?.options?.[value] || fallback,
    /** True when a non-English language is chosen but no official file is installed. */
    missing: checked && lang !== 'en' && !data,
  };
}
