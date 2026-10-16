/**
 * Memory Graph — D3 render (Issue 633).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_GRAPH__;
  if (!ns) {
    return;
  }

  const state = ns.state;

  function getContainerSize() {
    const container = document.getElementById('graph-container');
    return { W: container.clientWidth, H: container.clientHeight };
  }

  function createSvgRoot(W, H) {
    const { svgEl } = ns.dom;
    d3.select(svgEl).selectAll('*').remove();
    const svg = d3.select(svgEl).attr('width', W).attr('height', H);
    const g = svg.append('g');
    return { svg, g };
  }

  // One marker per SVG. userSpaceOnUse keeps the head a fixed size while stroke width follows confidence.
  function appendArrowMarker(svg) {
    svg
      .append('defs')
      .append('marker')
      .attr('id', 'memory-graph-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 10)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .attr('markerUnits', 'userSpaceOnUse')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', 'context-stroke');
  }

  function attachZoomAndClick(svg, g) {
    const { svgEl } = ns.dom;
    svg.call(
      d3
        .zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
          if (event.sourceEvent && event.sourceEvent.type === 'click') {
            ns.closePanel();
          }
        })
    );
    svg.on('click', (event) => {
      if (event.target === svgEl || event.target.tagName === 'svg') {
        ns.closePanel();
      }
    });
  }

  function createRadiusScale() {
    return d3.scaleLinear().domain([0, 1]).range([6, 22]).clamp(true);
  }

  function startSimulation(nodes, edges, W, H, rScale) {
    state.simulation = d3
      .forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id((d) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide().radius((d) => rScale(d.importance) + 4));
    return state.simulation;
  }

  function renderLinks(g, edges, palette) {
    const link = g
      .append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(edges)
      .enter()
      .append('line')
      .attr('class', 'link')
      .attr('stroke', (d) => palette.edgeColors[d.relation_type] ?? palette.edgeColors.default)
      .attr('stroke-width', (d) => Math.max(1, (d.confidence ?? 1) * 3))
      .attr('marker-end', 'url(#memory-graph-arrow)');
    state.renderedLinkSelection = link;
    return link;
  }

  function attachNodeDrag(simulation) {
    return d3
      .drag()
      .on('start', (event, d) => {
        if (!event.active) {
          simulation.alphaTarget(0.3).restart();
        }
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) {
          simulation.alphaTarget(0);
        }
        d.fx = null;
        d.fy = null;
      });
  }

  function applyNeighborFocus(focusId) {
    const api = global.__MEMENTO_NEIGHBOR_FOCUS__;
    if (!api) {
      return;
    }
    const keepIds = api.collectKeepIds(focusId, state.lastGraphEdges);
    if (state.renderedNodeSelection) {
      state.renderedNodeSelection.classed('focus-dim', (d) => !keepIds.has(d.id));
    }
    if (state.renderedLinkSelection) {
      state.renderedLinkSelection.classed('focus-dim', (d) => !api.edgeTouchesKeep(d, keepIds));
    }
  }

  function clearNeighborFocus() {
    if (state.renderedNodeSelection) {
      state.renderedNodeSelection.classed('focus-dim', false);
    }
    if (state.renderedLinkSelection) {
      state.renderedLinkSelection.classed('focus-dim', false);
    }
  }

  function attachCircleHandlers(circle) {
    const { tooltip } = ns.dom;
    circle
      .on('mouseover', (_event, d) => {
        tooltip.style.display = 'block';
        tooltip.textContent = d.label;
        applyNeighborFocus(d.id);
      })
      .on('mousemove', (event) => {
        tooltip.style.left = `${event.clientX + 12}px`;
        tooltip.style.top = `${event.clientY - 10}px`;
      })
      .on('mouseout', () => {
        tooltip.style.display = 'none';
        clearNeighborFocus();
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        ns.showDetail(d);
      });
  }

  function renderNodes(g, nodes, palette, rScale, simulation) {
    const node = g
      .append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'node')
      .call(attachNodeDrag(simulation));

    state.renderedNodeSelection = node;

    const circle = node
      .append('circle')
      .attr('r', (d) => {
        d.__graphRadius = rScale(d.importance);
        return d.__graphRadius;
      })
      .attr('fill', (d) => ns.getNodeFillColor(d.type, palette))
      .attr('stroke', (d) => ns.getNodeStrokeColor(d.type, palette));

    attachCircleHandlers(circle);

    node
      .append('text')
      .attr('dy', (d) => rScale(d.importance) + 12)
      .attr('text-anchor', 'middle')
      .text((d) => (d.label.length > 18 ? `${d.label.slice(0, 18)}…` : d.label));

    return { node, circle };
  }

  // The marker tip is the line end. Stopping at the node center hides the arrow under the circle.
  function arrowTargetPoint(source, target) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.hypot(dx, dy);
    const radius = target.__graphRadius ?? 8;
    if (!dist || dist <= radius) {
      return { x: target.x, y: target.y };
    }
    const scale = (dist - radius) / dist;
    return {
      x: source.x + dx * scale,
      y: source.y + dy * scale,
    };
  }

  function bindSimulationTick(simulation, link, node) {
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => arrowTargetPoint(d.source, d.target).x)
        .attr('y2', (d) => arrowTargetPoint(d.source, d.target).y);
      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });
  }

  ns.renderGraph = function renderGraph(nodes, edges) {
    const { W, H } = getContainerSize();
    const palette = ns.getGraphPalette();
    const { svg, g } = createSvgRoot(W, H);
    appendArrowMarker(svg);
    attachZoomAndClick(svg, g);

    const rScale = createRadiusScale();
    const simulation = startSimulation(nodes, edges, W, H, rScale);
    const link = renderLinks(g, edges, palette);
    const { node } = renderNodes(g, nodes, palette, rScale, simulation);

    ns.applySearchHighlight();
    bindSimulationTick(simulation, link, node);
  };
})(typeof window !== 'undefined' ? window : globalThis);
