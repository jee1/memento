/**
 * Embedding Map — UMAP 2D scatter (014-embedding-map-dashboard)
 * D3 v7 + mementoAdminFetch
 */
(function (global) {
  'use strict';

  var didSetup = false;
  var firstAutoLoadDone = false;
  var svg = null;
  var zoomG = null;
  var plotG = null;
  var xScale = null;
  var yScale = null;
  var width = 0;
  var height = 0;
  var margin = { top: 24, right: 24, bottom: 40, left: 48 };
  var tooltipEl = null;
  var currentPoints = [];
  var lastMeta = { k: 6, total: 0 };
  /** zoom 팬 후 의도치 않은 배경 click으로 패널이 닫히지 않도록 pointerdown 위치 보관 */
  var lastScatterPointer = null;

  function escapeHtml(str) {
    if (str == null) {
      return '';
    }
    var s = String(str);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function readParams() {
    var prov = document.getElementById('em-provider');
    var lim = document.getElementById('em-limit');
    var kEl = document.getElementById('em-k');
    return {
      provider: prov ? prov.value : 'minilm',
      limit: lim ? parseInt(lim.value, 10) || 300 : 300,
      k: kEl ? parseInt(kEl.value, 10) || 6 : 6,
    };
  }

  function clusterColor(k, clusterIndex) {
    var t10 = d3.schemeTableau10;
    var s3 = d3.schemeSet3;
    if (k <= 10) {
      return t10[clusterIndex % t10.length];
    }
    var merged = t10.concat(s3);
    return merged[clusterIndex % merged.length];
  }

  function ensureTooltip() {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'em-tooltip';
      tooltipEl.style.cssText =
        'position:fixed;z-index:9999;padding:6px 10px;background:rgba(0,0,0,0.85);color:#fff;font-size:12px;border-radius:4px;pointer-events:none;max-width:320px;display:none;';
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }

  function showTooltip(event, point) {
    var el = ensureTooltip();
    var preview = point.content.length > 80 ? point.content.slice(0, 80) + '…' : point.content;
    el.innerHTML = escapeHtml(preview) + '<br><span style="opacity:0.85">' + escapeHtml(point.type) + '</span>';
    el.style.display = 'block';
    el.style.left = event.clientX + 12 + 'px';
    el.style.top = event.clientY + 12 + 'px';
  }

  function hideTooltip() {
    if (tooltipEl) {
      tooltipEl.style.display = 'none';
    }
  }

  function closeSidePanel() {
    var panel = document.getElementById('em-side-panel');
    if (panel) {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
    }
  }

  function openSidePanel(point) {
    var panel = document.getElementById('em-side-panel');
    if (!panel) {
      return;
    }
    var tags = Array.isArray(point.tags) ? point.tags.join(', ') : '';
    var imp = typeof point.importance === 'number' ? point.importance.toFixed(2) : String(point.importance);
    panel.innerHTML =
      '<div class="em-panel-header">' +
      '<h3>Memory</h3>' +
      '<button type="button" id="em-panel-close" aria-label="Close">×</button>' +
      '</div>' +
      '<div class="em-panel-body">' +
      '<p><strong>Type:</strong> ' +
      escapeHtml(point.type) +
      '</p>' +
      '<p><strong>Importance:</strong> ' +
      escapeHtml(imp) +
      '</p>' +
      '<p><strong>Created:</strong> ' +
      escapeHtml(point.created_at) +
      '</p>' +
      '<p><strong>Tags:</strong> ' +
      escapeHtml(tags) +
      '</p>' +
      '<hr><pre class="em-panel-content">' +
      escapeHtml(point.content) +
      '</pre></div>';
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    var closeBtn = document.getElementById('em-panel-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeSidePanel();
      });
    }
  }

  function setupChart() {
    var container = d3.select('#em-scatter');
    var node = container.node();
    if (!node) {
      return;
    }
    var rect = node.getBoundingClientRect();
    width = Math.max(320, rect.width || node.clientWidth || 640);
    height = Math.max(360, rect.height || node.clientHeight || 480);

    container.selectAll('svg').remove();
    svg = container
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('class', 'em-svg');

    var zoom = d3
      .zoom()
      .scaleExtent([0.3, 10])
      .on('zoom', function (event) {
        zoomG.attr('transform', event.transform);
      });

    svg.call(zoom);
    svg.on('pointerdown', function (event) {
      lastScatterPointer = { x: event.clientX, y: event.clientY };
    });

    zoomG = svg.append('g').attr('class', 'em-zoom-root');

    plotG = zoomG.append('g').attr('class', 'em-plot').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

    var innerW = width - margin.left - margin.right;
    var innerH = height - margin.top - margin.bottom;

    plotG
      .append('rect')
      .attr('class', 'em-plot-bg')
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .on('click', function (event) {
        if (lastScatterPointer) {
          var dx = event.clientX - lastScatterPointer.x;
          var dy = event.clientY - lastScatterPointer.y;
          if (dx * dx + dy * dy > 36) {
            return;
          }
        }
        closeSidePanel();
      });

    xScale = d3.scaleLinear().range([0, innerW]);
    yScale = d3.scaleLinear().range([innerH, 0]);
  }

  function renderScatter(data) {
    if (!svg || !plotG || !data.points || data.points.length === 0) {
      return;
    }

    var k = data.meta && typeof data.meta.k === 'number' ? data.meta.k : 6;
    currentPoints = data.points;

    var xs = data.points.map(function (p) {
      return p.x;
    });
    var ys = data.points.map(function (p) {
      return p.y;
    });
    var xPad = (d3.max(xs) - d3.min(xs)) * 0.08 || 0.5;
    var yPad = (d3.max(ys) - d3.min(ys)) * 0.08 || 0.5;
    xScale.domain([d3.min(xs) - xPad, d3.max(xs) + xPad]);
    yScale.domain([d3.min(ys) - yPad, d3.max(ys) + yPad]);

    var innerW = width - margin.left - margin.right;
    var innerH = height - margin.top - margin.bottom;

    plotG.select('.em-plot-bg').attr('width', innerW).attr('height', innerH);

    plotG.selectAll('g.em-axis').remove();
    var xAxis = d3.axisBottom(xScale).ticks(6);
    var yAxis = d3.axisLeft(yScale).ticks(6);
    plotG
      .append('g')
      .attr('class', 'em-axis')
      .attr('transform', 'translate(0,' + innerH + ')')
      .call(xAxis);
    plotG.append('g').attr('class', 'em-axis').call(yAxis);

    var sel = plotG.selectAll('circle.em-dot').data(data.points, function (d) {
      return d.id;
    });

    sel
      .enter()
      .append('circle')
      .attr('class', 'em-dot')
      .attr('r', function (d) {
        return 4 + (d.importance != null ? d.importance : 0.5) * 6;
      })
      .attr('cx', function (d) {
        return xScale(d.x);
      })
      .attr('cy', function (d) {
        return yScale(d.y);
      })
      .attr('fill', function (d) {
        return clusterColor(k, d.cluster);
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('click', function (event, d) {
        event.stopPropagation();
        openSidePanel(d);
      })
      .on('mouseover', function (event, d) {
        showTooltip(event, d);
      })
      .on('mousemove', function (event) {
        if (tooltipEl && tooltipEl.style.display === 'block') {
          tooltipEl.style.left = event.clientX + 12 + 'px';
          tooltipEl.style.top = event.clientY + 12 + 'px';
        }
      })
      .on('mouseleave', function () {
        hideTooltip();
      });

    sel
      .attr('r', function (d) {
        return 4 + (d.importance != null ? d.importance : 0.5) * 6;
      })
      .attr('cx', function (d) {
        return xScale(d.x);
      })
      .attr('cy', function (d) {
        return yScale(d.y);
      })
      .attr('fill', function (d) {
        return clusterColor(k, d.cluster);
      });

    sel.exit().remove();
  }

  function setLoading(on) {
    var el = document.getElementById('em-loading');
    if (el) {
      el.classList.toggle('hidden', !on);
    }
  }

  function setError(msg, showRetry) {
    var el = document.getElementById('em-error');
    if (!el) {
      return;
    }
    if (!msg) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    var html = '<p>' + escapeHtml(msg) + '</p>';
    if (showRetry) {
      html += '<button type="button" id="em-retry-btn" class="em-retry-btn">Retry</button>';
    }
    el.innerHTML = html;
    var retry = document.getElementById('em-retry-btn');
    if (retry) {
      retry.addEventListener('click', function () {
        loadEmbeddingMap(readParams());
      });
    }
  }

  function updateCacheInfo(meta) {
    var el = document.getElementById('em-cache-info');
    if (!el || !meta) {
      return;
    }
    if (meta.cached && meta.computed_at) {
      var ms = Date.now() - new Date(meta.computed_at).getTime();
      var min = Math.max(0, Math.round(ms / 60000));
      el.textContent = min + '분 전 캐시';
    } else {
      el.textContent = '';
    }
  }

  function loadEmbeddingMap(params) {
    if (!global.mementoAdminFetch) {
      setError('mementoAdminFetch를 사용할 수 없습니다. memento-admin-fetch.js를 확인하세요.', true);
      return;
    }
    setError('');
    setLoading(true);
    var q =
      '?provider=' +
      encodeURIComponent(params.provider) +
      '&limit=' +
      encodeURIComponent(String(params.limit)) +
      '&k=' +
      encodeURIComponent(String(params.k));

    global
      .mementoAdminFetch('/admin/embedding-map' + q)
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, status: res.status, body: body };
        });
      })
      .then(function (r) {
        setLoading(false);
        if (!r.ok) {
          var msg =
            (r.body && (r.body.message || r.body.error)) ||
            '요청 실패 (' + r.status + ')';
          setError(msg, r.status === 0 || r.status >= 500);
          return;
        }
        lastMeta = r.body.meta || lastMeta;
        updateCacheInfo(r.body.meta);
        renderScatter(r.body);
      })
      .catch(function () {
        setLoading(false);
        setError('네트워크 오류로 데이터를 불러오지 못했습니다.', true);
      });
  }

  function initEmbeddingMap() {
    if (!didSetup) {
      didSetup = true;
      setupChart();
      var loadBtn = document.getElementById('em-load-btn');
      if (loadBtn) {
        loadBtn.addEventListener('click', function () {
          loadEmbeddingMap(readParams());
        });
      }
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          closeSidePanel();
        }
      });
      window.addEventListener('resize', function () {
        var tab = document.getElementById('tab-embedding-map');
        if (tab && tab.classList.contains('active')) {
          setupChart();
          if (currentPoints.length) {
            renderScatter({ points: currentPoints, meta: lastMeta });
          }
        }
      });
    } else {
      setupChart();
      if (currentPoints.length) {
        renderScatter({ points: currentPoints, meta: lastMeta });
      }
    }

    if (!firstAutoLoadDone) {
      firstAutoLoadDone = true;
      loadEmbeddingMap(readParams());
    }
  }

  global.initEmbeddingMap = initEmbeddingMap;
})(typeof window !== 'undefined' ? window : globalThis);
