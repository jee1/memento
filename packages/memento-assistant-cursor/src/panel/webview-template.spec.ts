import { describe, expect, it } from 'vitest';

import { renderResumePanelHtml } from './webview-template.js';

describe('renderResumePanelHtml', () => {
  it('renders loading state with section placeholders', () => {
    const html = renderResumePanelHtml({
      status: 'loading',
      context: {
        project: 'memento',
        branch: 'feature/host-adapter',
        process_id: 'cursor',
      },
    });

    expect(html).toContain('Loading continuity snapshot');
    expect(html).toContain('Resume');
    expect(html).toContain('Recent Decisions');
  });

  it('renders quick action buttons and a webview bridge script', () => {
    const html = renderResumePanelHtml({
      status: 'empty',
      context: {
        project: 'memento',
        process_id: 'cursor',
      },
    });

    expect(html).toContain('data-action="refresh"');
    expect(html).toContain('data-action="start"');
    expect(html).toContain('data-action="save"');
    expect(html).toContain('data-action="end"');
    expect(html).toContain('acquireVsCodeApi');
    expect(html).toContain('postMessage');
  });
});
