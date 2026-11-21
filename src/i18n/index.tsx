import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Lang } from '../../shared/types';
import { en } from './en';
import { uk, type Translations } from './uk';

const STORAGE_KEY = 'family_dashboard_lang';

interface I18nContextValue {
  lang: Lang;
  t: Translations;
  setLang: (lang: Lang) => void;
  format: (template: string, vars: Record<string, string | number>) => string;
  formatDateLabel: (dateStr: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'uk') return saved;
  } catch {
    // ignore storage errors
  }
  return 'uk';
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore storage errors
    }
  }, [lang]);

  const setLang = (next: Lang) => {
    setLangState(next);
  };

  const t = lang === 'en' ? en : uk;

  const format = (template: string, vars: Record<string, string | number>) =>
    template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''));

  const formatDateLabel = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'uk-UA', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(dt);
  };

  return (
    <I18nContext.Provider value={{ lang, t, setLang, format, formatDateLabel }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
