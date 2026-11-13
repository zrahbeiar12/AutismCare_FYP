import { Languages } from 'lucide-react';
import { useLanguage } from './LanguageContext';
import { LANGS, type Lang } from './strings';

/** Compact language + easy-reading control for the top bar. */
export function LanguageSwitcher() {
  const { lang, setLang, easyRead, setEasyRead, t } = useLanguage();
  return (
    <div className="flex items-center gap-1.5">
      <label className="sr-only" htmlFor="ac-lang">
        {t('shell.language')}
      </label>
      <Languages className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden />
      <select
        id="ac-lang"
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="h-9 rounded-lg border bg-card px-2 text-sm text-foreground"
      >
        {LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-pressed={easyRead}
        title={t('shell.easyReadHint')}
        onClick={() => setEasyRead(!easyRead)}
        className={`h-9 rounded-lg border px-2 text-sm font-semibold ${easyRead ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground'}`}
      >
        <span aria-hidden>Aa</span>
        <span className="sr-only">{t('shell.easyRead')}</span>
      </button>
    </div>
  );
}
