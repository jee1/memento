/**
 * Embedding map chart — D3 setup (Issue 633).
 */
(function (global) {
  'use strict';

  const st = global.__MEMENTO_EMBEDDING_MAP__;
  if (!st) {
    return;
  }

  function readContainerSize(container) {
    const node = container.node();
    if (!node) {
      return null;
    }
    const rect = node.getBoundingClientRect();
    return {
      width: Math.max(320, rect.width || node.clientWidth || 640),
      height: Math.max(360, rect.height || node.clientHeight || 480),
    };
  }

  function appendPlotLayers() {
    st.zoomG = st.svg.append('g').attr('class', 'em-zoom-root');
    st.plotG = st.zoomG
      .append('g')
      .attr('class', 'em-plot')
      .attr('transform', `translate(${st.margin.left},${st.margin.top})`);
  }

  function appendBackgroundClickHandler(innerW, innerH) {
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
  }

  st.setupChart = function setupChart() {
    const container = d3.select('#em-scatter');
    const size = readContainerSize(container);
    if (!size) {
      return;
    }

    st.width = size.width;
    st.height = size.height;
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

    appendPlotLayers();

    const innerW = st.width - st.margin.left - st.margin.right;
    const innerH = st.height - st.margin.top - st.margin.bottom;
    appendBackgroundClickHandler(innerW, innerH);

    st.xScale = d3.scaleLinear().range([0, innerW]);
    st.yScale = d3.scaleLinear().range([innerH, 0]);
  };
})(typeof window !== 'undefined' ? window : globalThis);
