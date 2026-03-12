import * as d3 from 'd3';
import './scatterplot3d.css';
import { subscribe, getActiveRowIndex, getEffectiveSelection } from '../state/appState.js';

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
/*  Main render function                                               */
/* ------------------------------------------------------------------ */

export function renderScatterplot3d(containerSelector, data, xKey, yKey, zKey, options = {}) {
    const {
        onHoverStart    = () => {},
        onHoverEnd      = () => {},
        onSelectionChange = () => {},
        onShiftClick    = () => {},
        animate         = false,
        showLabels      = false,
    } = options;

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

        const projected = points.map(p => {
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
                     endSx: endPr.x, endSy: endPr.y, endDepth: endPr.depth };
        });
        projected.sort((a, b) => a.depth - b.depth);  // painter's order

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
            .text('Drag to rotate · Shift+click to select');

        /* ---- re-apply global state ---- */
        applyScatter3dHighlight(getActiveRowIndex());
        setSelection(getEffectiveSelection());
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
        // Don't start drag if clicking on a point
        if (event.target.classList.contains('scatter3d-point')) return;
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
                svg.style('cursor', 'grab');
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
