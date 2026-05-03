import { describe, expect, it, vi } from 'vitest';
import { GitHubIssueClient } from '../github-client.js';

describe('GitHubIssueClient', () => {
  it('searches open issues by fingerprint marker', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ number: 7, state: 'open', body: '<!-- memento-log-monitor:fingerprint=abc123 -->' }] }),
    });
    const client = new GitHubIssueClient({ token: 'ghp_token', repository: 'owner/repo', fetchFn: fetchMock });

    await expect(client.findOpenIssueByFingerprint('abc123', ['memento-log-monitor'])).resolves.toEqual({
      number: 7,
      state: 'open',
      body: '<!-- memento-log-monitor:fingerprint=abc123 -->',
    });
  });

  it('dedupe search uses only memento-log-monitor label when that label is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ number: 7, state: 'open', body: '<!-- memento-log-monitor:fingerprint=abc123 -->' }] }),
    });
    const client = new GitHubIssueClient({ token: 'ghp_token', repository: 'owner/repo', fetchFn: fetchMock });

    await client.findOpenIssueByFingerprint('abc123', ['bug', 'needs-triage', 'memento-log-monitor']);

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain(encodeURIComponent('label:memento-log-monitor'));
    expect(url).not.toContain(encodeURIComponent('label:bug'));
  });

  it('throws a readable error for non-2xx responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'forbidden' });
    const client = new GitHubIssueClient({ token: 'bad', repository: 'owner/repo', fetchFn: fetchMock });

    await expect(client.getIssue(1)).rejects.toThrow('GitHub API failed: 403 forbidden');
  });
});
