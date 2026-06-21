/**
 * Dashboard iframe embed mode — must run from an external script (CSP blocks inline scripts).
 */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  if (params.get('embed') === 'dashboard') {
    document.documentElement.classList.add('graph-view--embedded');
  }
})();
