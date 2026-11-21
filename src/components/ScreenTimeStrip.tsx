import { Clock, Lock, Unlock } from 'lucide-react';
import type { Member, ScreenTimeProgress } from '../../shared/types';
import { useI18n } from '../i18n';

interface ScreenTimeStripProps {
  childrenMembers: Member[];
  screenTime: Record<string, ScreenTimeProgress>;
}

export function ScreenTimeStrip({ childrenMembers, screenTime }: ScreenTimeStripProps) {
  const { t, format } = useI18n();

  if (childrenMembers.length === 0) return null;

  return (
    <section className="screentime-strip" aria-label={t.screenTimeGateTitle}>
      {childrenMembers.map((child) => {
        const progress = screenTime[child.id] ?? {
          memberId: child.id,
          mandatoryTotal: 0,
          mandatoryApproved: 0,
          mandatoryPendingReview: 0,
          extraTotal: 0,
          extraApproved: 0,
          unlocked: false,
        };

        const approvedPct =
          progress.mandatoryTotal > 0
            ? Math.round((progress.mandatoryApproved / progress.mandatoryTotal) * 100)
            : 0;
        const pendingPct =
          progress.mandatoryTotal > 0
            ? Math.round((progress.mandatoryPendingReview / progress.mandatoryTotal) * 100)
            : 0;

        const isWaiting =
          !progress.unlocked &&
          progress.mandatoryTotal > 0 &&
          progress.mandatoryApproved + progress.mandatoryPendingReview === progress.mandatoryTotal;

        return (
          <article
            key={child.id}
            className={`screentime-card ${progress.unlocked ? 'unlocked' : ''}`}
          >
            <div className="screentime-top">
              <div className="screentime-who">
                <span className={`avatar-circle accent-${child.accentColor}`}>
                  {child.avatarEmoji}
                </span>
                <div>
                  <h3>{child.name}</h3>
                  <div className="screentime-sub">{t.screenTimeGateTitle}</div>
                </div>
              </div>

              {progress.unlocked ? (
                <span className="gate-pill unlocked">
                  <Unlock size={13} />
                  {t.screenTimeUnlocked}
                </span>
              ) : isWaiting ? (
                <span className="gate-pill waiting">
                  <Clock size={13} />
                  {t.screenTimeWaiting}
                </span>
              ) : (
                <span className="gate-pill locked">
                  <Lock size={13} />
                  {progress.mandatoryTotal === 0
                    ? t.noMandatoryTasks
                    : t.screenTimeLocked}
                </span>
              )}
            </div>

            <div className="progress-track" role="progressbar" aria-valuenow={approvedPct} aria-valuemin={0} aria-valuemax={100}>
              <div className="progress-fill-approved" style={{ width: `${approvedPct}%` }} />
              <div className="progress-fill-pending" style={{ width: `${pendingPct}%` }} />
            </div>

            <div className="screentime-foot">
              <span>
                {progress.mandatoryTotal > 0
                  ? format(t.mandatoryProgress, {
                      done: progress.mandatoryApproved,
                      total: progress.mandatoryTotal,
                    })
                  : t.noMandatoryTasks}
              </span>
              {progress.extraTotal > 0 && (
                <span>
                  {format(t.extraCompleted, {
                    done: progress.extraApproved,
                    total: progress.extraTotal,
                  })}
                </span>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
