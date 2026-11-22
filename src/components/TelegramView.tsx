import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ExternalLink,
  Link2,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  Unlink,
  Webhook,
  X,
} from 'lucide-react';
import type {
  Member,
  TelegramPreferences,
  TelegramRule,
  TelegramRuleType,
  TelegramStatusResponse,
} from '../../shared/types';
import { api } from '../api/client';
import { useI18n } from '../i18n';

interface TelegramViewProps {
  currentUser: Member;
  members: Member[];
  onToast: (msg: string) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function TelegramView({ currentUser, members, onToast }: TelegramViewProps) {
  const { t } = useI18n();
  const isParent = currentUser.role === 'parent';

  const [status, setStatus] = useState<TelegramStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deepLink, setDeepLink] = useState<string | null>(null);

  // Critical broadcast form (parents)
  const [broadcastTarget, setBroadcastTarget] = useState<string>('');
  const [broadcastMessage, setBroadcastMessage] = useState('');

  // New custom rule modal
  const [showAddRule, setShowAddRule] = useState(false);
  const [ruleType, setRuleType] = useState<TelegramRuleType>('reminder');
  const [ruleTitle, setRuleTitle] = useState('');
  const [ruleTargetId, setRuleTargetId] = useState<string>('');
  const [ruleKeyword, setRuleKeyword] = useState('');
  const [ruleTime, setRuleTime] = useState('19:00');
  const [ruleDays, setRuleDays] = useState<number[]>([]);
  const [ruleOnlyMandatory, setRuleOnlyMandatory] = useState(true);
  const [ruleCritical, setRuleCritical] = useState(false);

  const memberMap = new Map(members.map((m) => [m.id, m]));

