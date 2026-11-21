import { Plus } from 'lucide-react';
import type { Member, TaskItem } from '../../shared/types';
import { useI18n } from '../i18n';
import { TaskRow } from './TaskRow';

interface MemberColumnProps {
  member: Member;
  tasks: TaskItem[];
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
  const { t } = useI18n();
  const isParent = currentUser.role === 'parent';

  const doneCount = tasks.filter((item) => item.status === 'approved').length;
  const mandatoryTasks = tasks.filter((item) => item.isMandatory);
  const extraTasks = tasks.filter((item) => !item.isMandatory);

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
