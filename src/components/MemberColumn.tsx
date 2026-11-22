import { CheckCircle2, Plus } from 'lucide-react';
import type { ExternalAccountSummary, Member, TaskItem } from '../../shared/types';
import { useI18n } from '../i18n';
import { TaskRow } from './TaskRow';

interface MemberColumnProps {
  member: Member;
  tasks: TaskItem[];
  externalAccounts: ExternalAccountSummary[];
  currentUser: Member;
  busyTaskId: string | null;
  onQuickAddForMember: (memberId: string) => void;
  onParentToggle: (task: TaskItem) => void;
  onParentApprove: (task: TaskItem, decision: 'approve' | 'approve_partial') => void;
  onParentReject: (task: TaskItem) => void;
  onParentEdit: (task: TaskItem) => void;
  onParentDelete: (task: TaskItem) => void;
  onChildReport: (task: TaskItem, mode: 'done' | 'partial') => void;
  onChildRequestChange: (task: TaskItem) => void;
}

export function MemberColumn({
  member,
  tasks,
  externalAccounts,
  currentUser,
  busyTaskId,
  onQuickAddForMember,
  onParentToggle,
  onParentApprove,
  onParentReject,
  onParentEdit,
  onParentDelete,
  onChildReport,
  onChildRequestChange,
}: MemberColumnProps) {
  const { t, format } = useI18n();
  const isParent = currentUser.role === 'parent';

  const doneCount = tasks.filter((item) => item.status === 'approved').length;
  const mandatoryTasks = tasks.filter((item) => item.isMandatory);
  const extraTasks = tasks.filter((item) => !item.isMandatory);
  const enabledAccounts = externalAccounts.filter((a) => a.enabled);

  const renderTask = (task: TaskItem) => (
    <TaskRow
      key={task.id}
      task={task}
      assignee={member}
      currentUser={currentUser}
      busy={busyTaskId === task.id}
      onParentToggle={onParentToggle}
      onParentApprove={onParentApprove}
      onParentReject={onParentReject}
      onParentEdit={onParentEdit}
      onParentDelete={onParentDelete}
      onChildReport={onChildReport}
      onChildRequestChange={onChildRequestChange}
    />
  );

  return (
    <section className="member-column" aria-label={member.name}>
      <header className="member-column-header">
        <div className="member-column-identity">
          <span className={`avatar-circle avatar-lg accent-${member.accentColor}`}>
            {member.avatarEmoji}
          </span>
          <div style={{ minWidth: 0 }}>
            <h2>{member.name}</h2>
            <div className="member-meta-line">
              {member.role === 'parent' ? t.roleParent : t.roleChild} · {doneCount}/{tasks.length}
            </div>
          </div>
        </div>

        {isParent && (
          <button
            type="button"
            className="btn btn-xs btn-secondary"
            title={t.addTask}
            aria-label={`${t.addTask}: ${member.name}`}
            onClick={() => onQuickAddForMember(member.id)}
          >
            <Plus size={14} />
          </button>
        )}
      </header>

      {enabledAccounts.length > 0 && (
        <div className="activity-strip">
          {enabledAccounts.map((acc) => {
            if (acc.provider === 'chess_com') {
              const s = acc.chessStats;
              const bestRating = s?.rapidRating ?? s?.blitzRating ?? s?.dailyRating ?? null;
              const puzzleRating = s?.tacticsCurrent ?? s?.tacticsBest ?? null;
              const parts: string[] = [];
              if (s) {
                if (s.streakDays > 0) {
                  parts.push(`🔥 ${format(t.chessStreak, { n: s.streakDays })}`);
                }
                if (s.puzzlesToday > 0) {
                  parts.push(format(t.chessTodayPuzzles, { n: s.puzzlesToday }));
                } else if (s.gamesToday > 0) {
                  parts.push(format(t.chessTodayGames, { n: s.gamesToday }));
                } else if (s.activeToday) {
                  parts.push(t.chessActiveToday);
                } else {
                  parts.push(format(t.chessTodayGames, { n: 0 }));
                }
                if (puzzleRating && !bestRating) {
                  parts.push(format(t.chessPuzzles, { rating: puzzleRating }));
                } else if (bestRating) {
                  parts.push(format(t.chessRating, { rating: bestRating }));
                }
              }
              return (
                <a
                  key={acc.id}
                  href={s?.profileUrl ?? `https://www.chess.com/member/${acc.externalUsername}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`activity-pill ${acc.goalMetToday ? 'goal-met' : ''} ${
                    acc.lastError && !s ? 'has-error' : ''
                  }`}
                >
                  <span>♟️</span>
                  {s ? (
                    <>
                      <span>{parts.join(' · ')}</span>
                      {acc.goalMetToday && <CheckCircle2 size={13} />}
                    </>
                  ) : (
                    <span>Chess: {acc.externalUsername}</span>
                  )}
                </a>
              );
            }

            if (acc.provider === 'duolingo') {
              const d = acc.duolingoStats;
              return (
                <a
                  key={acc.id}
                  href={`https://www.duolingo.com/profile/${encodeURIComponent(acc.externalUsername)}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`activity-pill ${acc.goalMetToday ? 'goal-met' : ''} ${
                    acc.lastError && !d ? 'has-error' : ''
                  }`}
                >
                  <span>🦉</span>
                  {d ? (
                    <>
                      <span>
                        🔥 {format(t.duoStreak, { n: d.streak })}
                        {d.xpToday > 0
                          ? ` · ${format(t.duoXpToday, { xp: d.xpToday })}`
                          : d.streakExtendedToday
                            ? ` · ${t.duoDoneToday}`
                            : ''}
                      </span>
                      {acc.goalMetToday && <CheckCircle2 size={13} />}
                    </>
                  ) : (
                    <span>Duolingo: {acc.externalUsername}</span>
                  )}
                </a>
              );
            }
            return null;
          })}
        </div>
      )}

      <div className="member-column-body">
        {tasks.length === 0 ? (
          <div className="empty-column">{t.emptyTasks}</div>
        ) : member.role === 'child' ? (
          <>
            {mandatoryTasks.length > 0 && (
              <div>
                <div className="task-section-label">{t.sectionMandatory}</div>
                <div className="task-list">{mandatoryTasks.map(renderTask)}</div>
              </div>
            )}
            {extraTasks.length > 0 && (
              <div>
                <div className="task-section-label">{t.sectionExtra}</div>
                <div className="task-list">{extraTasks.map(renderTask)}</div>
              </div>
            )}
          </>
        ) : (
          <div>
            <div className="task-section-label">{t.sectionChecklist}</div>
            <div className="task-list">{tasks.map(renderTask)}</div>
          </div>
        )}
      </div>
    </section>
  );
}
