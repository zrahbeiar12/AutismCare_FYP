import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LANGS, STRINGS, type Lang, type StringKey } from './strings';

type LanguageState = {
  lang: Lang;
  setLang: (l: Lang) => void;
  easyRead: boolean;
  setEasyRead: (v: boolean) => void;
  /** Translate an app string; falls back to English. */
  t: (key: StringKey) => string;
  dir: 'ltr' | 'rtl';
  speechLang: string;
};

const KEY_LANG = 'ac.lang';
const KEY_EASY = 'ac.easyRead';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: preference just isn't remembered */
  }
}

const LanguageContext = createContext<LanguageState>({
  lang: 'en',
  setLang: () => {},
  easyRead: false,
  setEasyRead: () => {},
  t: (key) => STRINGS[key]?.en ?? String(key),
  dir: 'ltr',
  speechLang: 'en-US',
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const v = read(KEY_LANG);
    return v === 'ur' || v === 'roman' ? v : 'en';
  });
  const [easyRead, setEasyState] = useState<boolean>(() => read(KEY_EASY) === '1');
  const meta = LANGS.find((l) => l.id === lang) || LANGS[0];

  useEffect(() => {
    document.documentElement.lang = lang === 'ur' ? 'ur' : lang === 'roman' ? 'ur-Latn' : 'en';
    document.documentElement.dataset.lang = lang;
    document.documentElement.classList.toggle('easy-read', easyRead);
  }, [lang, easyRead]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    write(KEY_LANG, l);
  }, []);
  const setEasyRead = useCallback((v: boolean) => {
    setEasyState(v);
    write(KEY_EASY, v ? '1' : '0');
  }, []);
  const t = useCallback((key: StringKey) => {
    const e = STRINGS[key];
    if (!e) return String(key);
    return (e as Record<Lang, string>)[lang] || e.en;
  }, [lang]);

  const value = useMemo(
    () => ({ lang, setLang, easyRead, setEasyRead, t, dir: meta.dir, speechLang: meta.speech }),
    [lang, setLang, easyRead, setEasyRead, t, meta.dir, meta.speech]
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}
