import * as d3 from 'd3';
import './scatterplot3d.css';
import { subscribe, getActiveRowIndex, getEffectiveSelection } from '../state/appState.js';

/* ------------------------------------------------------------------ */
/*  Per-instance 3-D brush filter state                                */
/* ------------------------------------------------------------------ */

// axisFilters: { xKey?: {min,max}, yKey?: {min,max}, zKey?: {min,max} }
// hiddenFilters: Set of axis keys (hidden while zoomed, like PCP)
const _scatter3dFilterState = new Map();

function getFilterState(containerSelector) {
    if (!_scatter3dFilterState.has(containerSelector)) {
        _scatter3dFilterState.set(containerSelector, {
            axisFilters: {},
            hiddenFilters: new Set(),
            hadActiveBrushFilters: false,
        });
    }
    return _scatter3dFilterState.get(containerSelector);
}

function scatter3dEnterZoomAll() {
    _scatter3dFilterState.forEach((state) => {
        Object.keys(state.axisFilters).forEach(k => state.hiddenFilters.add(k));
    });
}

function scatter3dExitZoomAll() {
    _scatter3dFilterState.forEach((state) => {
        state.hiddenFilters.clear();
    });
}

function scatter3dClearFiltersAll() {
    _scatter3dFilterState.forEach((state) => {
        state.axisFilters = {};
        state.hiddenFilters.clear();
        state.hadActiveBrushFilters = false;
    });
}

subscribe('zoom-enter',    scatter3dEnterZoomAll);
subscribe('zoom-exit',     scatter3dExitZoomAll);
subscribe('filters-clear', scatter3dClearFiltersAll);

/* ------------------------------------------------------------------ */
/*  Global hover highlight (linked across all charts)                  */
/* ------------------------------------------------------------------ */

function applyScatter3dHighlight(rowIndex) {
    d3.selectAll('.scatter3d-point[data-row-index]')
        .classed('is-linked-highlight', function () { return rowIndex !== null && Number(this.dataset.rowIndex) === rowIndex; })
        .classed('is-linked-dim',       function () { return rowIndex !== null && Number(this.dataset.rowIndex) !== rowIndex; })
        .attr('r', function () {
            if (rowIndex === null) return 4;
            return Number(this.dataset.rowIndex) === rowIndex ? 7 : 3;
        });

    d3.selectAll('.scatter3d-label[data-row-index]')
        .classed('is-linked-highlight', function () { return rowIndex !== null && Number(this.dataset.rowIndex) === rowIndex; })
        .classed('is-linked-dim',       function () { return rowIndex !== null && Number(this.dataset.rowIndex) !== rowIndex; });
}

subscribe('hover-change', applyScatter3dHighlight);

/* ------------------------------------------------------------------ */
/*  Instance map (one entry per container that currently has a 3D      */
/*  scatter rendered) so the pub-sub system can push selection state.  */
/* ------------------------------------------------------------------ */

const _scatter3dInstances = new Map();

export function setScatter3dSelection(rowIndexSet) {
    _scatter3dInstances.forEach((setSelection) => setSelection(rowIndexSet));
}

subscribe('selection-change', setScatter3dSelection);

/* ------------------------------------------------------------------ */
/*  3D projection helpers                                              */
/* ------------------------------------------------------------------ */

function project(x, y, z, rotX, rotZ, centerX, centerY, scale) {
    const radX = rotX * Math.PI / 180;
    const radZ = rotZ * Math.PI / 180;

    // Rotate around Z (horizontal)
    const x1 = x * Math.cos(radZ) - y * Math.sin(radZ);
    const y1 = x * Math.sin(radZ) + y * Math.cos(radZ);
    const z1 = z;

    // Rotate around X (vertical tilt)
    const x2 = x1;
    const y2 = y1 * Math.cos(radX) - z1 * Math.sin(radX);
    const z2 = y1 * Math.sin(radX) + z1 * Math.cos(radX);

    return {
        x: centerX + x2 * scale,
        y: centerY - z2 * scale,
        depth: y2,
    };
}

/* ------------------------------------------------------------------ */
/*  Pareto front + dominated cloud helpers                             */
/* ------------------------------------------------------------------ */

/** Returns the subset of points that are non-dominated (assuming minimisation on xVal/yVal/zVal). */
function computeParetoFront3d(points) {
    return points.filter(p =>
        !points.some(q =>
            q !== p &&
            q.xVal <= p.xVal && q.yVal <= p.yVal && q.zVal <= p.zVal &&
            (q.xVal < p.xVal  || q.yVal < p.yVal  || q.zVal < p.zVal)
        )
    );
}

/**
 * Generates `count` dominated pseudo-points by perturbing each Pareto-front
 * point in the positive direction (worse objectives).  Uses a deterministic
 * seeded PRNG so the cloud is stable across re-renders for the same data.
 */
function generateDominatedCloud(paretoFront, xDomain, yDomain, zDomain, count = 280) {
    if (paretoFront.length === 0) return [];

    const xRange = (xDomain[1] - xDomain[0]) || 1;
    const yRange = (yDomain[1] - yDomain[0]) || 1;
    const zRange = (zDomain[1] - zDomain[0]) || 1;

    // Seeded LCG – deterministic for the same Pareto front
    let seed = paretoFront.reduce((s, p) => (s + p.xVal * 7 + p.yVal * 13 + p.zVal * 17) | 0, 0);
    const rand = () => {
        seed = (seed * 1664525 + 1013904223) | 0;
        return (seed >>> 0) / 0xFFFFFFFF;
    };

    const result = [];
    const perPoint = Math.ceil(count / paretoFront.length);

    for (const p of paretoFront) {
        for (let i = 0; i < perPoint && result.length < count; i++) {
            // All offsets ≥ 0 → generated point is always dominated by p
            const dx = rand() * xRange * 0.4;
            const dy = rand() * yRange * 0.4;
            const dz = rand() * zRange * 0.4;
            result.push({ xVal: p.xVal - dx, yVal: p.yVal - dy, zVal: p.zVal - dz });
        }
    }
    return result;
}

