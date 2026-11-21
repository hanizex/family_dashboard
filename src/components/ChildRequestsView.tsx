import { MessageSquarePlus } from 'lucide-react';
import type { ChangeRequest } from '../../shared/types';
import { useI18n } from '../i18n';

interface ChildRequestsViewProps {
  requests: ChangeRequest[];
  onNewRequest: () => void;
}

export function ChildRequestsView({ requests, onNewRequest }: ChildRequestsViewProps) {
  const { t } = useI18n();

  return (
    <div className="section-page animate-in">
      <div className="page-header">
        <div>
          <h2>{t.navRequests}</h2>
        </div>
        <button type="button" className="btn btn-primary" onClick={onNewRequest}>
          <MessageSquarePlus size={16} />
          {t.newRequest}
        </button>
      </div>

      <section className="panel">
        {requests.length === 0 ? (
          <div className="empty-column">{t.noRequests}</div>
        ) : (
          <div className="stack">
            {requests.map((req) => (
              <article key={req.id} className="queue-card">
                <div className="queue-card-head">
                  <span className="tag">{t.requestTypes[req.requestType]}</span>
                  <span
                    className={`tag ${
                      req.status === 'approved'
                        ? 'tag-status-approved'
                        : req.status === 'declined'
                          ? 'tag-status-rejected'
                          : 'tag-status-pending'
                    }`}
                  >
                    {req.status === 'approved'
                      ? t.requestStatusApproved
                      : req.status === 'declined'
                        ? t.requestStatusDeclined
                        : t.requestStatusPending}
                  </span>
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
