export interface GitHubIssue {
  number: number;
  state: 'open' | 'closed';
  body?: string;
}

export interface GitHubIssueClientOptions {
  token: string;
  repository: string;
  fetchFn?: typeof fetch;
}

export class GitHubIssueClient {
  private readonly apiBase = 'https://api.github.com';
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: GitHubIssueClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async findOpenIssueByFingerprint(fingerprint: string, labels: string[]): Promise<GitHubIssue | undefined> {
    // GitHub search ANDs multiple label: tokens; requiring every configured label misses issues
    // where one label was removed. Prefer the tool-owned label for dedupe when present.
    const labelQuery = labels.includes('memento-log-monitor')
      ? 'label:memento-log-monitor'
      : labels.map(label => `label:${label}`).join(' ');
    const query = encodeURIComponent(`repo:${this.options.repository} is:issue is:open ${labelQuery} ${fingerprint}`);
    const result = await this.request<{ items: GitHubIssue[] }>(`/search/issues?q=${query}`, { method: 'GET' });

    return result.items.find(issue => issue.body?.includes(`memento-log-monitor:fingerprint=${fingerprint}`));
  }

  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    return this.request<GitHubIssue>(`/repos/${this.options.repository}/issues/${issueNumber}`, { method: 'GET' });
  }

  async createIssue(input: { title: string; body: string; labels: string[] }): Promise<GitHubIssue> {
    return this.request<GitHubIssue>(`/repos/${this.options.repository}/issues`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateIssue(issueNumber: number, input: { body: string }): Promise<GitHubIssue> {
    return this.request<GitHubIssue>(`/repos/${this.options.repository}/issues/${issueNumber}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetchFn(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.options.token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...init.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API failed: ${response.status} ${text}`);
    }

    return response.json() as Promise<T>;
  }
}

