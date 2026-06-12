/**
 * Agent transcript file, dry-run, and explicit import workflow (#460).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_AGENT_SESSIONS_PANEL__;
  if (!ns) {
    return;
  }

  function transcriptValue() {
    const input = ns.$('as-transcript-jsonl');
    return input ? input.value : '';
  }

  function invalidateDryRun() {
    ns.state.validatedTranscript = null;
    const importButton = ns.$('as-transcript-import');
    if (importButton) {
      importButton.disabled = true;
    }
  }

  function renderImportResult(result) {
    const container = ns.$('as-import-results');
    if (!container) {
      return;
    }
    ns.clearNode(container);
    const summary = document.createElement('p');
    summary.className = result.valid === false ? 'as-import-summary as-import-summary--error' : 'as-import-summary';
    summary.textContent =
      (result.dry_run ? 'Dry-run' : 'Import') +
      ': ' +
      (result.valid === false ? 'invalid' : 'valid') +
      ' · accepted ' +
      String(result.accepted_count || 0) +
      ' · duplicate ' +
      String(result.duplicate_count || 0) +
      ' · redacted ' +
      String(result.redacted_count || 0) +
      ' · dropped ' +
      String(result.dropped_count || 0);
    container.appendChild(summary);
    const errors = Array.isArray(result.errors) ? result.errors : [];
    errors.forEach(function (error) {
      ns.appendText(
        container,
        'p',
        'Line ' + String(error.line || '?') + ': ' + String(error.code || error.message || 'invalid'),
        'as-import-error',
      );
    });
  }

  async function submitTranscript(dryRun) {
    const jsonl = transcriptValue();
    if (!jsonl.trim()) {
      throw new Error('Choose a JSONL file or enter transcript text.');
    }
    if (!dryRun && ns.state.validatedTranscript !== jsonl) {
      throw new Error('Run a successful dry-run after the last transcript change.');
    }
    const requestBody = dryRun
      ? { jsonl: jsonl, dry_run: true }
      : { jsonl: jsonl, dry_run: false };
    const result = await ns.agentFetch('/api/v1/agent/transcripts/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    renderImportResult(result);
    if (dryRun && result.valid !== false && (!result.errors || !result.errors.length)) {
      ns.state.validatedTranscript = jsonl;
      const importButton = ns.$('as-transcript-import');
      if (importButton) {
        importButton.disabled = false;
      }
    } else {
      invalidateDryRun();
    }
    if (!dryRun) {
      invalidateDryRun();
      await ns.loadSessions(false);
    }
  }

  function readTranscriptFile(file) {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', function () {
      const input = ns.$('as-transcript-jsonl');
      if (input) {
        input.value = typeof reader.result === 'string' ? reader.result : '';
        invalidateDryRun();
      }
    });
    reader.addEventListener('error', function () {
      ns.showError(new Error('Could not read the selected JSONL file.'));
    });
    reader.readAsText(file);
  }

  ns.invalidateTranscriptDryRun = invalidateDryRun;
  ns.submitTranscript = submitTranscript;
  ns.readTranscriptFile = readTranscriptFile;
})(typeof window !== 'undefined' ? window : globalThis);
