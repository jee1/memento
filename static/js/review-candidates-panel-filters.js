/**
 * Review candidates panel — list filters and pagination (#897 AC8).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) {
    return;
  }

  const $ = ns.$;
  const state = ns.state;

  state.listFilters = state.listFilters || {
    importance_min: '',
    unused_days_min: '',
    memory_type: '',
    reason_contains: '',
  };
  state.listPage = state.listPage || 1;
  state.listPageSize = state.listPageSize || 25;
  state.lastListQueryKey = state.lastListQueryKey || '';

  function readFilterControlValues() {
    const importance = $('rc-filter-importance');
    const unusedDays = $('rc-filter-unused-days');
    const memoryType = $('rc-filter-memory-type');
    const reason = $('rc-filter-reason');
    const pageSize = $('rc-filter-page-size');
    return {
      importance_min: importance ? String(importance.value || '') : '',
      unused_days_min: unusedDays ? String(unusedDays.value || '') : '',
      memory_type: memoryType ? String(memoryType.value || '') : '',
      reason_contains: reason ? String(reason.value || '').trim() : '',
      page_size: pageSize ? String(pageSize.value || '25') : '25',
    };
  }

  function readCommittedFilterValues() {
    const filters = state.listFilters || {};
    return {
      importance_min: filters.importance_min || '',
      unused_days_min: filters.unused_days_min || '',
      memory_type: filters.memory_type || '',
      reason_contains: filters.reason_contains || '',
      page_size: String(state.listPageSize || 25),
    };
  }

  function buildListQueryKey(values) {
    return JSON.stringify({
      importance_min: values.importance_min,
      unused_days_min: values.unused_days_min,
      memory_type: values.memory_type,
      reason_contains: values.reason_contains,
      page: state.listPage,
      page_size: values.page_size,
    });
  }

  function encodeQueryValue(value) {
    return encodeURIComponent(String(value));
  }

  function buildListUrl(options) {
    const opts = options || {};
    const values = opts.values || readCommittedFilterValues();
    const parts = ['status=pending'];
    if (values.importance_min) {
      parts.push('importance_min=' + encodeQueryValue(values.importance_min));
    }
    if (values.unused_days_min) {
      parts.push('unused_days_min=' + encodeQueryValue(values.unused_days_min));
    }
    if (values.memory_type) {
      parts.push('memory_type=' + encodeQueryValue(values.memory_type));
    }
    if (values.reason_contains) {
      parts.push('reason_contains=' + encodeQueryValue(values.reason_contains));
    }
    const pageSize = values.page_size || String(state.listPageSize || 25);
    parts.push('page_size=' + encodeQueryValue(pageSize));
    parts.push('page=' + encodeQueryValue(String(state.listPage || 1)));
    return '/admin/memory/review-candidates?' + parts.join('&');
  }

  function syncPaginationControls(pagination) {
    const info = $('rc-pagination-info');
    const prev = $('rc-pagination-prev');
    const next = $('rc-pagination-next');
    if (!pagination) {
      if (info) {
        info.textContent = '';
      }
      if (prev) {
        prev.disabled = true;
      }
      if (next) {
        next.disabled = true;
      }
      return;
    }
    if (info) {
      info.textContent =
        pagination.total_count === 0
          ? '0건'
          : pagination.page +
            ' / ' +
            pagination.total_pages +
            ' 페이지 · 전체 ' +
            pagination.total_count +
            '건';
    }
    if (prev) {
      prev.disabled = !pagination.has_prev || state.actionInFlight;
    }
    if (next) {
      next.disabled = !pagination.has_next || state.actionInFlight;
    }
  }

  function resetListSelectionForQueryChange() {
    if (ns.resetBulkSelection) {
      ns.resetBulkSelection([]);
    }
    if (ns.clearRowSelection) {
      ns.clearRowSelection();
    }
    if (ns.resetPreviewPanel) {
      ns.resetPreviewPanel();
    }
  }

  function applyFilterControlsFromState() {
    const importance = $('rc-filter-importance');
    const unusedDays = $('rc-filter-unused-days');
    const memoryType = $('rc-filter-memory-type');
    const reason = $('rc-filter-reason');
    const pageSize = $('rc-filter-page-size');
    if (importance) {
      importance.value = state.listFilters.importance_min || '';
    }
    if (unusedDays) {
      unusedDays.value = state.listFilters.unused_days_min || '';
    }
    if (memoryType) {
      memoryType.value = state.listFilters.memory_type || '';
    }
    if (reason) {
      reason.value = state.listFilters.reason_contains || '';
    }
    if (pageSize) {
      pageSize.value = String(state.listPageSize || 25);
    }
  }

  function commitFilterControls(resetPage) {
    const values = readFilterControlValues();
    state.listFilters = {
      importance_min: values.importance_min,
      unused_days_min: values.unused_days_min,
      memory_type: values.memory_type,
      reason_contains: values.reason_contains,
    };
    state.listPageSize = values.page_size === '50' ? 50 : 25;
    if (resetPage) {
      state.listPage = 1;
    }
    return values;
  }

  function onFiltersApply() {
    const values = commitFilterControls(true);
    const nextKey = buildListQueryKey(values);
    if (state.lastListQueryKey && state.lastListQueryKey !== nextKey) {
      resetListSelectionForQueryChange();
    }
    state.lastListQueryKey = nextKey;
    void ns.loadList();
  }

  function onPageChange(delta) {
    state.listPage = Math.max(1, (state.listPage || 1) + delta);
    const committedKey = buildListQueryKey(readCommittedFilterValues());
    if (state.lastListQueryKey !== committedKey) {
      resetListSelectionForQueryChange();
      state.lastListQueryKey = committedKey;
      void ns.loadList();
    }
  }

  function wireReviewListFilters() {
    const form = $('rc-filter-form');
    const applyBtn = $('rc-filter-apply');
    const resetBtn = $('rc-filter-reset');
    const prev = $('rc-pagination-prev');
    const next = $('rc-pagination-next');
    const pageSize = $('rc-filter-page-size');
    if (form && form.dataset.rcWired !== '1') {
      form.dataset.rcWired = '1';
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        onFiltersApply();
      });
    }
    if (applyBtn && applyBtn.dataset.rcWired !== '1') {
      applyBtn.dataset.rcWired = '1';
      applyBtn.addEventListener('click', function () {
        onFiltersApply();
      });
    }
    if (resetBtn && resetBtn.dataset.rcWired !== '1') {
      resetBtn.dataset.rcWired = '1';
      resetBtn.addEventListener('click', function () {
        state.listFilters = {
          importance_min: '',
          unused_days_min: '',
          memory_type: '',
          reason_contains: '',
        };
        state.listPage = 1;
        state.listPageSize = 25;
        applyFilterControlsFromState();
        onFiltersApply();
      });
    }
    if (prev && prev.dataset.rcWired !== '1') {
      prev.dataset.rcWired = '1';
      prev.addEventListener('click', function () {
        onPageChange(-1);
      });
    }
    if (next && next.dataset.rcWired !== '1') {
      next.dataset.rcWired = '1';
      next.addEventListener('click', function () {
        onPageChange(1);
      });
    }
    if (pageSize && pageSize.dataset.rcWired !== '1') {
      pageSize.dataset.rcWired = '1';
      pageSize.addEventListener('change', function () {
        onFiltersApply();
      });
    }
    applyFilterControlsFromState();
  }

  ns.buildListUrl = buildListUrl;
  ns.buildListQueryKey = buildListQueryKey;
  ns.readFilterControlValues = readFilterControlValues;
  ns.readCommittedFilterValues = readCommittedFilterValues;
  ns.commitFilterControls = commitFilterControls;
  ns.syncPaginationControls = syncPaginationControls;
  ns.resetListSelectionForQueryChange = resetListSelectionForQueryChange;
  ns.wireReviewListFilters = wireReviewListFilters;
})(typeof window !== 'undefined' ? window : globalThis);
