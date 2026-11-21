import { useState } from 'react';
import { KeyRound, LogOut, Save, Sparkles } from 'lucide-react';
import type { DevicePairCodeResponse, Member } from '../../shared/types';
import { api } from '../api/client';
import { useI18n } from '../i18n';

interface FamilySettingsViewProps {
  members: Member[];
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
}

export function FamilySettingsView({ members, onRefresh, onToast }: FamilySettingsViewProps) {
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
  const [savingId, setSavingId] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, DevicePairCodeResponse>>({});

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

  return (
    <div className="section-page animate-in">
      <div className="page-header">
        <div>
          <h2>{t.familyTitle}</h2>
          <p>{t.familySubtitle}</p>
        </div>
      </div>

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
