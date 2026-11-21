import { useState } from 'react';
import { Check, CheckCircle2, Inbox, XCircle } from 'lucide-react';
import type { ChangeRequest, Member, TaskItem } from '../../shared/types';
import { useI18n } from '../i18n';

interface ApprovalsViewProps {
  members: Member[];
  pendingTasks: TaskItem[];
  requests: ChangeRequest[];
  busyId: string | null;
  onApproveTask: (task: TaskItem, decision: 'approve' | 'approve_partial') => void;
  onRejectTask: (task: TaskItem) => void;
  onResolveRequest: (
    request: ChangeRequest,
    status: 'approved' | 'declined',
    responseNote?: string,
  ) => Promise<void>;
}

export function ApprovalsView({
  members,
  pendingTasks,
  requests,
  busyId,
  onApproveTask,
  onRejectTask,
  onResolveRequest,
}: ApprovalsViewProps) {
  const { t, format } = useI18n();
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const memberById = new Map(members.map((m) => [m.id, m]));
  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const resolvedRequests = requests.filter((r) => r.status !== 'pending').slice(0, 10);

  return (
    <div className="section-page animate-in">
      <div className="page-header">
        <div>
          <h2>{t.approvalsTitle}</h2>
          <p>{t.approvalsSubtitle}</p>
        </div>
      </div>

      {/* Pending Tasks */}
      <section className="panel">
        <h3 className="panel-title">
          <CheckCircle2 size={18} color="var(--forest)" />
          {t.pendingTasksHeading}
          {pendingTasks.length > 0 && <span className="badge-count">{pendingTasks.length}</span>}
        </h3>

        {pendingTasks.length === 0 ? (
          <div className="empty-column">{t.allCaughtUp}</div>
        ) : (
          <div className="stack">
            {pendingTasks.map((task) => {
              const child = memberById.get(task.assigneeId);
              return (
                <article key={task.id} className="queue-card">
                  <div className="queue-card-head">
                    <div className="queue-who">
                      {child && (
                        <span className={`avatar-circle accent-${child.accentColor}`}>
                          {child.avatarEmoji}
                        </span>
                      )}
                      <span>{child?.name ?? task.assigneeId}</span>
                      <span className="tag">{task.taskDate}</span>
                    </div>
                    <span className="tag tag-status-pending">
                      {task.status === 'partial_review'
                        ? format(t.statusPartialReview, { pct: task.completionPct })
                        : t.statusPendingReview}
                    </span>
                  </div>

                  <div>
                    <div style={{ fontWeight: 700, fontSize: '15px' }}>{task.title}</div>
                    {task.description && (
                      <div style={{ fontSize: '13px', color: 'var(--ink-secondary)' }}>
                        {task.description}
                      </div>
                    )}
                  </div>

                  {task.reportNote && (
                    <div className="task-note-box">
                      <strong>{t.reportedByChild}:</strong> {task.reportNote}
                    </div>
                  )}

                  <div className="task-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busyId === task.id}
                      onClick={() => onApproveTask(task, 'approve')}
                    >
                      <Check size={15} />
                      {t.confirmFull}
                    </button>
                    {task.status === 'partial_review' && (
                      <button
                        type="button"
                        className="btn btn-sm btn-soft-ocean"
                        disabled={busyId === task.id}
                        onClick={() => onApproveTask(task, 'approve_partial')}
                      >
                        {t.confirmPartial} ({task.completionPct}%)
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm btn-danger-outline"
                      disabled={busyId === task.id}
                      onClick={() => onRejectTask(task)}
                    >
                      <XCircle size={15} />
                      {t.rejectTask}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Child Change Requests */}
      <section className="panel">
        <h3 className="panel-title">
          <Inbox size={18} color="var(--terracotta)" />
          {t.pendingRequestsHeading}
          {pendingRequests.length > 0 && (
            <span className="badge-count">{pendingRequests.length}</span>
          )}
        </h3>

        {requests.length === 0 ? (
          <div className="empty-column">{t.noRequests}</div>
        ) : (
          <div className="stack">
            {pendingRequests.map((req) => (
              <article key={req.id} className="queue-card" style={{ borderColor: 'var(--amber-border)' }}>
                <div className="queue-card-head">
                  <div className="queue-who">
                    <span>{req.requesterEmoji ?? '🙂'}</span>
                    <span>{req.requesterName ?? req.requesterId}</span>
                    <span className="tag">{t.requestTypes[req.requestType]}</span>
                  </div>
                  <span className="tag tag-status-pending">{t.requestStatusPending}</span>
                </div>

                {req.taskTitle && (
                  <div style={{ fontSize: '13px', color: 'var(--ink-secondary)' }}>
                    <strong>{t.requestTaskRef}:</strong> {req.taskTitle}
                  </div>
                )}
                {req.proposedTitle && (
                  <div style={{ fontSize: '13px', color: 'var(--ink-secondary)' }}>
                    <strong>{t.requestProposedTitle}:</strong> {req.proposedTitle}
                  </div>
                )}
                {req.proposedDate && (
                  <div style={{ fontSize: '13px', color: 'var(--ink-secondary)' }}>
                    <strong>{t.requestProposedDate}:</strong> {req.proposedDate}
                  </div>
                )}

                <p style={{ fontSize: '14px' }}>{req.message}</p>

                <input
                  className="input"
                  value={replyDrafts[req.id] ?? ''}
                  onChange={(e) =>
                    setReplyDrafts((prev) => ({ ...prev, [req.id]: e.target.value }))
                  }
                  placeholder={t.parentReplyPlaceholder}
                  maxLength={300}
                />

                <div className="task-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={busyId === req.id}
                    onClick={() => onResolveRequest(req, 'approved', replyDrafts[req.id])}
                  >
                    <Check size={15} />
                    {t.approveRequest}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger-outline"
                    disabled={busyId === req.id}
                    onClick={() => onResolveRequest(req, 'declined', replyDrafts[req.id])}
                  >
                    <XCircle size={15} />
                    {t.declineRequest}
                  </button>
                </div>
              </article>
            ))}

            {resolvedRequests.map((req) => (
              <article key={req.id} className="queue-card" style={{ opacity: 0.8 }}>
                <div className="queue-card-head">
                  <div className="queue-who">
                    <span>{req.requesterEmoji ?? '🙂'}</span>
                    <span>{req.requesterName ?? req.requesterId}</span>
                    <span className="tag">{t.requestTypes[req.requestType]}</span>
                  </div>
                  <span
                    className={`tag ${
                      req.status === 'approved' ? 'tag-status-approved' : 'tag-status-rejected'
                    }`}
                  >
                    {req.status === 'approved' ? t.requestStatusApproved : t.requestStatusDeclined}
                  </span>
                </div>
                <p style={{ fontSize: '13.5px' }}>{req.message}</p>
                {req.responseNote && (
                  <div className="task-note-box">
                    <strong>{t.parentFeedback}:</strong> {req.responseNote}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