/* ------------------------------------------------------------------ */
/*  Main render function                                               */
/* ------------------------------------------------------------------ */

export function renderScatterplot3d(containerSelector, data, xKey, yKey, zKey, options = {}) {
    const {
        onHoverStart       = () => {},
        onHoverEnd         = () => {},
        onSelectionChange  = () => {},
        onShiftClick       = () => {},
        onBrushFilterChange = () => {},
        disableBrush       = false,
        animate            = false,
        showLabels         = false,
        showSurface        = false,
        showDominated      = false,
        showIdealPoint     = false,
    } = options;

    // Convenience re-render closure (used by brush callbacks)
    const rerender = (anim) =>
        renderScatterplot3d(containerSelector, data, xKey, yKey, zKey, { ...options, animate: anim });

    const filterState = getFilterState(containerSelector);

    const container     = d3.select(containerSelector);
    const containerNode = container.node();
    if (!containerNode) return;

    /* ---- rotation state (persisted on DOM between re-renders) ---- */
    let rotationX = Number(containerNode.dataset.rot3dX ?? -20);
    let rotationZ = Number(containerNode.dataset.rot3dZ ?? 45);

    /* ---- previous domain state (for animated transitions) ---- */
    const prevXMin = Number(containerNode.dataset.prev3dXMin);
    const prevXMax = Number(containerNode.dataset.prev3dXMax);
    const prevYMin = Number(containerNode.dataset.prev3dYMin);
    const prevYMax = Number(containerNode.dataset.prev3dYMax);
    const prevZMin = Number(containerNode.dataset.prev3dZMin);
    const prevZMax = Number(containerNode.dataset.prev3dZMax);
    const hasPrevDomain = [prevXMin, prevXMax, prevYMin, prevYMax, prevZMin, prevZMax].every(Number.isFinite);

    container.selectAll('*').remove();

    /* ---- tooltip (shared singleton) ---- */
    const tooltip = d3.select('body')
        .selectAll('.scatter-tooltip')
        .data([null])
        .join('div')
        .attr('class', 'scatter-tooltip');

    /* ---- sizing ---- */
    const containerWidth  = Math.max(400, containerNode.clientWidth  || 0);
    const containerHeight = Math.max(300, containerNode.clientHeight || 0);
    const centerX = containerWidth  / 2;
    const centerY = containerHeight / 2;
    const plotSize = Math.min(containerWidth, containerHeight) - 80;
    const scale   = plotSize / 2.5;

    /* ---- data points ---- */
    const points = data
        .map((row, i) => ({
            xVal: Number(row[xKey]),
            yVal: Number(row[yKey]),
            zVal: Number(row[zKey]),
            rawX: row[xKey],
            rawY: row[yKey],
            rawZ: row[zKey],
            rowIndex: row.__rowIndex ?? i,
        }))
        .filter(p => Number.isFinite(p.xVal) && Number.isFinite(p.yVal) && Number.isFinite(p.zVal));

    if (points.length === 0) {
        container.append('p').text('No numeric data for selected axes.');
        return;
    }

    /* ---- scales (normalise to –1…1 cube) ---- */
    const ext = (key) => d3.extent(points, p => p[key]);
    const pad = (e) => (e[1] - e[0] || 1) * 0.05;

    const xExt = ext('xVal'), yExt = ext('yVal'), zExt = ext('zVal');
    const xScale = d3.scaleLinear().domain([xExt[0] - pad(xExt), xExt[1] + pad(xExt)]).range([-1, 1]);
    const yScale = d3.scaleLinear().domain([yExt[0] - pad(yExt), yExt[1] + pad(yExt)]).range([-1, 1]);
    const zScale = d3.scaleLinear().domain([zExt[0] - pad(zExt), zExt[1] + pad(zExt)]).range([-1, 1]);

    /* ---- start scales (old domains, for animated transitions) ---- */
    const startXScale = animate && hasPrevDomain
        ? d3.scaleLinear().domain([prevXMin, prevXMax]).range([-1, 1])
        : xScale;
    const startYScale = animate && hasPrevDomain
        ? d3.scaleLinear().domain([prevYMin, prevYMax]).range([-1, 1])
        : yScale;
    const startZScale = animate && hasPrevDomain
        ? d3.scaleLinear().domain([prevZMin, prevZMax]).range([-1, 1])
        : zScale;

    /* ---- persist current domains for next render ---- */
    containerNode.dataset.prev3dXMin = String(xScale.domain()[0]);
    containerNode.dataset.prev3dXMax = String(xScale.domain()[1]);
    containerNode.dataset.prev3dYMin = String(yScale.domain()[0]);
    containerNode.dataset.prev3dYMax = String(yScale.domain()[1]);
    containerNode.dataset.prev3dZMin = String(zScale.domain()[0]);
    containerNode.dataset.prev3dZMax = String(zScale.domain()[1]);

    /* ---- pre-compute dominated cloud (stable per Pareto front) ---- */
    let dominatedCloud = [];
    if (showDominated && points.length > 0) {
        const paretoFront = computeParetoFront3d(points);
        dominatedCloud = generateDominatedCloud(paretoFront, xScale.domain(), yScale.domain(), zScale.domain());
    }

    /* ---- brush filter helper ---- */
    // axisScaleMeta: the three axis definitions reused by brushes + planes
    const axisScaleMeta = [
        { key: xKey, valKey: 'xVal', scale: xScale, dir: [2,0,0], start: [-1,-1,-1], corner0: [-1,-1,-1], corner1: [-1,1,-1], corner2: [-1,1,1], corner3: [-1,-1,1], color: '#e74c3c' },
        { key: yKey, valKey: 'yVal', scale: yScale, dir: [0,2,0], start: [-1,-1,-1], corner0: [-1,-1,-1], corner1: [1,-1,-1], corner2: [1,-1,1], corner3: [-1,-1,1], color: '#27ae60' },
        { key: zKey, valKey: 'zVal', scale: zScale, dir: [0,0,2], start: [-1,-1,-1], corner0: [-1,-1,-1], corner1: [1,-1,-1], corner2: [1,1,-1], corner3: [-1,1,-1], color: '#3498db' },
    ];

    function updateFilteredPoints() {
        const activeFilters = Object.entries(filterState.axisFilters)
            .filter(([axis]) => !filterState.hiddenFilters.has(axis));
        const hasBrushFilter = activeFilters.length > 0;

        container.selectAll('.scatter3d-point[data-row-index]')
            .classed('is-brush-filtered', function () {
                if (!hasBrushFilter) return false;
                const row = data[Number(this.dataset.rowIndex)];
                if (!row) return false;
                return activeFilters.some(([axis, f]) => {
                    const val = Number(row[axis]);
                    return val < f.min || val > f.max;
                });
            });

        const hasOnlyHidden = Object.keys(filterState.axisFilters).length > 0 && !hasBrushFilter;
        if (hasOnlyHidden) return;

        const wasActive = filterState.hadActiveBrushFilters || false;
        filterState.hadActiveBrushFilters = hasBrushFilter;

        if (hasBrushFilter) {
            const passing = data
                .filter(row => activeFilters.every(([axis, f]) => {
                    const val = Number(row[axis]);
                    return val >= f.min && val <= f.max;
                }))
                .map((row, i) => row.__rowIndex ?? i);
            onBrushFilterChange(passing);
        } else if (wasActive) {
            onBrushFilterChange(null);
        }
    }

    /* ---- SVG ---- */
    const svg = container.append('svg')
        .attr('viewBox', `0 0 ${containerWidth} ${containerHeight}`)
        .attr('preserveAspectRatio', 'none')
        .style('cursor', 'grab');

    /* ============================================================= */
    /*  Internal draw – called whenever rotation changes              */
    /* ============================================================= */
    /* ---- whether this render should animate ---- */
    const shouldAnimate = animate && hasPrevDomain;
    const DUR = 420;  // ms – matches 2D scatterplot

    function drawScene(animateThis) {
        svg.selectAll('g.scene').remove();
        svg.selectAll('.scatter3d-axis-brush').remove();
        const g = svg.append('g').attr('class', 'scene');

        /* -- helper to project a normalised 3-tuple -- */
        const proj = (nx, ny, nz) => project(nx, ny, nz, rotationX, rotationZ, centerX, centerY, scale);

        /* ---- axes (drawn first, behind points) ---- */
        if (animateThis) {
            // Crossfade: old tick values fade out, new tick values fade in
            const oldAxesG = drawAxes(g, proj, xKey, yKey, zKey, startXScale, startYScale, startZScale);
            oldAxesG.transition().duration(DUR).attr('opacity', 0).remove();

            const newAxesG = drawAxes(g, proj, xKey, yKey, zKey, xScale, yScale, zScale);
            newAxesG.attr('opacity', 0).transition().duration(DUR).attr('opacity', 1);
        } else {
            drawAxes(g, proj, xKey, yKey, zKey, xScale, yScale, zScale);
        }

        /* ---- project points at START positions (old scales for animation) ---- */
        const usedXScale = animateThis ? startXScale : xScale;
        const usedYScale = animateThis ? startYScale : yScale;
        const usedZScale = animateThis ? startZScale : zScale;

        // Determine ideal bounds based on actual data
        let idealX = -Infinity, idealY = -Infinity, idealZ = -Infinity;

        const projected = points.map(p => {
            if (p.xVal > idealX) idealX = p.xVal;
            if (p.yVal > idealY) idealY = p.yVal;
            if (p.zVal > idealZ) idealZ = p.zVal;

            const nx = usedXScale(p.xVal);
            const ny = usedYScale(p.yVal);
            const nz = usedZScale(p.zVal);
            const pr = proj(nx, ny, nz);
            // Also compute end positions for animation
            const endNx = xScale(p.xVal);
            const endNy = yScale(p.yVal);
            const endNz = zScale(p.zVal);
            const endPr = proj(endNx, endNy, endNz);
            return { ...p, sx: pr.x, sy: pr.y, depth: pr.depth,
                     endSx: endPr.x, endSy: endPr.y, endDepth: endPr.depth,
                     endNx, endNy, endNz };
        });
        projected.sort((a, b) => a.depth - b.depth);  // painter's order

        /* ---- dominated cloud (behind surface and real points) ---- */
        if (showDominated && dominatedCloud.length > 0) {
            const domG = g.append('g').attr('class', 'scatter3d-dominated-group');
            const projectedDom = dominatedCloud.map(p => {
                const pr = proj(xScale(p.xVal), yScale(p.yVal), zScale(p.zVal));
                return { sx: pr.x, sy: pr.y, depth: pr.depth };
            });
            projectedDom.sort((a, b) => a.depth - b.depth);
            domG.selectAll('.scatter3d-dominated-point')
                .data(projectedDom)
                .enter()
                .append('circle')
                .attr('class', 'scatter3d-dominated-point')
                .attr('cx', d => d.sx)
                .attr('cy', d => d.sy)
                .attr('r', 2)
                .attr('fill', '#8a9ab0')
                .attr('opacity', 0.2);
        }

        /* ---- Delaunay surface (between axes and points) ---- */
        if (showSurface) {
            const surfaceG = drawDelaunaySurface(g, projected);
            if (animateThis) {
                surfaceG.attr('opacity', 0).transition().duration(DUR).attr('opacity', 1);
            }
        }

        /* ---- labels (under the circles so circles get events) ---- */
        if (showLabels) {
            const labelSel = g.selectAll('.scatter3d-label')
                .data(projected)
                .enter()
                .append('text')
                .attr('class', 'scatter3d-label')
                .attr('data-row-index', d => d.rowIndex)
                .attr('x', d => d.sx + 6)
                .attr('y', d => d.sy - 6)
                .text(d => `op${d.rowIndex + 1}`);

            if (animateThis) {
                labelSel
                    .transition().duration(DUR)
                    .attr('x', d => d.endSx + 6)
                    .attr('y', d => d.endSy - 6);
            }
        }

        /* ---- circles ---- */
        const pointSel = g.selectAll('.scatter3d-point')
            .data(projected)
            .enter()
            .append('circle')
            .attr('class', 'scatter3d-point')
            .attr('data-row-index', d => d.rowIndex)
            .attr('cx', d => d.sx)
            .attr('cy', d => d.sy)
            .attr('r', 4)
            .attr('fill', '#34c759')
            .attr('opacity', d => {
                const t = (d.depth + 1.5) / 3;
                return 0.55 + t * 0.4;
            })
            .on('click', (event, d) => {
                if (event.shiftKey) {
                    event.stopPropagation();
                    onShiftClick(d.rowIndex);
                }
            })
            .on('mouseenter', (event, d) => {
                onHoverStart(d.rowIndex);
                tooltip
                    .classed('visible', true)
                    .html(
                        `Point: ${d.rowIndex + 1}<br>${xKey}: ${Number(d.rawX).toFixed(3)}<br>${yKey}: ${Number(d.rawY).toFixed(3)}<br>${zKey}: ${Number(d.rawZ).toFixed(3)}`,
                    )
                    .style('left', `${event.pageX + 12}px`)
                    .style('top',  `${event.pageY - 36}px`);
            })
            .on('mousemove', (event) => {
                tooltip
                    .style('left', `${event.pageX + 12}px`)
                    .style('top',  `${event.pageY - 36}px`);
            })
            .on('mouseleave', () => {
                onHoverEnd();
                tooltip.classed('visible', false);
            });

        /* ---- animate circles to end positions ---- */
        if (animateThis) {
            pointSel
                .transition().duration(DUR)
                .attr('cx', d => d.endSx)
                .attr('cy', d => d.endSy)
                .attr('opacity', d => {
                    const t = (d.endDepth + 1.5) / 3;
                    return 0.55 + t * 0.4;
                });
        }

        /* ---- hint text ---- */
        g.append('text')
            .attr('class', 'scatter3d-hint')
            .attr('x', containerWidth - 10)
            .attr('y', containerHeight - 10)
            .attr('text-anchor', 'end')
            .text('Drag to rotate · Shift+click to select · Double-click filter to remove');

        /* ---- Ideal Point ---- */
        if (showIdealPoint && Number.isFinite(idealX) && Number.isFinite(idealY) && Number.isFinite(idealZ)) {
            const usedXScale = animateThis ? startXScale : xScale;
            const usedYScale = animateThis ? startYScale : yScale;
            const usedZScale = animateThis ? startZScale : zScale;

            const idealProj = proj(usedXScale(idealX), usedYScale(idealY), usedZScale(idealZ));
            const idealEndProj = proj(xScale(idealX), yScale(idealY), zScale(idealZ));

            const idealG = g.append('g').attr('class', 'scatter3d-ideal-group');
            
            const circle = idealG.append('circle')
                .attr('cx', idealProj.x)
                .attr('cy', idealProj.y)
                .attr('r', 6)
                .attr('fill', '#eab308')
                .attr('stroke', '#ca8a04')
                .attr('stroke-width', 2);
                
            const label = idealG.append('text')
                .attr('class', 'scatter3d-ideal-label')
                .attr('x', idealProj.x + 10)
                .attr('y', idealProj.y - 10)
                .attr('font-size', '11px')
                .attr('font-weight', 'bold')
                .attr('fill', '#ca8a04')
                .text('Ideal Point');

            if (animateThis) {
                circle.transition().duration(DUR)
                    .attr('cx', idealEndProj.x)
                    .attr('cy', idealEndProj.y);
                label.transition().duration(DUR)
                    .attr('x', idealEndProj.x + 10)
                    .attr('y', idealEndProj.y - 10);
            }
        }

        /* ---- Distance to Ideal Legend ---- */
        if (showSurface) {
            const legendG = g.append('g').attr('transform', 'translate(15, 20)');
            legendG.append('text')
                .attr('class', 'scatter3d-legend-title')
                .attr('x', 0).attr('y', 0)
                .attr('font-size', '12px').attr('fill', '#6b7280').attr('font-weight', '500')
                .text('Distance to Ideal [1, 1, 1]');
            
            const defs = svg.select('defs').empty() ? svg.append('defs') : svg.select('defs');
            const gradId = 'ao-legend-grad-' + containerSelector.replace(/[^a-zA-Z0-9]/g, '');
            const grad = defs.selectAll('#' + gradId).data([null]).join('linearGradient')
                .attr('id', gradId)
                .attr('x1', '0%').attr('y1', '0%')
                .attr('x2', '100%').attr('y2', '0%');
                
            grad.selectAll('stop').data([
                { offset: '0%', color: d3.hsl(216, 0.25, 1).toString() },    // Near (aoBaseLightness = 1.0)
                { offset: '100%', color: d3.hsl(216, 0.25, 0.5).toString() } // Far (1.0 - aoLightnessRange(0.5))
            ]).join('stop')
                .attr('offset', d => d.offset)
                .attr('stop-color', d => d.color);
                
            legendG.append('rect')
                .attr('x', 0).attr('y', 8)
                .attr('width', 120).attr('height', 8)
                .attr('rx', 4).attr('ry', 4)
                .attr('fill', `url(#${gradId})`)
                .attr('stroke', '#d1d5db')
                .attr('stroke-width', 0.5);
                
            legendG.append('text')
                .attr('x', 0).attr('y', 28)
                .attr('font-size', '10px').attr('fill', '#9ca3af')
                .text('Near (Peak)');
                
            legendG.append('text')
                .attr('x', 120).attr('y', 28)
                .attr('text-anchor', 'end')
                .attr('font-size', '10px').attr('fill', '#9ca3af')
                .text('Far');
        }

        /* ---- re-apply global state ---- */
        applyScatter3dHighlight(getActiveRowIndex());
        setSelection(getEffectiveSelection());
        updateFilteredPoints();

        /* ---- filter planes (one per active axis filter) ---- */
        if (!disableBrush) drawFilterPlanes(g, proj);

        /* ---- brush overlays on each axis spine ---- */
        if (!disableBrush) drawAxisBrushes(svg, proj);
    }

    /* ============================================================= */
    /*  Filter planes                                                  */
    /* ============================================================= */
    function drawFilterPlanes(g, proj) {
        const planesG = g.append('g').attr('class', 'scatter3d-filter-planes');

        axisScaleMeta.forEach(({ key, scale, dir, color }) => {
            const filter = filterState.axisFilters[key];
            const isHidden = filterState.hiddenFilters.has(key);
            if (!filter || isHidden) return;

            [filter.min, filter.max].forEach(dataVal => {
                // Normalised position along this axis (–1…1)
                const t = scale(dataVal);  // already maps data → norm

                // Build the 4 corners of the plane perpendicular to this axis.
                // dir = which axis moves: [2,0,0] for X, [0,2,0] for Y, [0,0,2] for Z
                // The plane spans the full –1…1 square of the other two axes.
                let c0, c1, c2, c3;
                if (dir[0] !== 0) {
                    // X-axis plane: spans Y (–1…1) and Z (–1…1)
                    c0 = proj(t, -1, -1);
                    c1 = proj(t,  1, -1);
                    c2 = proj(t,  1,  1);
                    c3 = proj(t, -1,  1);
                } else if (dir[1] !== 0) {
                    // Y-axis plane: spans X (–1…1) and Z (–1…1)
                    c0 = proj(-1, t, -1);
                    c1 = proj( 1, t, -1);
                    c2 = proj( 1, t,  1);
                    c3 = proj(-1, t,  1);
                } else {
                    // Z-axis plane: spans X (–1…1) and Y (–1…1)
                    c0 = proj(-1, -1, t);
                    c1 = proj( 1, -1, t);
                    c2 = proj( 1,  1, t);
                    c3 = proj(-1,  1, t);
                }

                const pathD = `M${c0.x},${c0.y}L${c1.x},${c1.y}L${c2.x},${c2.y}L${c3.x},${c3.y}Z`;
                planesG.append('path')
                    .attr('class', 'scatter3d-filter-plane')
                    .attr('d', pathD)
                    .attr('fill', color)
                    .attr('fill-opacity', 0.12)
                    .attr('stroke', color)
                    .attr('stroke-opacity', 0.7)
                    .attr('stroke-width', 1.5)
                    .attr('stroke-dasharray', '5,3');
            });
        });

        return planesG;
    }

    /* ============================================================= */
    /*  Axis brush overlays                                            */
    /* ============================================================= */
    // We overlay a small HTML element for each axis that holds a D3 brushY.
    // The brush operates in "spine-pixel" space (the projected length of the
    // axis line on screen) and we map back to data-space via the axis scale.
    function drawAxisBrushes(svg, proj) {
        axisScaleMeta.forEach(({ key, scale, dir, color }) => {
            const isHidden = filterState.hiddenFilters.has(key);
            if (isHidden) return;

            // Projected start and end of this axis spine
            const axisOrigin = proj(-1, -1, -1);
            // End tip of axis
            let axisEnd;
            if (dir[0] !== 0)      axisEnd = proj(1, -1, -1);
            else if (dir[1] !== 0) axisEnd = proj(-1, 1, -1);
            else                   axisEnd = proj(-1, -1, 1);

            // Screen-space length and angle of the spine
            const dx = axisEnd.x - axisOrigin.x;
            const dy = axisEnd.y - axisOrigin.y;
            const spineLen = Math.sqrt(dx * dx + dy * dy);
            if (spineLen < 10) return;

            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            // Mid-point for label overlay
            const mx = (axisOrigin.x + axisEnd.x) / 2;
            const my = (axisOrigin.y + axisEnd.y) / 2;

            // We draw the brush in a thin <g> rotated along the spine.
            // brushY operates vertically; we rotate it to align with the spine.
            const HALF = spineLen / 2;
            const BRUSH_W = 8; // half-width each side of the spine

            const brushG = svg.append('g')
                .attr('class', 'scatter3d-axis-brush')
                .attr('data-axis', key)
                .attr('transform', `translate(${mx},${my}) rotate(${angle})`);

            // Invisible wider hit-area rect behind the brush
            brushG.append('rect')
                .attr('class', 'scatter3d-axis-brush-bg')
                .attr('x', -HALF)
                .attr('y', -BRUSH_W * 2)
                .attr('width', spineLen)
                .attr('height', BRUSH_W * 4)
                .attr('fill', 'none');

            // The brush extent: along the local X axis (which is the spine direction)
            const brush = d3.brushX()
                .extent([[-HALF, -BRUSH_W], [HALF, BRUSH_W]])
                .on('brush', function (event) {
                    if (!event.sourceEvent) return;
                    if (!event.selection) return;
                    const [px0, px1] = event.selection;
                    // Map from pixel offset (–HALF…+HALF) → normalised (–1…1) → data value
                    const norm0 = (px0 / HALF);          // –1 … +1
                    const norm1 = (px1 / HALF);
                    const dataMin = scale.invert(norm0);
                    const dataMax = scale.invert(norm1);
                    filterState.axisFilters[key] = {
                        min: Math.min(dataMin, dataMax),
                        max: Math.max(dataMin, dataMax),
                    };
                    updateFilteredPoints();
                    // Redraw planes without full re-render
                    svg.select('.scatter3d-filter-planes').remove();
                    const sceneG = svg.select('g.scene');
                    drawFilterPlanes(sceneG, proj);
                })
                .on('end', function (event) {
                    if (!event.sourceEvent) return;
                    if (!event.selection) {
                        delete filterState.axisFilters[key];
                        filterState.hiddenFilters.delete(key);
                        updateFilteredPoints();
                        svg.select('.scatter3d-filter-planes').remove();
                        const sceneG = svg.select('g.scene');
                        drawFilterPlanes(sceneG, proj);
                    }
                });

            brushG.call(brush);

            // Double-click on the selection rect removes the filter
            brushG.on('dblclick.remove', function (event) {
                const selPixels = d3.brushSelection(this);
                if (!selPixels) return;
                const [localX] = d3.pointer(event, this);
                if (localX >= selPixels[0] - 4 && localX <= selPixels[1] + 4) {
                    event.stopPropagation();
                    brush.move(brushG, null);
                    delete filterState.axisFilters[key];
                    filterState.hiddenFilters.delete(key);
                    updateFilteredPoints();
                    svg.select('.scatter3d-filter-planes').remove();
                    drawFilterPlanes(svg.select('g.scene'), proj);
                }
            });

            // Reset SVG cursor when mouse leaves the brush widget,
            // since D3 brush may have set an inline cursor on the SVG.
            brushG.on('mouseleave.cursor', () => {
                if (!isDragging) svg.style('cursor', null);
            });

            // Restore previous filter position
            const existing = filterState.axisFilters[key];
            if (existing) {
                const px0 = scale(existing.min)  * HALF;   // norm → pixel
                const px1 = scale(existing.max)  * HALF;
                const lo = Math.max(-HALF, Math.min(HALF, Math.min(px0, px1)));
                const hi = Math.max(-HALF, Math.min(HALF, Math.max(px0, px1)));
                if (hi > lo) brush.move(brushG, [lo, hi]);
            }

            // Style the brush selection rect
            brushG.select('.selection')
                .attr('fill', color)
                .attr('fill-opacity', 0.25)
                .attr('stroke', color)
                .attr('stroke-opacity', 0.8);
        });
    }

    /* ============================================================= */
    /*  Delaunay surface mesh                                          */
    /* ============================================================= */
    function drawDelaunaySurface(g, projected) {
        const surfaceG = g.append('g').attr('class', 'scatter3d-surface-group');

        // Configuration for shading and contouring
        const styleCfg = {
            lightDir: [1, 1, 1], // Directional light source
            strokeFront: { color: '#ffffff', width: 0.5, opacity: 0.85 }, // Highlight
            strokeBack:  { color: '#1e293b', width: 1.5, opacity: 0.65 }, // Shadow cast
            fillBase: { h: 216, s: 0.25 }, // Hue and Saturation of the surface
            aoBaseLightness: 1, // Lightest point (closest to the optimum peak)
            aoLightnessRange: 1, // How much darker the surface gets as it moves away from optimum
            // Maximum diagonal distance across the normalized [0, 1] cube from optimum [1, 1, 1] to [0, 0, 0]
            maxDist: Math.sqrt((1 - (0))**2 + (1 - (0))**2 + (1 - (0))**2)
        };

        const delaunay = d3.Delaunay.from(projected, d => d.endNx, d => d.endNy);
        const tris = delaunay.triangles;

        // Collect triangles with depth for painter's algorithm
        const triData = [];
        for (let i = 0; i < tris.length; i += 3) {
            const p0 = projected[tris[i]];
            const p1 = projected[tris[i + 1]];
            const p2 = projected[tris[i + 2]];
            triData.push({
                pts:   [p0, p1, p2],
                depth: (p0.endDepth + p1.endDepth + p2.endDepth) / 3,
            });
        }
        triData.sort((a, b) => a.depth - b.depth);

        // Pre-normalize light direction
        const lLen = Math.sqrt(styleCfg.lightDir[0] ** 2 + styleCfg.lightDir[1] ** 2 + styleCfg.lightDir[2] ** 2);
        const lx = styleCfg.lightDir[0] / lLen;
        const ly = styleCfg.lightDir[1] / lLen;
        const lz = styleCfg.lightDir[2] / lLen;

        triData.forEach(tri => {
            const p0 = tri.pts[0];
            const p1 = tri.pts[1];
            const p2 = tri.pts[2];

            // 1. Calculate 3D normal
            const v1x = p1.endNx - p0.endNx;
            const v1y = p1.endNy - p0.endNy;
            const v1z = p1.endNz - p0.endNz;

            const v2x = p2.endNx - p0.endNx;
            const v2y = p2.endNy - p0.endNy;
            const v2z = p2.endNz - p0.endNz;

            let nx = v1y * v2z - v1z * v2y;
            let ny = v1z * v2x - v1x * v2z;
            let nz = v1x * v2y - v1y * v2x;

            const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx /= len;
            ny /= len;
            nz /= len;

            // 2. Stroke styles via dot product with light direction
            let dot = nx * lx + ny * ly + nz * lz;

            // Determine if we are looking at the front or back face using screen-space 2D cross product.
            // This treats the triangles as having 2 faces logically and naturally inverses the light.
            const cx1 = p1.endSx - p0.endSx;
            const cy1 = p1.endSy - p0.endSy;
            const cx2 = p2.endSx - p0.endSx;
            const cy2 = p2.endSy - p0.endSy;
            const isBackFace = (cx1 * cy2 - cy1 * cx2) > 0;

            if (isBackFace) {
                dot = -dot;
            }

            const strokeStyle = dot > 0 ? styleCfg.strokeFront : styleCfg.strokeBack;

            // 3. Ambient Occlusion coloring mapping centroid distance (optimal point is at max [1, 1, 1])
            const cx = (p0.endNx + p1.endNx + p2.endNx) / 3;
            const cy = (p0.endNy + p1.endNy + p2.endNy) / 3;
            const cz = (p0.endNz + p1.endNz + p2.endNz) / 3;

            const dist = Math.sqrt((1 - cx) ** 2 + (1 - cy) ** 2 + (1 - cz) ** 2);
            
            // Calculate base Ambient Occlusion (AO) based on distance from optimum
            // Closest to optimum -> dist is 0 -> aoFactor is 0 -> lightness is aoBaseLightness (highest)
            // Furthest from optimum -> dist is maxDist -> aoFactor is 1 -> lightness decreases by aoLightnessRange
            const aoFactor = Math.min(dist / styleCfg.maxDist, 1);
            const lightness = styleCfg.aoBaseLightness - aoFactor * styleCfg.aoLightnessRange;

            const fillColor = d3.hsl(styleCfg.fillBase.h, styleCfg.fillBase.s, lightness).toString();

            const d = `M${p0.endSx},${p0.endSy}`
                    + `L${p1.endSx},${p1.endSy}`
                    + `L${p2.endSx},${p2.endSy}Z`;
            surfaceG.append('path')
                .attr('class', 'scatter3d-surface-tri')
                .attr('d', d)
                .attr('fill', fillColor)
                .attr('fill-opacity', 0.85)
                .attr('stroke', strokeStyle.color)
                .attr('stroke-opacity', strokeStyle.opacity)
                .attr('stroke-width', strokeStyle.width);
        });

        return surfaceG;
    }

    /* ============================================================= */
    /*  Axes drawing                                                   */
    /* ============================================================= */
    function drawAxes(g, proj, xKey, yKey, zKey, xSc, ySc, zSc) {
        const axesG = g.append('g').attr('class', 'scatter3d-axes');
        const numTicks = 3;

        const axes = [
            { start: [-1,-1,-1], end: [1,-1,-1], label: xKey, color: '#e74c3c', scale: xSc, dir: [1,0,0] },
            { start: [-1,-1,-1], end: [-1,1,-1], label: yKey, color: '#27ae60', scale: ySc, dir: [0,1,0] },
            { start: [-1,-1,-1], end: [-1,-1,1], label: zKey, color: '#3498db', scale: zSc, dir: [0,0,1] },
        ];

        // Draw bounding box / cube edges (thin dashed lines to complete the space)
        const boxEdges = [
            // Bottom face (Z = -1) remaining edges
            { s: [1, -1, -1], e: [1, 1, -1] },
            { s: [-1, 1, -1], e: [1, 1, -1] },
            // Top face (Z = 1)
            { s: [-1, -1, 1], e: [1, -1, 1] },
            { s: [-1, -1, 1], e: [-1, 1, 1] },
            { s: [1, -1, 1], e: [1, 1, 1] },
            { s: [-1, 1, 1], e: [1, 1, 1] },
            // Vertical edges connecting bottom and top faces
            { s: [1, -1, -1], e: [1, -1, 1] },
            { s: [-1, 1, -1], e: [-1, 1, 1] },
            { s: [1, 1, -1], e: [1, 1, 1] }
        ];

        boxEdges.forEach(edge => {
            const p1 = proj(...edge.s);
            const p2 = proj(...edge.e);
            axesG.append('line')
                .attr('class', 'scatter3d-bounding-box-edge')
                .attr('x1', p1.x).attr('y1', p1.y)
                .attr('x2', p2.x).attr('y2', p2.y)
                .attr('stroke', '#d1d5db')
                .attr('stroke-width', 0.5)
                .attr('stroke-dasharray', '4,4');
        });

        axes.forEach(axis => {
            const s = proj(...axis.start);
            const e = proj(...axis.end);

            axesG.append('line')
                .attr('class', 'scatter3d-axis-line')
                .attr('x1', s.x).attr('y1', s.y)
                .attr('x2', e.x).attr('y2', e.y)
                .attr('stroke', axis.color);

            // ticks & labels
            const tickSc = d3.scaleLinear().domain([-1, 1]).range(axis.scale.domain());
            for (let i = 0; i <= numTicks; i++) {
                const t = -1 + (2 * i / numTicks);
                const pos = [
                    axis.start[0] + axis.dir[0] * (t + 1),
                    axis.start[1] + axis.dir[1] * (t + 1),
                    axis.start[2] + axis.dir[2] * (t + 1),
                ];
                const tp = proj(...pos);
                axesG.append('circle').attr('cx', tp.x).attr('cy', tp.y).attr('r', 2).attr('fill', axis.color);

                if (i > 0) {
                    const off = 0.15;
                    let labelPos;
                    if (axis.dir[0] === 1)      labelPos = proj(pos[0], pos[1], pos[2] - off);
                    else if (axis.dir[1] === 1)  labelPos = proj(pos[0] - off, pos[1], pos[2]);
                    else                         labelPos = proj(pos[0] - off, pos[1], pos[2]);

                    const fmt = (v) => Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3);

                    axesG.append('text')
                        .attr('class', 'scatter3d-tick-label-bg')
                        .attr('x', labelPos.x).attr('y', labelPos.y)
                        .attr('text-anchor', 'middle').attr('dy', '0.35em')
                        .attr('stroke', '#fff').attr('stroke-width', 2).attr('fill', 'none')
                        .text(fmt(tickSc(t)));
                    axesG.append('text')
                        .attr('class', 'scatter3d-tick-label')
                        .attr('x', labelPos.x).attr('y', labelPos.y)
                        .attr('text-anchor', 'middle').attr('dy', '0.35em')
                        .attr('fill', axis.color)
                        .text(fmt(tickSc(t)));
                }
            }

            // Axis name label at middle
            const mid  = axis.start.map((v, idx) => (v + axis.end[idx]) / 2);
            const lOff = 0.25;
            let lp;
            if (axis.dir[0] === 1)      lp = [mid[0], mid[1], mid[2] - lOff];
            else if (axis.dir[1] === 1)  lp = [mid[0] - lOff, mid[1], mid[2]];
            else                         lp = [mid[0] - lOff, mid[1], mid[2]];
            const lpp = proj(...lp);

            axesG.append('text')
                .attr('class', 'scatter3d-axis-label-bg')
                .attr('x', lpp.x).attr('y', lpp.y)
                .attr('text-anchor', 'middle').attr('dy', '0.35em')
                .attr('stroke', '#fff').attr('stroke-width', 3).attr('fill', 'none')
                .text(axis.label);
            axesG.append('text')
                .attr('class', 'scatter3d-axis-label')
                .attr('x', lpp.x).attr('y', lpp.y)
                .attr('text-anchor', 'middle').attr('dy', '0.35em')
                .attr('fill', axis.color).attr('font-weight', 'bold')
                .text(axis.label);
        });

        return axesG;
    }

    /* ============================================================= */
    /*  Drag-to-rotate                                                 */
    /* ============================================================= */
    let isDragging = false;
    let lastX = 0, lastY = 0;

    svg.on('mousedown.rotate', (event) => {
        if (event.button !== 0) return;
        // Don't start drag if clicking on a point or a brush overlay
        if (event.target.classList.contains('scatter3d-point')) return;
        if (event.target.closest && event.target.closest('.scatter3d-axis-brush')) return;
        isDragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
        svg.style('cursor', 'grabbing');
        event.preventDefault();

        d3.select(window)
            .on('mousemove.scatter3d-rotate', (e) => {
                if (!isDragging) return;
                rotationZ += (e.clientX - lastX) * 0.5;
                rotationX += (e.clientY - lastY) * 0.5;
                rotationX = Math.max(-89, Math.min(89, rotationX));
                rotationZ = ((rotationZ % 360) + 360) % 360;
                lastX = e.clientX;
                lastY = e.clientY;
                containerNode.dataset.rot3dX = rotationX;
                containerNode.dataset.rot3dZ = rotationZ;
                drawScene(false);
            })
            .on('mouseup.scatter3d-rotate', () => {
                isDragging = false;
                svg.style('cursor', null); // remove inline; let CSS :hover rule take over
                d3.select(window).on('mousemove.scatter3d-rotate', null).on('mouseup.scatter3d-rotate', null);
            });
    });

    /* ============================================================= */
    /*  Selection helper (shared with pub-sub)                         */
    /* ============================================================= */
    function setSelection(rowIndexSet) {
        const has = rowIndexSet !== null && rowIndexSet.size > 0;
        container.selectAll('.scatter3d-point[data-row-index]')
            .classed('is-selection-dim', function () { return has && !rowIndexSet.has(Number(this.dataset.rowIndex)); })
            .classed('is-point-selected', function () { return has && rowIndexSet.has(Number(this.dataset.rowIndex)); });
        container.selectAll('.scatter3d-label[data-row-index]')
            .classed('is-selection-dim', function () { return has && !rowIndexSet.has(Number(this.dataset.rowIndex)); })
            .classed('is-point-selected', function () { return has && rowIndexSet.has(Number(this.dataset.rowIndex)); });
    }

    _scatter3dInstances.set(containerSelector, setSelection);

    /* ---- initial scene ---- */
    drawScene(shouldAnimate);
}

/* ------------------------------------------------------------------ */
/*  Reusable axis‐select populator (same signature as 2D scatter)     */
/* ------------------------------------------------------------------ */
export function populateAxisSelect3d(select, columns) {
    select.selectAll('*').remove();
    select.selectAll('option')
        .data(columns)
        .enter()
        .append('option')
        .attr('value', c => c)
        .text(c => c);
}
