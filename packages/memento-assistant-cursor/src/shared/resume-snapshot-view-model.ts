import type { ResumeSnapshot } from 'memento-assistant';

export interface ResumeSectionViewModel {
  key: 'resume' | 'recent-decisions' | 'open-threads' | 'next-actions';
  title: string;
  items: ResumeSnapshot['resume'];
  emptyMessage: string;
}

export interface ResumeSnapshotViewModel {
  header: {
    project: string;
    sessionId?: string;
  };
  sections: ResumeSectionViewModel[];
}

export function toResumeSnapshotViewModel(snapshot: ResumeSnapshot): ResumeSnapshotViewModel {
  return {
    header: {
      project: snapshot.project,
      sessionId: snapshot.sessionId,
    },
    sections: [
      {
        key: 'resume',
        title: 'Resume',
        items: snapshot.resume,
        emptyMessage: 'No resume items.',
      },
      {
        key: 'recent-decisions',
        title: 'Recent Decisions',
        items: snapshot.recentDecisions,
        emptyMessage: 'No recent decisions.',
      },
      {
        key: 'open-threads',
        title: 'Open Threads',
        items: snapshot.openThreads,
        emptyMessage: 'No open threads.',
      },
      {
        key: 'next-actions',
        title: 'Next Actions',
        items: snapshot.nextActions,
        emptyMessage: 'No next actions.',
      },
    ],
  };
}
