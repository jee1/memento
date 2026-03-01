export interface ContinuityArtifactLink {
  kind: 'project' | 'branch' | 'commit' | 'file' | 'issue';
  value: string;
}

export interface ContinuityOriginSource {
  project?: string;
  branch?: string;
  commit?: string;
  files?: string[];
  issue?: string;
  session_id?: string;
}

export interface ResumeCard {
  title: string;
  summary: string;
  memoryIds: string[];
}

export interface ResumeSnapshot {
  project: string;
  sessionId?: string;
  resume: ResumeCard[];
  recentDecisions: ResumeCard[];
  openThreads: ResumeCard[];
  nextActions: ResumeCard[];
}
