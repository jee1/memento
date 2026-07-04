/**
 * Embedding map chart — scatter render (Issue 633).
 */
(function (global) {
  'use strict';

  const st = global.__MEMENTO_EMBEDDING_MAP__;
  if (!st) {
    return;
  }

  function computeDomains(points) {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xPad = (d3.max(xs) - d3.min(xs)) * 0.08 || 0.5;
    const yPad = (d3.max(ys) - d3.min(ys)) * 0.08 || 0.5;
    return {
      x: [d3.min(xs) - xPad, d3.max(xs) + xPad],
      y: [d3.min(ys) - yPad, d3.max(ys) + yPad],
    };
  }

  function renderAxes(innerW, innerH) {
    st.plotG.selectAll('g.em-axis').remove();
    const xAxis = d3.axisBottom(st.xScale).ticks(6);
    const yAxis = d3.axisLeft(st.yScale).ticks(6);
    st.plotG
      .append('g')
      .attr('class', 'em-axis')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis);
    st.plotG.append('g').attr('class', 'em-axis').call(yAxis);
  }

  function dotRadius(d) {
    return 4 + (d.importance != null ? d.importance : 0.5) * 6;
  }

  function dotPosition(d) {
    return { cx: st.xScale(d.x), cy: st.yScale(d.y) };
  }

  function attachDotHandlers(circle) {
    circle
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
          st.tooltipEl.style.left = `${event.clientX + 12}px`;
          st.tooltipEl.style.top = `${event.clientY + 12}px`;
        }
      })
      .on('mouseleave', function () {
        st.hideTooltip();
      });
  }

  function updateDotAttributes(sel, k) {
    sel
      .attr('r', dotRadius)
      .attr('cx', (d) => dotPosition(d).cx)
      .attr('cy', (d) => dotPosition(d).cy)
      .attr('fill', (d) => st.clusterColor(k, d.cluster));
  }

  st.renderScatter = function renderScatter(data) {
    if (!st.svg || !st.plotG || !data.points || data.points.length === 0) {
      return;
    }

    const k = data.meta && typeof data.meta.k === 'number' ? data.meta.k : 6;
    st.currentPoints = data.points;

    const domains = computeDomains(data.points);
    st.xScale.domain(domains.x);
    st.yScale.domain(domains.y);

    const innerW = st.width - st.margin.left - st.margin.right;
    const innerH = st.height - st.margin.top - st.margin.bottom;
    st.plotG.select('.em-plot-bg').attr('width', innerW).attr('height', innerH);
    renderAxes(innerW, innerH);

    const sel = st.plotG.selectAll('circle.em-dot').data(data.points, (d) => d.id);
    const entered = sel
      .enter()
      .append('circle')
      .attr('class', 'em-dot')
      .attr('stroke', '#fff')
      .attr('stroke-width', 1);

    attachDotHandlers(entered);
    updateDotAttributes(sel.merge(entered), k);
    sel.exit().remove();
  };
})(typeof window !== 'undefined' ? window : globalThis);
