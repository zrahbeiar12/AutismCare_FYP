import React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '../i18n/LanguageContext';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import { STRINGS } from '../i18n/strings';
import { getParentNavigationItems } from '../components/parent/parentNavigation';
import { useLanguage } from '../i18n/LanguageContext';

function NavLabels() {
  const { t } = useLanguage();
  return <ul>{getParentNavigationItems(t).map((n) => <li key={n.id}>{n.label}</li>)}</ul>;
}

describe('Languages', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('every app string has English, Urdu and Roman Urdu text', () => {
    for (const [key, e] of Object.entries(STRINGS)) {
      if (key === 'screening.noOfficialTranslation') continue; // English needs no notice
      expect(e.en, key).toBeTruthy();
      expect(e.ur, key).toMatch(/[؀-ۿ]/);
      expect(e.roman, key).toBeTruthy();
    }
  });

  it('switching to Urdu translates the parent menu, remembers the choice, and easy reading toggles', () => {
    render(
      <LanguageProvider>
        <LanguageSwitcher />
        <NavLabels />
      </LanguageProvider>
    );
    expect(screen.getByText('My Children')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/language/i), { target: { value: 'ur' } });
    expect(screen.getByText('میرے بچے')).toBeTruthy();
    expect(document.documentElement.lang).toBe('ur');
    expect(localStorage.getItem('ac.lang')).toBe('ur');

    fireEvent.click(screen.getByRole('button', { pressed: false }));
    expect(document.documentElement.classList.contains('easy-read')).toBe(true);
  });
});
