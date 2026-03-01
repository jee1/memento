import type { PanelContext } from '../shared/panel-context.js';
import type { ResumeSnapshotViewModel } from '../shared/resume-snapshot-view-model.js';

export type ResumePanelRenderState =
  | {
      status: 'loading';
      context: PanelContext;
    }
  | {
      status: 'empty';
      context: PanelContext;
    }
  | {
      status: 'error';
      context: PanelContext;
      message: string;
    }
  | {
      status: 'ready';
      context: PanelContext;
      viewModel: ResumeSnapshotViewModel;
    };

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderActionBar(): string {
  return [
    '<div>',
    '<button type="button" data-action="refresh">Refresh</button> ',
    '<button type="button" data-action="start">Start</button> ',
    '<button type="button" data-action="save">Save</button> ',
    '<button type="button" data-action="end">End</button>',
    '</div>',
  ].join('');
}

function renderFooter(context: PanelContext): string {
  return `<footer>project=${escapeHtml(context.project)} branch=${escapeHtml(context.branch ?? 'unknown')} process=${escapeHtml(context.process_id ?? 'unknown')}</footer>`;
}

function renderReadySections(viewModel: ResumeSnapshotViewModel): string {
  return viewModel.sections
    .map((section) => {
      const items =
        section.items.length > 0
          ? `<ul>${section.items
              .map(
                (item) =>
                  `<li><strong>${escapeHtml(item.title)}</strong><br />${escapeHtml(item.summary)}</li>`
              )
              .join('')}</ul>`
          : `<p>${escapeHtml(section.emptyMessage)}</p>`;

      return `<section><h2>${escapeHtml(section.title)}</h2>${items}</section>`;
    })
    .join('');
}

function renderBridgeScript(): string {
  return `<script>
  (() => {
    const hostApi =
      typeof acquireVsCodeApi === 'function'
        ? acquireVsCodeApi()
        : { postMessage() {} };

    const ask = (message) => globalThis.prompt?.(message) ?? '';

    document.addEventListener('click', (event) => {
      const target = event.target;

      if (!(target instanceof HTMLButtonElement)) {
        return;
      }

      const action = target.dataset.action;

      if (action === 'refresh') {
        hostApi.postMessage({ type: 'refresh' });
        return;
      }

      if (action === 'start') {
        const sessionId = ask('Session ID');
        if (sessionId) {
          hostApi.postMessage({ type: 'start', payload: { session_id: sessionId } });
        }
        return;
      }

      if (action === 'save') {
        const kind = ask('Kind (task, decision, blocker, next-step)');
        const content = ask('Content');
        if (kind && content) {
          hostApi.postMessage({ type: 'save', payload: { kind, content } });
        }
        return;
      }

      if (action === 'end') {
        const summary = ask('Summary (optional)');
        hostApi.postMessage({ type: 'end', payload: { summary: summary || undefined } });
      }
    });
  })();
  </script>`;
}

export function renderResumePanelHtml(state: ResumePanelRenderState): string {
  const header = `<h1>Memento Assistant</h1>${renderActionBar()}`;

  if (state.status === 'loading') {
    return `${header}<p>Loading continuity snapshot...</p><section><h2>Resume</h2><p>[.....]</p></section><section><h2>Recent Decisions</h2><p>[.....]</p></section>${renderFooter(state.context)}${renderBridgeScript()}`;
  }

  if (state.status === 'empty') {
    return `${header}<p>No continuity snapshot found for this project/branch.</p>${renderFooter(state.context)}${renderBridgeScript()}`;
  }

  if (state.status === 'error') {
    return `${header}<p>Could not load snapshot</p><p>${escapeHtml(state.message)}</p>${renderFooter(state.context)}${renderBridgeScript()}`;
  }

  const readyHeader = `<p>project: ${escapeHtml(state.viewModel.header.project)} session: ${escapeHtml(
    state.viewModel.header.sessionId ?? 'unknown'
  )}</p>`;

  return `${header}${readyHeader}${renderReadySections(state.viewModel)}${renderFooter(state.context)}${renderBridgeScript()}`;
}
