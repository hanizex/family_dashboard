import { useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Link2,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  DevicePairCodeResponse,
  ExternalAccountSummary,
  Member,
} from '../../shared/types';
import { api } from '../api/client';
import { useI18n } from '../i18n';

interface FamilySettingsViewProps {
  members: Member[];
  externalAccounts: ExternalAccountSummary[];
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
}

interface IntegrationDraft {
  username: string;
  goalValue: number;
  autoApproveTask: boolean;
}

export function FamilySettingsView({
  members,
  externalAccounts,
  onRefresh,
  onToast,
}: FamilySettingsViewProps) {
  const { t, format } = useI18n();

  const [drafts, setDrafts] = useState<
    Record<string, { name: string; email: string; avatarEmoji: string; telegramChatId: string }>
  >(() =>
    Object.fromEntries(
      members.map((m) => [
        m.id,
        {
          name: m.name,
          email: m.email ?? '',
          avatarEmoji: m.avatarEmoji,
          telegramChatId: m.telegramChatId ?? '',
        },
      ]),
    ),
  );

  const [integrationDrafts, setIntegrationDrafts] = useState<Record<string, IntegrationDraft>>(
    () => {
      const initial: Record<string, IntegrationDraft> = {};
      for (const m of members) {
        const chess = externalAccounts.find(
          (a) => a.memberId === m.id && a.provider === 'chess_com',
        );
        const duo = externalAccounts.find(
          (a) => a.memberId === m.id && a.provider === 'duolingo',
        );
        initial[`${m.id}:chess_com`] = {
          username: chess?.externalUsername ?? '',
          goalValue: chess?.config.minGamesPerDay ?? 1,
          autoApproveTask: chess?.config.autoApproveTask !== false,
        };
        initial[`${m.id}:duolingo`] = {
          username: duo?.externalUsername ?? '',
          goalValue: duo?.config.minXpPerDay ?? 10,
          autoApproveTask: duo?.config.autoApproveTask !== false,
        };
      }
      return initial;
    },
  );

  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingIntegrationKey, setSavingIntegrationKey] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, DevicePairCodeResponse>>({});

  const resolveIntegrationError = (code: string | null): string | null => {
    if (!code) return null;
    const map = t.integrationErrors as Record<string, string>;
    return map[code] ?? code;
  };

  const updateDraft = (
    id: string,
    field: 'name' | 'email' | 'avatarEmoji' | 'telegramChatId',
    value: string,
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const updateIntDraft = (
    memberId: string,
    provider: 'chess_com' | 'duolingo',
    patch: Partial<IntegrationDraft>,
  ) => {
    const key = `${memberId}:${provider}`;
    setIntegrationDrafts((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? {
          username: '',
          goalValue: provider === 'chess_com' ? 1 : 10,
          autoApproveTask: true,
        }),
        ...patch,
      },
    }));
  };

  const handleSave = async (member: Member) => {
    const draft = drafts[member.id];
    if (!draft) return;
    setSavingId(member.id);
    try {
      await api.updateMember(member.id, {
        name: draft.name,
        email: draft.email || null,
        avatarEmoji: draft.avatarEmoji,
        telegramChatId: draft.telegramChatId || null,
      });
      await onRefresh();
      onToast(t.savedToast);
    } catch (err) {
      onToast(err instanceof Error ? err.message : t.genericError);
    } finally {
      setSavingId(null);
    }
  };

  const handleGenerateCode = async (memberId: string) => {
    setSavingId(memberId);
    try {
      const codeResp = await api.generateDeviceCode(memberId);
      setCodes((prev) => ({ ...prev, [memberId]: codeResp }));
    } catch {
      onToast(t.genericError);
    } finally {
      setSavingId(null);
    }
  };

  const handleRevoke = async (member: Member) => {
    if (!window.confirm(format(t.revokeConfirm, { name: member.name }))) return;
    setSavingId(member.id);
    try {
      await api.revokeMemberSessions(member.id);
      onToast(t.savedToast);
    } catch {
      onToast(t.genericError);
    } finally {
      setSavingId(null);
    }
  };

  const handleSaveIntegration = async (memberId: string, provider: 'chess_com' | 'duolingo') => {
    const key = `${memberId}:${provider}`;
    const draft = integrationDrafts[key];
    if (!draft?.username.trim()) return;

    setSavingIntegrationKey(key);
    try {
      const res = await api.saveIntegration(memberId, provider, {
        username: draft.username.trim(),
        minGamesPerDay: provider === 'chess_com' ? draft.goalValue : undefined,
        minXpPerDay: provider === 'duolingo' ? draft.goalValue : undefined,
        autoApproveTask: draft.autoApproveTask,
      });
      await onRefresh();
      if (res.account.lastError) {
        onToast(resolveIntegrationError(res.account.lastError) ?? t.genericError);
      } else if (res.tasksVerified > 0) {
        onToast(format(t.syncCompleteToast, { count: res.tasksVerified }));
      } else {
        onToast(t.savedToast);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : t.genericError);
    } finally {
      setSavingIntegrationKey(null);
    }
  };

  const handleDeleteIntegration = async (memberId: string, provider: 'chess_com' | 'duolingo') => {
    const key = `${memberId}:${provider}`;
    setSavingIntegrationKey(key);
    try {
      await api.deleteIntegration(memberId, provider);
      updateIntDraft(memberId, provider, { username: '' });
      await onRefresh();
      onToast(t.savedToast);
    } catch {
      onToast(t.genericError);
    } finally {
      setSavingIntegrationKey(null);
    }
  };

  const handleAddLinkedRoutine = async (memberId: string, provider: 'chess_com' | 'duolingo') => {
    const key = `${memberId}:${provider}`;
    setSavingIntegrationKey(key);
    try {
      const res = await api.createIntegrationRoutine(memberId, provider);
      await onRefresh();
      onToast(res.alreadyExisted ? t.routineExistsToast : t.routineAddedToast);
    } catch {
      onToast(t.genericError);
    } finally {
      setSavingIntegrationKey(null);
    }
  };

  return (
    <div className="section-page animate-in">
      <div className="page-header">
        <div>
          <h2>{t.familyTitle}</h2>
          <p>{t.familySubtitle}</p>
        </div>
      </div>

      {/* Member Profiles & Auth */}
      <div className="members-grid">
        {members.map((member) => {
          const draft = drafts[member.id] ?? {
            name: member.name,
            email: member.email ?? '',
            avatarEmoji: member.avatarEmoji,
            telegramChatId: member.telegramChatId ?? '',
          };
          const activeCode = codes[member.id];

          return (
            <article key={member.id} className="member-settings-card">
              <div className="queue-card-head">
                <div className="queue-who">
                  <span className={`avatar-circle avatar-lg accent-${member.accentColor}`}>
                    {draft.avatarEmoji || member.avatarEmoji}
                  </span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '16px' }}>{member.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
                      {member.role === 'parent' ? t.roleParent : t.roleChild}
                    </div>
                  </div>
                </div>
              </div>

              <div className="form-grid-2">
                <div className="field">
                  <label className="field-label">{t.nameLabel}</label>
                  <input
                    className="input"
                    value={draft.name}
                    onChange={(e) => updateDraft(member.id, 'name', e.target.value)}
                    maxLength={40}
                  />
                </div>
                <div className="field">
                  <label className="field-label">{t.avatarLabel}</label>
                  <input
                    className="input"
                    value={draft.avatarEmoji}
                    onChange={(e) => updateDraft(member.id, 'avatarEmoji', e.target.value)}
                    maxLength={6}
                  />
                </div>
              </div>

              <div className="field">
                <label className="field-label">{t.emailLabel}</label>
                <input
                  type="email"
                  className="input"
                  value={draft.email}
                  onChange={(e) => updateDraft(member.id, 'email', e.target.value)}
                  placeholder={t.emailPlaceholder}
                />
              </div>

              <div className="field">
                <label className="field-label">{t.telegramLabel}</label>
                <input
                  className="input"
                  value={draft.telegramChatId}
                  onChange={(e) => updateDraft(member.id, 'telegramChatId', e.target.value)}
                  placeholder={t.telegramPlaceholder}
                />
              </div>

              {activeCode && (
                <div className="code-callout">
                  <div>
                    <div style={{ fontSize: '11.5px', color: 'var(--forest-ink)', fontWeight: 600 }}>
                      {t.deviceCodeGenerated}
                    </div>
                    <div className="code-big">{activeCode.code}</div>
                  </div>
                </div>
              )}

              <div className="task-actions" style={{ justifyContent: 'space-between' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={savingId === member.id}
                  onClick={() => handleSave(member)}
                >
                  <Save size={14} />
                  {t.save}
                </button>
                <div className="task-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    disabled={savingId === member.id}
                    onClick={() => handleGenerateCode(member.id)}
                  >
                    <KeyRound size={14} />
                    {t.generateDeviceCode}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={savingId === member.id}
                    onClick={() => handleRevoke(member)}
                    title={t.revokeDevices}
                  >
                    <LogOut size={14} />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Phase 3A: Chess.com & Duolingo Connections */}
      <section className="panel">
        <div style={{ marginBottom: '14px' }}>
          <h3 className="panel-title" style={{ marginBottom: '4px' }}>
            <Link2 size={18} color="var(--forest)" />
            {t.integrationsTitle}
          </h3>
          <p style={{ fontSize: '13.5px', color: 'var(--ink-secondary)' }}>
            {t.integrationsSubtitle}
          </p>
        </div>

        <div className="members-grid">
          {members.map((member) => {
            const chessAcc = externalAccounts.find(
              (a) => a.memberId === member.id && a.provider === 'chess_com',
            );
            const duoAcc = externalAccounts.find(
              (a) => a.memberId === member.id && a.provider === 'duolingo',
            );
            const chessKey = `${member.id}:chess_com`;
            const duoKey = `${member.id}:duolingo`;
            const chessDraft = integrationDrafts[chessKey] ?? {
              username: chessAcc?.externalUsername ?? '',
              goalValue: chessAcc?.config.minGamesPerDay ?? 1,
              autoApproveTask: chessAcc?.config.autoApproveTask !== false,
            };
            const duoDraft = integrationDrafts[duoKey] ?? {
              username: duoAcc?.externalUsername ?? '',
              goalValue: duoAcc?.config.minXpPerDay ?? 10,
              autoApproveTask: duoAcc?.config.autoApproveTask !== false,
            };

            return (
              <article key={`int-${member.id}`} className="member-settings-card">
                <div className="queue-who">
                  <span className={`avatar-circle accent-${member.accentColor}`}>
                    {member.avatarEmoji}
                  </span>
                  <span>{member.name}</span>
                </div>

                {/* Chess.com */}
                <div className="integration-row-box">
                  <div className="queue-card-head">
                    <strong style={{ fontSize: '14px' }}>♟️ Chess.com</strong>
                    {chessAcc?.goalMetToday && (
                      <span className="tag tag-status-approved">
                        <CheckCircle2 size={12} /> {t.statusApproved}
                      </span>
                    )}
                  </div>

                  <div className="form-grid-2">
                    <input
                      className="input"
                      value={chessDraft.username}
                      onChange={(e) =>
                        updateIntDraft(member.id, 'chess_com', { username: e.target.value })
                      }
                      placeholder={t.chessUsernamePlaceholder}
                    />
                    <div className="field" style={{ gap: '3px' }}>
                      <label className="field-label" style={{ fontSize: '11.5px' }}>
                        {t.minGamesLabel}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        className="input"
                        value={chessDraft.goalValue}
                        onChange={(e) =>
                          updateIntDraft(member.id, 'chess_com', {
                            goalValue: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                      />
                    </div>
                  </div>

                  <label className="toggle-row" style={{ padding: '7px 10px', fontSize: '12.5px' }}>
                    <input
                      type="checkbox"
                      checked={chessDraft.autoApproveTask}
                      onChange={(e) =>
                        updateIntDraft(member.id, 'chess_com', {
                          autoApproveTask: e.target.checked,
                        })
                      }
                    />
                    <span>{t.autoApproveToggle}</span>
                  </label>

                  {chessAcc?.chessStats && (
                    <div className="integration-stat-line">
                      {chessAcc.chessStats.rapidRating && (
                        <span className="tag tag-source-chess">
                          {format(t.chessRating, { rating: chessAcc.chessStats.rapidRating })}
                        </span>
                      )}
                      {chessAcc.chessStats.tacticsBest && (
                        <span className="tag">
                          {format(t.chessPuzzles, { rating: chessAcc.chessStats.tacticsBest })}
                        </span>
                      )}
                      <span className="tag">
                        {format(t.chessTodayGames, { n: chessAcc.chessStats.gamesToday })}
                      </span>
                    </div>
                  )}

                  {chessAcc?.lastError && (
                    <div className="alert-error" style={{ padding: '8px 10px', fontSize: '12px' }}>
                      {resolveIntegrationError(chessAcc.lastError)}
                    </div>
                  )}

                  <div className="task-actions">
                    <button
                      type="button"
                      className="btn btn-xs btn-primary"
                      disabled={savingIntegrationKey === chessKey || !chessDraft.username.trim()}
                      onClick={() => handleSaveIntegration(member.id, 'chess_com')}
                    >
                      <RefreshCw
                        size={13}
                        className={savingIntegrationKey === chessKey ? 'spin' : ''}
                      />
                      {t.saveAndVerify}
                    </button>
                    {chessAcc && (
                      <>
                        <button
                          type="button"
                          className="btn btn-xs btn-soft-forest"
                          disabled={savingIntegrationKey === chessKey}
                          onClick={() => handleAddLinkedRoutine(member.id, 'chess_com')}
                        >
                          <Plus size={13} />
                          {t.addDailyRoutineBtn}
                        </button>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          disabled={savingIntegrationKey === chessKey}
                          onClick={() => handleDeleteIntegration(member.id, 'chess_com')}
                          title={t.unlinkAccount}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Duolingo */}
                <div className="integration-row-box">
                  <div className="queue-card-head">
                    <strong style={{ fontSize: '14px' }}>🦉 Duolingo</strong>
                    {duoAcc?.goalMetToday && (
                      <span className="tag tag-status-approved">
                        <CheckCircle2 size={12} /> {t.duoDoneToday}
                      </span>
                    )}
                  </div>

                  <div className="form-grid-2">
                    <input
                      className="input"
                      value={duoDraft.username}
                      onChange={(e) =>
                        updateIntDraft(member.id, 'duolingo', { username: e.target.value })
                      }
                      placeholder={t.duolingoUsernamePlaceholder}
                    />
                    <div className="field" style={{ gap: '3px' }}>
                      <label className="field-label" style={{ fontSize: '11.5px' }}>
                        {t.minXpLabel}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        step={5}
                        className="input"
                        value={duoDraft.goalValue}
                        onChange={(e) =>
                          updateIntDraft(member.id, 'duolingo', {
                            goalValue: Math.max(1, Number(e.target.value) || 10),
                          })
                        }
                      />
                    </div>
                  </div>

                  <label className="toggle-row" style={{ padding: '7px 10px', fontSize: '12.5px' }}>
                    <input
                      type="checkbox"
                      checked={duoDraft.autoApproveTask}
                      onChange={(e) =>
                        updateIntDraft(member.id, 'duolingo', {
                          autoApproveTask: e.target.checked,
                        })
                      }
                    />
                    <span>{t.autoApproveToggle}</span>
                  </label>

                  {duoAcc?.duolingoStats && (
                    <div className="integration-stat-line">
                      <span className="tag tag-source-duo">
                        🔥 {format(t.duoStreak, { n: duoAcc.duolingoStats.streak })}
                      </span>
                      <span className="tag">
                        {format(t.duoTotalXp, { xp: duoAcc.duolingoStats.totalXp })}
                      </span>
                      {duoAcc.duolingoStats.xpToday > 0 && (
                        <span className="tag tag-status-approved">
                          {format(t.duoXpToday, { xp: duoAcc.duolingoStats.xpToday })}
                        </span>
                      )}
                    </div>
                  )}

                  {duoAcc?.lastError && (
                    <div className="alert-error" style={{ padding: '8px 10px', fontSize: '12px' }}>
                      {resolveIntegrationError(duoAcc.lastError)}
                    </div>
                  )}

                  <div className="task-actions">
                    <button
                      type="button"
                      className="btn btn-xs btn-primary"
                      disabled={savingIntegrationKey === duoKey || !duoDraft.username.trim()}
                      onClick={() => handleSaveIntegration(member.id, 'duolingo')}
                    >
                      <RefreshCw
                        size={13}
                        className={savingIntegrationKey === duoKey ? 'spin' : ''}
                      />
                      {t.saveAndVerify}
                    </button>
                    {duoAcc && (
                      <>
                        <button
                          type="button"
                          className="btn btn-xs btn-soft-forest"
                          disabled={savingIntegrationKey === duoKey}
                          onClick={() => handleAddLinkedRoutine(member.id, 'duolingo')}
                        >
                          <Plus size={13} />
                          {t.addDailyRoutineBtn}
                        </button>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          disabled={savingIntegrationKey === duoKey}
                          onClick={() => handleDeleteIntegration(member.id, 'duolingo')}
                          title={t.unlinkAccount}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="roadmap-banner">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sparkles size={16} color="var(--terracotta)" />
          {t.roadmapBannerTitle}
        </h3>
        <p>• {t.roadmapPhase3}</p>
        <p>• {t.roadmapPhase2}</p>
      </section>
    </div>
  );
}
