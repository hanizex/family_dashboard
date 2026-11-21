import React, { useState } from 'react';
import { KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import type { AuthStateResponse, Member } from '../../shared/types';
import { api, ApiError } from '../api/client';
import { useI18n } from '../i18n';

interface LoginScreenProps {
  authState: AuthStateResponse;
  urlError: string | null;
  onAuthenticated: (member: Member) => void;
}

export function LoginScreen({ authState, urlError, onAuthenticated }: LoginScreenProps) {
  const { lang, setLang, t } = useI18n();
  const [tab, setTab] = useState<'google' | 'code'>(authState.googleEnabled ? 'google' : 'code');
  const [code, setCode] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveErrorText = (errKey: string | null): string | null => {
    if (!errKey) return null;
    const map = t.authErrors as Record<string, string>;
    return map[errKey] ?? errKey;
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { member } = await api.deviceLogin(code, deviceLabel || undefined);
      onAuthenticated(member);
    } catch (err) {
      if (err instanceof ApiError && err.code) {
        const key = err.code.toLowerCase();
        setError(resolveErrorText(key) ?? err.message);
      } else {
        setError(t.genericError);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDevLogin = async (memberId: string) => {
    setError(null);
    setSubmitting(true);
    try {
      const { member } = await api.devLogin(memberId);
      onAuthenticated(member);
    } catch {
      setError(t.genericError);
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = error ?? resolveErrorText(urlError);

  return (
    <main className="login-page">
      <section className="login-card animate-in">
        <div className="login-brand">
          <div className="brand">
            <div className="brand-mark">
              <img src="/icons/icon.svg" alt="" />
            </div>
            <div className="brand-text">
              <h1>{t.appName}</h1>
              <span className="brand-role">{t.appTagline}</span>
            </div>
          </div>

          <div className="lang-switch" role="group" aria-label="Language">
            <button
              type="button"
              className={`lang-btn ${lang === 'uk' ? 'active' : ''}`}
              onClick={() => setLang('uk')}
            >
              UA
            </button>
            <button
              type="button"
              className={`lang-btn ${lang === 'en' ? 'active' : ''}`}
              onClick={() => setLang('en')}
            >
              EN
            </button>
          </div>
        </div>

        <div>
          <h2 style={{ fontSize: '20px', marginBottom: '6px' }}>{t.loginTitle}</h2>
          <p style={{ fontSize: '13.5px', color: 'var(--ink-secondary)' }}>{t.loginSubtitle}</p>
        </div>

        {displayError && (
          <div className="alert-error" role="alert">
            {displayError}
          </div>
        )}

        <div className="desktop-nav" style={{ display: 'flex', justifyContent: 'stretch' }}>
          <button
            type="button"
            className={`nav-tab ${tab === 'google' ? 'active' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => setTab('google')}
          >
            <ShieldCheck size={16} />
            {t.googleTab}
          </button>
          <button
            type="button"
            className={`nav-tab ${tab === 'code' ? 'active' : ''}`}
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => setTab('code')}
          >
            <Smartphone size={16} />
            {t.deviceCodeTab}
          </button>
        </div>

        {tab === 'google' ? (
          <div className="stack">
            <a
              href="/api/auth/google"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px 16px', textDecoration: 'none' }}
            >
              {t.signInWithGoogle}
            </a>
            {!authState.googleEnabled && (
              <p style={{ fontSize: '12.5px', color: 'var(--ink-muted)' }}>
                {t.authErrors.google_not_configured}
              </p>
            )}
          </div>
        ) : (
          <form className="stack" onSubmit={handleCodeSubmit}>
            <p style={{ fontSize: '12.5px', color: 'var(--ink-secondary)' }}>{t.deviceCodeHint}</p>
            <div className="field">
              <label htmlFor="device-code-input" className="field-label">
                {t.deviceCodeTab}
              </label>
              <input
                id="device-code-input"
                className="input"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder={t.deviceCodePlaceholder}
                maxLength={8}
                autoComplete="one-time-code"
                style={{
                  textTransform: 'uppercase',
                  letterSpacing: '0.16em',
                  fontWeight: 700,
                  fontSize: '18px',
                }}
                required
              />
            </div>
            <div className="field">
              <input
                id="device-label-input"
                className="input"
                value={deviceLabel}
                onChange={(e) => setDeviceLabel(e.target.value)}
                placeholder={t.deviceLabelPlaceholder}
                maxLength={50}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || code.trim().length < 6}
            >
              <KeyRound size={16} />
              {t.signInWithCode}
            </button>
          </form>
        )}

        {authState.devLoginEnabled && authState.devMembers && authState.devMembers.length > 0 && (
          <div className="dev-box">
            <div>
              <strong style={{ fontSize: '13px' }}>{t.devLoginHeading}</strong>
              <p style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>{t.devLoginNote}</p>
            </div>
            <div className="dev-grid">
              {authState.devMembers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="dev-member-btn"
                  disabled={submitting}
                  onClick={() => handleDevLogin(m.id)}
                >
                  <span className={`avatar-circle accent-${m.accentColor}`}>{m.avatarEmoji}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '13.5px' }}>{m.name}</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--ink-muted)' }}>
                      {m.role === 'parent' ? t.roleParent : t.roleChild}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
