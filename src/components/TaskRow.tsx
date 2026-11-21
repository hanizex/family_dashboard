import {
  Check,
  CheckCircle2,
  CircleDot,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { Member, TaskItem } from '../../shared/types';
import { useI18n } from '../i18n';

interface TaskRowProps {
  task: TaskItem;
  assignee: Member;
  currentUser: Member;
  busy: boolean;
  onParentToggle: (task: TaskItem) => void;
  onParentApprove: (task: TaskItem, decision: 'approve' | 'approve_partial') => void;
  onParentReject: (task: TaskItem) => void;
  onParentEdit: (task: TaskItem) => void;
  onParentDelete: (task: TaskItem) => void;
  onChildReport: (task: TaskItem, mode: 'done' | 'partial') => void;
  onChildRequestChange: (task: TaskItem) => void;
}

export function TaskRow({
  task,
  assignee,
  currentUser,
  busy,
  onParentToggle,
  onParentApprove,
  onParentReject,
  onParentEdit,
  onParentDelete,
  onChildReport,
  onChildRequestChange,
}: TaskRowProps) {
  const { t, format } = useI18n();

  const isParent = currentUser.role === 'parent';
  const isOwnerChild = currentUser.role === 'child' && currentUser.id === task.assigneeId;
  const isParentTask = assignee.role === 'parent';
  const isAwaitingReview = task.status === 'pending_review' || task.status === 'partial_review';

  const statusTag = () => {
    switch (task.status) {
      case 'approved':
        return <span className="tag tag-status-approved">{t.statusApproved}</span>;
      case 'pending_review':
        return <span className="tag tag-status-pending">{t.statusPendingReview}</span>;
      case 'partial_review':
        return (
          <span className="tag tag-status-pending">
            {format(t.statusPartialReview, { pct: task.completionPct })}
          </span>
        );
      case 'partial_approved':
        return (
          <span className="tag tag-status-partial-ok">
            {format(t.statusPartialApproved, { pct: task.completionPct })}
          </span>
        );
      case 'rejected':
        return <span className="tag tag-status-rejected">{t.statusRejected}</span>;
      default:
        return null;
    }
  };

  return (
    <div className={`task-row status-${task.status}`}>
      <div className="task-row-top">
        <div className="task-title-wrap">
          {isParent && isParentTask && (
            <button
              type="button"
              className={`parent-check-btn ${task.status === 'approved' ? 'checked' : ''}`}
              disabled={busy}
              aria-label={task.status === 'approved' ? t.markParentUndo : t.markParentDone}
              onClick={() => onParentToggle(task)}
            >
              {task.status === 'approved' && <Check size={14} strokeWidth={3} />}
            </button>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="task-title">{task.title}</div>
            {task.description && <div className="task-desc">{task.description}</div>}
          </div>
        </div>

        {isParent && (
          <div className="task-icon-actions">
            <button
              type="button"
              className="icon-btn"
              title={t.edit}
              aria-label={t.edit}
              disabled={busy}
              onClick={() => onParentEdit(task)}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={t.delete}
              aria-label={t.delete}
              disabled={busy}
              onClick={() => onParentDelete(task)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="task-tags">
        {statusTag()}
        <span className="tag">{t.categories[task.category] ?? task.category}</span>
        {assignee.role === 'child' && (
          <span className="tag tag-xp">{format(t.xpHint, { xp: task.xpValue })}</span>
        )}
      </div>

      {task.reportNote && (
        <div className="task-note-box">
          <strong>{t.reportedByChild}:</strong> {task.reportNote}
        </div>
      )}

      {task.reviewNote && (
        <div className={`task-note-box ${task.status === 'rejected' ? 'feedback-reject' : ''}`}>
          <strong>{t.parentFeedback}:</strong> {task.reviewNote}
        </div>
      )}

      {/* Child action bar (only on their own tasks that are not yet fully confirmed) */}
      {isOwnerChild && task.status !== 'approved' && (
        <div className="task-actions">
          <button
            type="button"
            className="btn btn-xs btn-soft-forest"
            disabled={busy}
            onClick={() => onChildReport(task, 'done')}
          >
            <CheckCircle2 size={14} />
            {task.status === 'rejected' ? t.resubmit : t.markDone}
          </button>
          <button
            type="button"
            className="btn btn-xs btn-soft-amber"
            disabled={busy}
            onClick={() => onChildReport(task, 'partial')}
          >
            <CircleDot size={14} />
            {t.markPartly}
          </button>
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            disabled={busy}
            onClick={() => onChildRequestChange(task)}
          >
            <MessageSquarePlus size={14} />
            {t.requestChange}
          </button>
        </div>
      )}

      {/* Parent action bar on child tasks */}
      {isParent && !isParentTask && (
        <div className="task-actions">
          {isAwaitingReview && (
            <>
              <button
                type="button"
                className="btn btn-xs btn-primary"
                disabled={busy}
                onClick={() => onParentApprove(task, 'approve')}
              >
                <Check size={14} />
                {t.confirmFull}
              </button>
              {task.status === 'partial_review' && (
                <button
                  type="button"
                  className="btn btn-xs btn-soft-ocean"
                  disabled={busy}
                  onClick={() => onParentApprove(task, 'approve_partial')}
                >
                  {t.confirmPartial} ({task.completionPct}%)
                </button>
              )}
              <button
                type="button"
                className="btn btn-xs btn-danger-outline"
                disabled={busy}
                onClick={() => onParentReject(task)}
              >
                <XCircle size={14} />
                {t.rejectTask}
              </button>
            </>
          )}

          {!isAwaitingReview && task.status !== 'approved' && (
            <button
              type="button"
              className="btn btn-xs btn-soft-forest"
              disabled={busy}
              onClick={() => onParentToggle(task)}
            >
              <Check size={14} />
              {t.confirmFull}
            </button>
          )}

          {task.status === 'approved' && (
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              disabled={busy}
              onClick={() => onParentToggle(task)}
            >
              <RotateCcw size={13} />
              {t.markParentUndo}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
