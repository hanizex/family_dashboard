import React, { useState } from 'react';
import { X } from 'lucide-react';
import type {
  ChangeRequestType,
  Member,
  TaskCategory,
  TaskItem,
} from '../../shared/types';
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

/* ============================================================================
   1. Child Task Report Modal (Done / Partly Done)
   ============================================================================ */
export function ReportModal({
  task,
  mode,
  onClose,
  onSubmit,
}: {
  task: TaskItem;
  mode: 'done' | 'partial';
  onClose: () => void;
  onSubmit: (payload: { mode: 'done' | 'partial'; completionPct?: number; note?: string }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [pct, setPct] = useState<number>(task.completionPct > 0 && task.completionPct < 100 ? task.completionPct : 50);
  const [note, setNote] = useState(task.reportNote ?? '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit({
        mode,
        completionPct: mode === 'partial' ? pct : 100,
        note: note.trim() || undefined,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal-card animate-in" onSubmit={handleSubmit}>
        <div className="modal-header">
          <h3>{t.reportModalTitle}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t.close}>
            <X size={18} />
          </button>
        </div>

        <div>
          <strong style={{ fontSize: '15px' }}>{task.title}</strong>
          <p style={{ fontSize: '13px', color: 'var(--ink-secondary)', marginTop: '4px' }}>
            {mode === 'partial' ? t.reportPartialHint : t.reportDoneHint}
          </p>
        </div>

        {mode === 'partial' && (
          <div className="field">
            <label className="field-label">
              {t.completionPercent}: <strong>{pct}%</strong>
            </label>
            <div className="chip-row">
              {[25, 50, 75].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`choice-chip ${pct === preset ? 'active' : ''}`}
                  onClick={() => setPct(preset)}
                >
                  {preset}%
                </button>
              ))}
            </div>
            <input
              type="range"
              min={10}
              max={90}
              step={5}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              style={{ accentColor: 'var(--forest)', marginTop: '6px' }}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="report-note" className="field-label">
            {t.noteLabel}
          </label>
          <textarea
            id="report-note"
            className="textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.notePlaceholder}
            maxLength={300}
          />
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {t.submitReport}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ============================================================================
   2. Parent Reject Modal
   ============================================================================ */
export function RejectModal({
  task,
  onClose,
  onSubmit,
}: {
  task: TaskItem;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSubmit(note.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal-card animate-in" onSubmit={handleSubmit}>
        <div className="modal-header">
          <h3>{t.rejectModalTitle}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t.close}>
            <X size={18} />
          </button>
        </div>

        <strong style={{ fontSize: '15px' }}>{task.title}</strong>

        <div className="chip-row">
          {t.rejectQuickReasons.map((reason) => (
            <button
              key={reason}
              type="button"
              className={`choice-chip ${note === reason ? 'active' : ''}`}
              onClick={() => setNote(reason)}
            >
              {reason}
            </button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="reject-note" className="field-label">
            {t.rejectReasonLabel}
          </label>
          <textarea
            id="reject-note"
            className="textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.rejectReasonPlaceholder}
            maxLength={300}
          />
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="btn btn-danger" disabled={saving}>
            {t.confirmReject}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ============================================================================
   3. Parent Add / Edit Task Modal
   ============================================================================ */
export function TaskEditorModal({
  members,
  defaultDate,
  defaultAssigneeId,
  editingTask,
  onClose,
  onSave,
}: {
  members: Member[];
  defaultDate: string;
  defaultAssigneeId?: string;
  editingTask?: TaskItem | null;
  onClose: () => void;
  onSave: (payload: {
    assigneeId: string;
    taskDate: string;
    title: string;
    description?: string;
    category: TaskCategory;
    isMandatory: boolean;
    isCritical: boolean;
    xpValue: number;
    externalSource?: string | null;
  }) => Promise<void>;
}) {
  const { t } = useI18n();
  const initialAssignee =
    editingTask?.assigneeId ?? defaultAssigneeId ?? members[0]?.id ?? 'child-1';

  const [assigneeId, setAssigneeId] = useState(initialAssignee);
  const [taskDate, setTaskDate] = useState(editingTask?.taskDate ?? defaultDate);
  const [title, setTitle] = useState(editingTask?.title ?? '');
  const [description, setDescription] = useState(editingTask?.description ?? '');
  const [category, setCategory] = useState<TaskCategory>(editingTask?.category ?? 'general');
  const [isMandatory, setIsMandatory] = useState<boolean>(
    editingTask ? editingTask.isMandatory : members.find((m) => m.id === initialAssignee)?.role === 'child',
  );
  const [isCritical, setIsCritical] = useState<boolean>(editingTask?.isCritical ?? false);
  const [xpValue, setXpValue] = useState<number>(editingTask?.xpValue ?? 15);
  const [externalSource, setExternalSource] = useState<string>(editingTask?.externalSource ?? '');
  const [saving, setSaving] = useState(false);

  const selectedMember = members.find((m) => m.id === assigneeId);

  const handleAssigneeChange = (nextId: string) => {
    setAssigneeId(nextId);
    if (!editingTask) {
      const m = members.find((item) => item.id === nextId);
      setIsMandatory(m?.role === 'child');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({
        assigneeId,
        taskDate,
        title: title.trim(),
        description: description.trim() || undefined,
        category,
        isMandatory: selectedMember?.role === 'child' ? isMandatory : false,
        isCritical,
        xpValue,
        externalSource: externalSource || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal-card animate-in" onSubmit={handleSubmit}>
        <div className="modal-header">
          <h3>{editingTask ? t.editTaskTitle : t.addTaskTitle}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t.close}>
            <X size={18} />
          </button>
        </div>

        <div className="field">
          <label htmlFor="task-title-input" className="field-label">
            {t.taskTitleLabel}
          </label>
          <input
            id="task-title-input"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.taskTitlePlaceholder}
            maxLength={160}
            required
            autoFocus
          />
        </div>

        <div className="form-grid-2">
          <div className="field">
            <label htmlFor="task-assignee" className="field-label">
              {t.assigneeLabel}
            </label>
            <select
              id="task-assignee"
              className="select"
              value={assigneeId}
              onChange={(e) => handleAssigneeChange(e.target.value)}
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.avatarEmoji} {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="task-date" className="field-label">
              {t.dateLabel}
            </label>
            <input
              id="task-date"
              type="date"
              className="input"
              value={taskDate}
              onChange={(e) => setTaskDate(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-grid-2">
          <div className="field">
            <label htmlFor="task-category" className="field-label">
              {t.categoryLabel}
            </label>
            <select
              id="task-category"
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
            <label htmlFor="task-xp" className="field-label">
              {t.xpValueLabel}
            </label>
            <input
              id="task-xp"
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

        <div className="field">
          <label htmlFor="task-ext-source" className="field-label">
            {t.externalSourceLabel}
          </label>
          <select
            id="task-ext-source"
            className="select"
            value={externalSource}
            onChange={(e) => setExternalSource(e.target.value)}
          >
            <option value="">{t.externalSourceNone}</option>
            <option value="chess_com">{t.externalSourceChess}</option>
            <option value="duolingo">{t.externalSourceDuolingo}</option>
          </select>
        </div>

        {selectedMember?.role === 'child' && (
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={isMandatory}
              onChange={(e) => setIsMandatory(e.target.checked)}
            />
            <span>{t.mandatoryToggle}</span>
          </label>
        )}

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={isCritical}
            onChange={(e) => setIsCritical(e.target.checked)}
          />
          <span>{t.criticalToggle}</span>
        </label>

        <div className="field">
          <label htmlFor="task-desc" className="field-label">
            {t.taskDescLabel}
          </label>
          <textarea
            id="task-desc"
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.taskDescPlaceholder}
            maxLength={500}
          />
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || !title.trim()}>
            {t.save}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ============================================================================
   4. Child Change Request Modal
   ============================================================================ */
export function ChangeRequestModal({
  linkedTask,
  defaultDate,
  onClose,
  onSubmit,
}: {
  linkedTask?: TaskItem | null;
  defaultDate: string;
  onClose: () => void;
  onSubmit: (payload: {
    taskId?: string | null;
    requestType: ChangeRequestType;
    message: string;
    proposedDate?: string | null;
    proposedTitle?: string | null;
  }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [requestType, setRequestType] = useState<ChangeRequestType>(
    linkedTask ? 'reschedule' : 'new_task',
  );
  const [proposedDate, setProposedDate] = useState(defaultDate);
  const [proposedTitle, setProposedTitle] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        taskId: linkedTask?.id ?? null,
        requestType,
        message: message.trim(),
        proposedDate: requestType === 'reschedule' || requestType === 'new_task' ? proposedDate : null,
        proposedTitle: requestType === 'new_task' ? proposedTitle.trim() || null : null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal-card animate-in" onSubmit={handleSubmit}>
        <div className="modal-header">
          <h3>{t.requestModalTitle}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t.close}>
            <X size={18} />
          </button>
        </div>

        {linkedTask && (
          <div className="task-note-box">
            <strong>{t.requestTaskRef}:</strong> {linkedTask.title} ({linkedTask.taskDate})
          </div>
        )}

        <div className="field">
          <label htmlFor="req-type" className="field-label">
            {t.requestTypeLabel}
          </label>
          <select
            id="req-type"
            className="select"
            value={requestType}
            onChange={(e) => setRequestType(e.target.value as ChangeRequestType)}
          >
            {(['reschedule', 'modify', 'new_task', 'other'] as ChangeRequestType[]).map((rt) => (
              <option key={rt} value={rt}>
                {t.requestTypes[rt]}
              </option>
            ))}
          </select>
        </div>

        {requestType === 'new_task' && (
          <div className="field">
            <label htmlFor="req-title" className="field-label">
              {t.requestProposedTitle}
            </label>
            <input
              id="req-title"
              className="input"
              value={proposedTitle}
              onChange={(e) => setProposedTitle(e.target.value)}
              maxLength={160}
            />
          </div>
        )}

        {(requestType === 'reschedule' || requestType === 'new_task') && (
          <div className="field">
            <label htmlFor="req-date" className="field-label">
              {t.requestProposedDate}
            </label>
            <input
              id="req-date"
              type="date"
              className="input"
              value={proposedDate}
              onChange={(e) => setProposedDate(e.target.value)}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="req-msg" className="field-label">
            {t.requestMessageLabel}
          </label>
          <textarea
            id="req-msg"
            className="textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t.requestMessagePlaceholder}
            maxLength={400}
            required
          />
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || !message.trim()}>
            {t.sendRequest}
          </button>
        </div>
      </form>
    </div>
  );
}
