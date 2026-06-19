/**
 * Embedding map D3 chart setup and scatter render (#014, #546).
 */
(function (global) {
  'use strict';

  const st = global.__MEMENTO_EMBEDDING_MAP__;
  if (!st) {
    return;
  }

  function clusterColor(k, clusterIndex) {
    const t10 = d3.schemeTableau10;
    const s3 = d3.schemeSet3;
    if (k <= 10) {
      return t10[clusterIndex % t10.length];
    }
    const merged = t10.concat(s3);
    return merged[clusterIndex % merged.length];
  }

  function setupChart() {
    const container = d3.select('#em-scatter');
    const node = container.node();
    if (!node) {
      return;
    }
    const rect = node.getBoundingClientRect();
    st.width = Math.max(320, rect.width || node.clientWidth || 640);
    st.height = Math.max(360, rect.height || node.clientHeight || 480);

    container.selectAll('svg').remove();
    st.svg = container
      .append('svg')
      .attr('width', st.width)
      .attr('height', st.height)
      .attr('class', 'em-svg');

    const zoom = d3
      .zoom()
      .scaleExtent([0.3, 10])
      .on('zoom', function (event) {
        st.zoomG.attr('transform', event.transform);
      });

    st.svg.call(zoom);
    st.svg.on('pointerdown', function (event) {
      st.lastScatterPointer = { x: event.clientX, y: event.clientY };
    });

    st.zoomG = st.svg.append('g').attr('class', 'em-zoom-root');

    st.plotG = st.zoomG
      .append('g')
      .attr('class', 'em-plot')
      .attr('transform', 'translate(' + st.margin.left + ',' + st.margin.top + ')');

    const innerW = st.width - st.margin.left - st.margin.right;
    const innerH = st.height - st.margin.top - st.margin.bottom;

    st.plotG
      .append('rect')
      .attr('class', 'em-plot-bg')
      .attr('width', innerW)
      .attr('height', innerH)
      .attr('fill', 'transparent')
      .on('click', function (event) {
        if (st.lastScatterPointer) {
          const dx = event.clientX - st.lastScatterPointer.x;
          const dy = event.clientY - st.lastScatterPointer.y;
          if (dx * dx + dy * dy > 36) {
            return;
          }
        }
        st.closeSidePanel();
      });

    st.xScale = d3.scaleLinear().range([0, innerW]);
    st.yScale = d3.scaleLinear().range([innerH, 0]);
  }

  function renderScatter(data) {
    if (!st.svg || !st.plotG || !data.points || data.points.length === 0) {
      return;
    }

    const k = data.meta && typeof data.meta.k === 'number' ? data.meta.k : 6;
    st.currentPoints = data.points;

    const xs = data.points.map(function (p) {
      return p.x;
    });
    const ys = data.points.map(function (p) {
      return p.y;
    });
    const xPad = (d3.max(xs) - d3.min(xs)) * 0.08 || 0.5;
    const yPad = (d3.max(ys) - d3.min(ys)) * 0.08 || 0.5;
    st.xScale.domain([d3.min(xs) - xPad, d3.max(xs) + xPad]);
    st.yScale.domain([d3.min(ys) - yPad, d3.max(ys) + yPad]);

    const innerW = st.width - st.margin.left - st.margin.right;
    const innerH = st.height - st.margin.top - st.margin.bottom;

    st.plotG.select('.em-plot-bg').attr('width', innerW).attr('height', innerH);

    st.plotG.selectAll('g.em-axis').remove();
    const xAxis = d3.axisBottom(st.xScale).ticks(6);
    const yAxis = d3.axisLeft(st.yScale).ticks(6);
    st.plotG
      .append('g')
      .attr('class', 'em-axis')
      .attr('transform', 'translate(0,' + innerH + ')')
      .call(xAxis);
    st.plotG.append('g').attr('class', 'em-axis').call(yAxis);

    const sel = st.plotG.selectAll('circle.em-dot').data(data.points, function (d) {
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
        return st.xScale(d.x);
      })
      .attr('cy', function (d) {
        return st.yScale(d.y);
      })
      .attr('fill', function (d) {
        return clusterColor(k, d.cluster);
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('click', function (event, d) {
        event.stopPropagation();
        st.openSidePanel(d);
      })
      .on('mouseover', function (event, d) {
        st.showTooltip(event, d);
      })
      .on('mousemove', function (event) {
        if (st.tooltipEl && st.tooltipEl.style.display === 'block') {
          st.tooltipEl.style.left = event.clientX + 12 + 'px';
          st.tooltipEl.style.top = event.clientY + 12 + 'px';
        }
      })
      .on('mouseleave', function () {
        st.hideTooltip();
      });

    sel
      .attr('r', function (d) {
        return 4 + (d.importance != null ? d.importance : 0.5) * 6;
      })
      .attr('cx', function (d) {
        return st.xScale(d.x);
      })
      .attr('cy', function (d) {
        return st.yScale(d.y);
      })
      .attr('fill', function (d) {
        return clusterColor(k, d.cluster);
      });

    sel.exit().remove();
  }

  st.setupChart = setupChart;
  st.renderScatter = renderScatter;
})(typeof window !== 'undefined' ? window : globalThis);