  const loadStatus = useCallback(async () => {
    try {
      const data = await api.getTelegramStatus();
      setStatus(data);
    } catch {
      onToast(t.genericError);
    } finally {
      setLoading(false);
    }
  }, [onToast, t.genericError]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleSetupWebhook = async () => {
    setBusy(true);
    try {
      await api.setupTelegramWebhook();
      await loadStatus();
      onToast(t.tgWebhookReady);
    } catch (err) {
      onToast(err instanceof Error ? err.message : t.genericError);
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateDeepLink = async () => {
    setBusy(true);
    try {
      const res = await api.createTelegramLinkToken();
      setDeepLink(res.deepLink);
    } catch (err) {
      onToast(err instanceof Error ? err.message : t.genericError);
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      await api.sendTelegramTest();
      onToast(t.tgTestSent);
    } catch (err) {
      onToast(err instanceof Error ? err.message : t.genericError);
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async () => {
    setBusy(true);
    try {
      await api.unlinkTelegram();
      setDeepLink(null);
      await loadStatus();
      onToast(t.savedToast);
    } finally {
      setBusy(false);
    }
  };

  const handlePrefChange = async (patch: Partial<Omit<TelegramPreferences, 'memberId'>>) => {
    if (!status) return;
    setStatus({
      ...status,
      preferences: { ...status.preferences, ...patch },
    });
    try {
      const res = await api.updateTelegramPreferences(patch);
      setStatus((prev) => (prev ? { ...prev, preferences: res.preferences } : prev));
    } catch {
      onToast(t.genericError);
      void loadStatus();
    }
  };

  const toggleRuleDay = (day: number) => {
    setRuleDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    );
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleTitle.trim()) return;
    setBusy(true);
    try {
      const needsTime = ruleType === 'reminder' || ruleType === 'if_not_done';
      await api.createTelegramRule({
        ruleType,
        title: ruleTitle.trim(),
        targetMemberId: ruleType === 'reminder' ? null : ruleTargetId || null,
        taskKeyword: ruleType === 'reminder' ? null : ruleKeyword.trim() || null,
        onlyMandatory: ruleType === 'if_not_done' ? ruleOnlyMandatory : false,
        scheduleDays: ruleDays.length > 0 ? ruleDays : null,
        triggerTime: needsTime ? ruleTime : null,
        isCritical: ruleCritical,
      });
      setRuleTitle('');
      setRuleKeyword('');
      setRuleDays([]);
      setRuleCritical(false);
      setShowAddRule(false);
      await loadStatus();
      onToast(t.savedToast);
    } catch (err) {
      onToast(err instanceof Error ? err.message : t.genericError);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleRule = async (rule: TelegramRule) => {
    await api.updateTelegramRule(rule.id, { enabled: !rule.enabled });
    await loadStatus();
  };

  const handleDeleteRule = async (rule: TelegramRule) => {
    await api.deleteTelegramRule(rule.id);
    await loadStatus();
  };

  const handleCriticalBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastMessage.trim()) return;
    setBusy(true);
    try {
      await api.sendCriticalAlert({
        targetMemberId: broadcastTarget || null,
        message: broadcastMessage.trim(),
      });
      setBroadcastMessage('');
      onToast(t.tgCriticalBroadcastSent);
    } catch (err) {
      onToast(err instanceof Error ? err.message : t.genericError);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !status) {
    return (
      <div className="section-page">
        <div className="panel">{t.syncing}</div>
      </div>
    );
  }

  const prefs = status.preferences;
  const needsTime = ruleType === 'reminder' || ruleType === 'if_not_done';

  return (
    <div className="section-page animate-in">
      <div className="page-header">
        <div>
          <h2>{t.tgTitle}</h2>
          <p>{t.tgSubtitle}</p>
        </div>
      </div>

      {/* 1. Connection & Webhook Card */}
      <section className="panel">
        <div className="queue-card-head" style={{ marginBottom: '12px' }}>
          <h3 className="panel-title" style={{ marginBottom: 0 }}>
            <Send size={18} color="var(--ocean)" />
            Telegram Bot {status.botUsername ? `@${status.botUsername}` : ''}
          </h3>
          <span className={`tag ${status.linked ? 'tag-status-approved' : 'tag-status-pending'}`}>
            {status.linked ? (
              <>
                <CheckCircle2 size={12} /> {t.tgConnected} ({status.chatIdMasked})
              </>
            ) : (
              t.tgNotConnected
            )}
          </span>
        </div>

        {!status.botConfigured ? (
          <div className="alert-error">{t.tgBotNotConfigured}</div>
        ) : (
          <div className="stack">
            <div className="task-actions">
              {!status.linked ? (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={busy}
                  onClick={handleGenerateDeepLink}
                >
                  <Link2 size={15} />
                  {t.tgConnectBtn}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-soft-forest"
                    disabled={busy}
                    onClick={handleTest}
                  >
                    <Send size={14} />
                    {t.tgTestBtn}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    disabled={busy}
                    onClick={handleGenerateDeepLink}
                  >
                    <Link2 size={14} />
                    {t.tgConnectBtn}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={busy}
                    onClick={handleUnlink}
                  >
                    <Unlink size={14} />
                    {t.tgUnlinkBtn}
                  </button>
                </>
              )}

              {isParent && (
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={busy}
                  onClick={handleSetupWebhook}
                >
                  <Webhook size={14} />
                  {t.tgSetupWebhookBtn}
                </button>
              )}
            </div>

            {deepLink && (
              <div className="code-callout" style={{ flexWrap: 'wrap' }}>
                <div style={{ fontSize: '13px', color: 'var(--forest-ink)' }}>{t.tgLinkHint}</div>
                <div className="task-actions">
                  <a
                    href={deepLink}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-sm btn-primary"
                    style={{ textDecoration: 'none' }}
                  >
                    <ExternalLink size={14} />
                    {t.tgOpenBotLink}
                  </a>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => void loadStatus()}
                  >
                    {t.refresh}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. Per-User Automatic Notification Preferences */}
      <section className="panel">
        <h3 className="panel-title">
          <Bell size={18} color="var(--forest)" />
          {t.tgPrefsTitle}
        </h3>

        <div className="stack">
          {isParent && (
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={prefs.notifyTaskReported}
                onChange={(e) => handlePrefChange({ notifyTaskReported: e.target.checked })}
              />
              <span>{t.tgPrefReported}</span>
            </label>
          )}

          {!isParent && (
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={prefs.notifyTaskReviewed}
                onChange={(e) => handlePrefChange({ notifyTaskReviewed: e.target.checked })}
              />
              <span>{t.tgPrefReviewed}</span>
            </label>
          )}

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={prefs.notifyChangeRequests}
              onChange={(e) => handlePrefChange({ notifyChangeRequests: e.target.checked })}
            />
            <span>{t.tgPrefRequests}</span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={prefs.notifyScreenTime}
              onChange={(e) => handlePrefChange({ notifyScreenTime: e.target.checked })}
            />
            <span>{t.tgPrefScreenTime}</span>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={prefs.notifyCritical}
              onChange={(e) => handlePrefChange({ notifyCritical: e.target.checked })}
            />
            <span>{t.tgPrefCritical}</span>
          </label>

          <div className="field" style={{ marginTop: '6px' }}>
            <span className="field-label">{t.tgQuietHoursLabel}</span>
            <div className="form-grid-2">
              <div className="field">
                <label className="field-label" style={{ fontSize: '12px' }}>
                  {t.tgQuietFrom}
                </label>
                <select
                  className="select"
                  value={prefs.quietStartHour ?? ''}
                  onChange={(e) =>
                    handlePrefChange({
                      quietStartHour: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                >
                  <option value="">{t.tgQuietOff}</option>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label" style={{ fontSize: '12px' }}>
                  {t.tgQuietTo}
                </label>
                <select
                  className="select"
                  value={prefs.quietEndHour ?? ''}
                  onChange={(e) =>
                    handlePrefChange({
                      quietEndHour: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                >
                  <option value="">{t.tgQuietOff}</option>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Custom User Reminders & Watch Rules */}
      <section className="panel">
        <div className="queue-card-head" style={{ marginBottom: '12px' }}>
          <div>
            <h3 className="panel-title" style={{ marginBottom: '4px' }}>
              {t.tgRulesTitle}
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--ink-secondary)' }}>{t.tgRulesSubtitle}</p>
          </div>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setShowAddRule(true)}>
            <Plus size={15} />
            {t.tgAddRuleBtn}
          </button>
        </div>

        {status.rules.length === 0 ? (
          <div className="empty-column">{t.tgNoRules}</div>
        ) : (
          <div className="stack">
            {status.rules.map((rule) => {
              const target = rule.targetMemberId ? memberMap.get(rule.targetMemberId) : null;
              return (
                <article
                  key={rule.id}
                  className="queue-card"
                  style={{ opacity: rule.enabled ? 1 : 0.6 }}
                >
                  <div className="queue-card-head">
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '14.5px' }}>{rule.title}</div>
                      <div className="task-tags" style={{ marginTop: '6px' }}>
                        <span className="tag">{t.tgRuleTypes[rule.ruleType]}</span>
                        {rule.triggerTime && <span className="tag">🕒 {rule.triggerTime}</span>}
                        {target && (
                          <span className="tag">
                            {target.avatarEmoji} {target.name}
                          </span>
                        )}
                        {rule.taskKeyword && <span className="tag">🔎 «{rule.taskKeyword}»</span>}
                        {rule.onlyMandatory && <span className="tag">{t.mandatoryBadge}</span>}
                        {rule.scheduleDays && rule.scheduleDays.length > 0 && (
                          <span className="tag">
                            {rule.scheduleDays.map((d) => t.weekdaysShort[d - 1]).join(', ')}
                          </span>
                        )}
                        {rule.isCritical && (
                          <span className="tag tag-status-rejected">{t.criticalBadge}</span>
                        )}
                      </div>
                    </div>

                    <div className="task-actions">
                      <button
                        type="button"
                        className="btn btn-xs btn-secondary"
                        onClick={() => handleToggleRule(rule)}
                      >
                        {rule.enabled ? <Pause size={13} /> : <Play size={13} />}
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-danger-outline"
                        onClick={() => handleDeleteRule(rule)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. Parent Urgent / Critical Broadcast */}
      {isParent && (
        <section className="panel" style={{ borderColor: 'var(--danger-border)' }}>
          <h3 className="panel-title">
            <AlertTriangle size={18} color="var(--danger)" />
            {t.tgCriticalBroadcastTitle}
          </h3>
          <form className="stack" onSubmit={handleCriticalBroadcast}>
            <div className="field">
              <select
                className="select"
                value={broadcastTarget}
                onChange={(e) => setBroadcastTarget(e.target.value)}
              >
                <option value="">{t.tgCriticalBroadcastAll}</option>
                {members
                  .filter((m) => m.id !== currentUser.id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.avatarEmoji} {m.name}
                    </option>
                  ))}
              </select>
            </div>
            <textarea
              className="textarea"
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              placeholder={t.tgCriticalBroadcastPlaceholder}
              maxLength={500}
              required
            />
            <div>
              <button
                type="submit"
                className="btn btn-sm btn-danger"
                disabled={busy || !broadcastMessage.trim()}
              >
                <Send size={14} />
                {t.tgCriticalBroadcastBtn}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Create Custom Rule Modal */}
      {showAddRule && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <form className="modal-card animate-in" onSubmit={handleCreateRule}>
            <div className="modal-header">
              <h3>{t.tgAddRuleBtn}</h3>
              <button type="button" className="icon-btn" onClick={() => setShowAddRule(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="field">
              <label className="field-label">{t.requestTypeLabel}</label>
              <select
                className="select"
                value={ruleType}
                onChange={(e) => setRuleType(e.target.value as TelegramRuleType)}
              >
                {(['reminder', 'if_not_done', 'on_task_done', 'on_task_reported'] as TelegramRuleType[]).map(
                  (rt) => (
                    <option key={rt} value={rt}>
                      {t.tgRuleTypes[rt]}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div className="field">
              <label className="field-label">{t.tgRuleTitleLabel}</label>
              <input
                className="input"
                value={ruleTitle}
                onChange={(e) => setRuleTitle(e.target.value)}
                placeholder={t.tgRuleTitlePlaceholder}
                maxLength={140}
                required
                autoFocus
              />
            </div>

            {needsTime && (
              <div className="field">
                <label className="field-label">{t.tgRuleTimeLabel}</label>
                <input
                  type="time"
                  className="input"
                  value={ruleTime}
                  onChange={(e) => setRuleTime(e.target.value)}
                  required
                />
              </div>
            )}

            {ruleType !== 'reminder' && (
              <div className="form-grid-2">
                <div className="field">
                  <label className="field-label">{t.tgRuleTargetLabel}</label>
                  <select
                    className="select"
                    value={ruleTargetId}
                    onChange={(e) => setRuleTargetId(e.target.value)}
                  >
                    <option value="">{t.tgRuleTargetAny}</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.avatarEmoji} {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="field-label">{t.tgRuleKeywordLabel}</label>
                  <input
                    className="input"
                    value={ruleKeyword}
                    onChange={(e) => setRuleKeyword(e.target.value)}
                    placeholder={t.tgRuleKeywordPlaceholder}
                    maxLength={80}
                  />
                </div>
              </div>
            )}

            {ruleType === 'if_not_done' && (
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={ruleOnlyMandatory}
                  onChange={(e) => setRuleOnlyMandatory(e.target.checked)}
                />
                <span>{t.tgRuleOnlyMandatory}</span>
              </label>
            )}

            <div className="field">
              <span className="field-label">{t.tgRuleDaysLabel}</span>
              <div className="chip-row">
                {t.weekdaysShort.map((label, idx) => {
                  const day = idx + 1;
                  return (
                    <button
                      key={day}
                      type="button"
                      className={`choice-chip ${ruleDays.includes(day) ? 'active' : ''}`}
                      onClick={() => toggleRuleDay(day)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={ruleCritical}
                onChange={(e) => setRuleCritical(e.target.checked)}
              />
              <span>{t.tgRuleCritical}</span>
            </label>

            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowAddRule(false)}>
                {t.cancel}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !ruleTitle.trim()}>
                {t.save}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
