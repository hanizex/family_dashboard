import React, { useState } from 'react';
import { CalendarClock, Pause, Play, Plus, Trash2, X } from 'lucide-react';
import type { Member, ScheduleType, TaskCategory, TaskTemplate } from '../../shared/types';
import { useI18n } from '../i18n';

const CATEGORIES: TaskCategory[] = [
  'school',
  'chores',
  'health',
  'pet',
  'errands',
  'extra',
  'general',
];

interface RoutinesViewProps {
  members: Member[];
  templates: TaskTemplate[];
  onCreateTemplate: (payload: {
    assigneeId: string;
    title: string;
    description?: string;
    category: TaskCategory;
    isMandatory: boolean;
    scheduleType: ScheduleType;
    scheduleDays?: number[];
    intervalDays?: number;
    xpValue: number;
  }) => Promise<void>;
  onToggleTemplate: (tpl: TaskTemplate) => Promise<void>;
  onDeleteTemplate: (tpl: TaskTemplate) => Promise<void>;
}

export function RoutinesView({
  members,
  templates,
  onCreateTemplate,
  onToggleTemplate,
  onDeleteTemplate,
}: RoutinesViewProps) {
  const { t, format } = useI18n();
  const [showAdd, setShowAdd] = useState(false);

  const [assigneeId, setAssigneeId] = useState(
    members.find((m) => m.role === 'child')?.id ?? members[0]?.id ?? 'child-1',
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TaskCategory>('school');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('daily');
  const [customDays, setCustomDays] = useState<number[]>([1, 3, 5]);
  const [intervalDays, setIntervalDays] = useState(3);
  const [isMandatory, setIsMandatory] = useState(true);
  const [xpValue, setXpValue] = useState(15);
  const [saving, setSaving] = useState(false);

  const memberById = new Map(members.map((m) => [m.id, m]));

  const formatSchedule = (tpl: TaskTemplate) => {
    if (tpl.scheduleType === 'every_n_days') {
      return format(t.everyNDaysBadge, { n: tpl.intervalDays ?? 2 });
    }
    if (tpl.scheduleType === 'custom_days' && tpl.scheduleDays?.length) {
      return tpl.scheduleDays.map((d) => t.weekdaysShort[d - 1]).join(', ');
    }
    return t.schedules[tpl.scheduleType];
  };

  const toggleDay = (day: number) => {
    setCustomDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onCreateTemplate({
        assigneeId,
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        isMandatory,
        scheduleType,
        scheduleDays: scheduleType === 'custom_days' ? customDays : undefined,
        intervalDays: scheduleType === 'every_n_days' ? intervalDays : undefined,
        xpValue,
      });
      setTitle('');
      setDescription('');
      setShowAdd(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="section-page animate-in">
      <div className="page-header">
        <div>
          <h2>{t.routinesTitle}</h2>
          <p>{t.routinesSubtitle}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
          <Plus size={16} />
          {t.addRoutine}
        </button>
      </div>

      <section className="panel">
        {templates.length === 0 ? (
          <div className="empty-column">{t.noRoutines}</div>
        ) : (
          <div className="stack">
            {templates.map((tpl) => {
              const assignee = memberById.get(tpl.assigneeId);
              return (
                <article
                  key={tpl.id}
                  className="queue-card"
                  style={{ opacity: tpl.active ? 1 : 0.6 }}
                >
                  <div className="queue-card-head">
                    <div className="queue-who">
                      {assignee && (
                        <span className={`avatar-circle accent-${assignee.accentColor}`}>
                          {assignee.avatarEmoji}
                        </span>
                      )}
                      <div>
                        <div style={{ fontWeight: 700 }}>{tpl.title}</div>
                        <div style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
                          {assignee?.name} · {formatSchedule(tpl)}
                        </div>
                      </div>
                    </div>

                    <div className="task-actions">
                      <span className={`tag ${tpl.active ? 'tag-status-approved' : ''}`}>
                        {tpl.active ? t.routineActive : t.routinePaused}
                      </span>
                      <button
                        type="button"
                        className="btn btn-xs btn-secondary"
                        onClick={() => onToggleTemplate(tpl)}
                        title={tpl.active ? t.routinePaused : t.routineActive}
                      >
                        {tpl.active ? <Pause size={13} /> : <Play size={13} />}
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-danger-outline"
                        onClick={() => onDeleteTemplate(tpl)}
                        title={t.delete}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {tpl.description && (
                    <div style={{ fontSize: '13px', color: 'var(--ink-secondary)' }}>
                      {tpl.description}
                    </div>
                  )}

                  <div className="task-tags">
                    <span className="tag">
                      <CalendarClock size={12} />
                      {formatSchedule(tpl)}
                    </span>
                    <span className="tag">{t.categories[tpl.category]}</span>
                    <span className="tag">
                      {tpl.isMandatory ? t.mandatoryBadge : t.extraBadge}
                    </span>
                    <span className="tag tag-xp">{format(t.xpHint, { xp: tpl.xpValue })}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showAdd && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <form className="modal-card animate-in" onSubmit={handleSubmit}>
            <div className="modal-header">
              <h3>{t.addRoutine}</h3>
              <button type="button" className="icon-btn" onClick={() => setShowAdd(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="field">
              <label htmlFor="tpl-title" className="field-label">
                {t.taskTitleLabel}
              </label>
              <input
                id="tpl-title"
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="form-grid-2">
              <div className="field">
                <label htmlFor="tpl-assignee" className="field-label">
                  {t.assigneeLabel}
                </label>
                <select
                  id="tpl-assignee"
                  className="select"
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.avatarEmoji} {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="tpl-schedule" className="field-label">
                  {t.scheduleLabel}
                </label>
                <select
                  id="tpl-schedule"
                  className="select"
                  value={scheduleType}
                  onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
                >
                  {(
                    ['daily', 'weekdays', 'weekends', 'custom_days', 'every_n_days'] as ScheduleType[]
                  ).map((st) => (
                    <option key={st} value={st}>
                      {t.schedules[st]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {scheduleType === 'custom_days' && (
              <div className="chip-row">
                {t.weekdaysShort.map((label, idx) => {
                  const day = idx + 1;
                  return (
                    <button
                      key={day}
                      type="button"
                      className={`choice-chip ${customDays.includes(day) ? 'active' : ''}`}
                      onClick={() => toggleDay(day)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {scheduleType === 'every_n_days' && (
              <div className="field">
                <label htmlFor="tpl-interval" className="field-label">
                  {t.everyNDaysLabel}
                </label>
                <input
                  id="tpl-interval"
                  type="number"
                  min={1}
                  max={30}
                  className="input"
                  value={intervalDays}
                  onChange={(e) => setIntervalDays(Number(e.target.value))}
                />
              </div>
            )}

            <div className="form-grid-2">
              <div className="field">
                <label htmlFor="tpl-cat" className="field-label">
                  {t.categoryLabel}
                </label>
                <select
                  id="tpl-cat"
                  className="select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as TaskCategory)}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {t.categories[cat]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="tpl-xp" className="field-label">
                  {t.xpValueLabel}
                </label>
                <input
                  id="tpl-xp"
                  type="number"
                  min={0}
                  max={500}
                  step={5}
                  className="input"
                  value={xpValue}
                  onChange={(e) => setXpValue(Number(e.target.value))}
                />
              </div>
            </div>

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={isMandatory}
                onChange={(e) => setIsMandatory(e.target.checked)}
              />
              <span>{t.mandatoryToggle}</span>
            </label>

            <div className="field">
              <label htmlFor="tpl-desc" className="field-label">
                {t.taskDescLabel}
              </label>
              <textarea
                id="tpl-desc"
                className="textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>
                {t.cancel}
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving || !title.trim()}>
                {t.save}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
