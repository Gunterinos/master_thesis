import * as d3 from 'd3';
import './radarChart.css';
import { subscribe, getActiveRowIndex, getEffectiveSelection } from '../state/appState.js';
import { POINT_COLOR_BENCHMARK, getGroupBaseColor, getGroupOrder, getColumnColor, computeDominantGroups } from '../colors.js';

// ── Step 3: Cross-chart hover highlight ─────────────────────────────────────
function applyRadarHighlight(rowIndex) {
    d3.selectAll('.radar-path[data-row-index]')
        .classed('is-linked-highlight', function () {
            return rowIndex !== null && Number(this.dataset.rowIndex) === rowIndex;
        })
        .classed('is-linked-dim', function () {
            return rowIndex !== null && Number(this.dataset.rowIndex) !== rowIndex;
        });
}

subscribe('hover-change', applyRadarHighlight);
subscribe('selection-change', setRadarChartSelection);
subscribe('zoom-enter', radarEnterZoomAll);
subscribe('zoom-exit', radarExitZoomAll);
subscribe('filters-clear', radarClearFiltersAll);

const _radarState = new Map();
const _radarSetSelectionFns = new Map();
const _radarLastSelection = new Map();

// ── Step 5: Zoom integration ─────────────────────────────────────────────────
function radarEnterZoomAll() {
    _radarState.forEach((state) => {
        state.hiddenFilters = new Set(Object.keys(state.axisFilters));
    });
}

function radarExitZoomAll() {
    _radarState.forEach((state) => {
        state.hiddenFilters.clear();
    });
}

function radarClearFiltersAll() {
    _radarState.forEach((state) => {
        state.axisFilters = {};
        state.hiddenFilters.clear();
        state.hadActiveBrushFilters = false;
    });
}

// ── Step 4: Selection ────────────────────────────────────────────────────────
export function setRadarChartSelection(rowIndexSet) {
    _radarLastSelection.forEach((_, key) => _radarLastSelection.set(key, rowIndexSet));
    _radarSetSelectionFns.forEach((fn) => fn(rowIndexSet));
}

export function renderRadarChart(containerSelector, allColumns, data, options = {}) {
    const {
        onHoverStart = () => {},
        onHoverEnd = () => {},
        onShiftClick = () => {},
        onBrushFilterChange = () => {},
        disableBrush = false,
        animate = false,
        objectiveDirections = {},
        groupColorOverrides = null,
        decisionColumns = [],
        groups = {},
    } = options;

    const container = d3.select(containerSelector);
    const containerNode = container.node();
    if (!containerNode) return;

    // ── Persistent state ─────────────────────────────────────────────────────
    if (!_radarState.has(containerSelector)) {
        _radarState.set(containerSelector, {
            axisOrder: [...allColumns],
            enabledAxes: new Set(allColumns),
            dropdownOpen: false,
            showDecGroups: false,
            // Step 5: filters stored in normalized radius space { t1, t2 } ∈ [0,1]
            axisFilters: {},
            hiddenFilters: new Set(),
            hadActiveBrushFilters: false,
        });
    }
    const state = _radarState.get(containerSelector);
    if (!state.axisFilters) state.axisFilters = {};
    if (!state.hiddenFilters) state.hiddenFilters = new Set();

    // Sync state with potentially changed column list
    const addedCols = allColumns.filter((c) => !state.axisOrder.includes(c));
    state.axisOrder = state.axisOrder.filter((c) => allColumns.includes(c));
    state.axisOrder.push(...addedCols);
    for (const c of [...state.enabledAxes]) {
        if (!allColumns.includes(c)) state.enabledAxes.delete(c);
    }
    addedCols.forEach((c) => state.enabledAxes.add(c));

    const rerender = (anim) =>
        renderRadarChart(containerSelector, allColumns, data, { ...options, animate: anim });

    const activeAxes = state.axisOrder.filter((c) => state.enabledAxes.has(c));

    // ── Layout ───────────────────────────────────────────────────────────────
    const containerWidth = Math.max(400, containerNode.clientWidth || 0);
    const containerHeight = Math.max(300, containerNode.clientHeight || 0);
    const HEADER_H = 40;
    const svgHeight = containerHeight - HEADER_H;

    // ── Clear & rebuild DOM ──────────────────────────────────────────────────
    container.selectAll('*').remove();

    // ── Step 2: Dropdown ─────────────────────────────────────────────────────
    const dropdownWrapper = container
        .append('div')
        .attr('class', 'radar-dropdown-wrapper');

    dropdownWrapper
        .append('button')
        .attr('class', 'radar-axes-btn')
        .text('Dimensions ▾')
        .on('click', (event) => {
            event.stopPropagation();
            state.dropdownOpen = !state.dropdownOpen;
            dropdownPanel.classed('hidden', !state.dropdownOpen);
        });

    const dropdownPanel = dropdownWrapper
        .append('div')
        .attr('class', 'radar-axes-panel')
        .classed('hidden', !state.dropdownOpen);

    allColumns.forEach((col) => {
        const item = dropdownPanel.append('label').attr('class', 'radar-axis-item');
        item.append('input')
            .attr('type', 'checkbox')
            .property('checked', state.enabledAxes.has(col))
            .on('change', function () {
                if (this.checked) {
                    state.enabledAxes.add(col);
                } else {
                    if (state.enabledAxes.size <= 1) { this.checked = true; return; }
                    state.enabledAxes.delete(col);
                }
                state.dropdownOpen = true;
                rerender(true);
            });
        item.append('span').text(col);
    });

    const bodyEventKey = `click.radar-dd-${containerSelector.replace(/\W/g, '')}`;
    d3.select('body').on(bodyEventKey, () => {
        if (state.dropdownOpen) {
            state.dropdownOpen = false;
            dropdownPanel.classed('hidden', true);
        }
    });

    // ── Dec. Groups toggle button ─────────────────────────────────
    if (decisionColumns.length > 0) {
        dropdownWrapper
            .append('button')
            .attr('class', state.showDecGroups ? 'radar-axes-btn radar-dec-groups-btn active' : 'radar-axes-btn radar-dec-groups-btn')
            .text('Dec. Groups')
            .on('click', (event) => {
                event.stopPropagation();
                state.showDecGroups = !state.showDecGroups;
                rerender(false);
            });
    }

    if (activeAxes.length < 2) {
        container.append('p').attr('class', 'radar-empty').text('Not enough dimensions selected.');
        return;
    }

    // ── Tooltip ───────────────────────────────────────────────────────────────
    const tooltip = d3.select('body')
        .selectAll('.scatter-tooltip')
        .data([null])
        .join('div')
        .attr('class', 'scatter-tooltip');

    // ── SVG ──────────────────────────────────────────────────────────────────
    const svgEl = container
        .append('svg')
        .attr('class', 'radar-svg')
        .attr('viewBox', `0 0 ${containerWidth} ${svgHeight}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

    const LABEL_MARGIN = 48;
    const cx = containerWidth / 2;
    const cy = svgHeight / 2;
    const radius = Math.min(cx, cy) - LABEL_MARGIN;

    // ── Step 8: Scales — invert domain for 'min' so best value = outer ring ──
    const rScales = {};
    activeAxes.forEach((axis) => {
        const ext = d3.extent(data, (row) => +row[axis]);
        const pad = (ext[1] - ext[0] || 1) * 0.05;
        const dir = objectiveDirections[axis];
        if (dir === 'min') {
            rScales[axis] = d3.scaleLinear()
                .domain([ext[1] + pad, ext[0] - pad])
                .range([0, radius])
                .clamp(true);
        } else {
            rScales[axis] = d3.scaleLinear()
                .domain([ext[0] - pad, ext[1] + pad])
                .range([0, radius])
                .clamp(true);
        }
    });

    // ── Step 7: Angular positions (from state.axisOrder) ─────────────────────
    const N = activeAxes.length;
    const angleMap = {};
    activeAxes.forEach((axis, i) => {
        angleMap[axis] = (2 * Math.PI * i) / N;
    });

    // Returns [x, y] for a spoke at given radius and angle set
    function spokeXY(axis, r, angles) {
        const a = (angles || angleMap)[axis];
        return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    }

    // Builds closed polygon path for a data row given current angles and scales
    function buildRadarPath(axes, angles, scaleFns, row) {
        if (!axes.length) return '';
        const pts = axes.map((axis) => spokeXY(axis, scaleFns[axis](+row[axis]), angles));
        return d3.line()(pts) + 'Z';
    }

    // ── SVG layers (order = z-order): grid → paths → filters → labels ────────
    const gridG = svgEl.append('g').attr('class', 'radar-grid');
    const pathsG = svgEl.append('g').attr('class', 'radar-paths');
    const filterG = svgEl.append('g').attr('class', 'radar-filter-layer');
    const labelsG = svgEl.append('g').attr('class', 'radar-labels');

    // Local button takes precedence; fall back to externally computed overrides
    const effectiveGroupColorOverrides = (state.showDecGroups && decisionColumns.length > 0)
        ? computeDominantGroups(data, decisionColumns, groups)
        : groupColorOverrides;

    // ── Dec-groups legend ─────────────────────────────────────────────────────
    if (effectiveGroupColorOverrides && decisionColumns.length > 0) {
        const hasGroups = groups && Object.keys(groups).length > 0;
        const legendItems = hasGroups
            ? getGroupOrder(decisionColumns, groups).map((grp, gi) => ({ label: grp, color: getGroupBaseColor(gi) }))
            : decisionColumns.map((col, i) => ({ label: col, color: getColumnColor(i) }));

        const ITEM_H = 20;
        const legendW = 140;
        const legendX = containerWidth - legendW - 8;
        const legendY = 12;

        const legendG = svgEl.append('g')
            .attr('class', 'radar-dec-legend')
            .attr('transform', `translate(${legendX}, ${legendY})`);

        legendG.append('text')
            .attr('class', 'radar-dec-legend-title')
            .attr('x', 0).attr('y', 0)
            .text(hasGroups ? 'Dominant Dec. Group' : 'Dominant Dec. Variable');

        legendItems.forEach(({ label, color }, i) => {
            const row = legendG.append('g').attr('transform', `translate(0, ${i * ITEM_H + 10})`);
            row.append('rect').attr('width', 12).attr('height', 12).attr('rx', 2).attr('fill', color);
            row.append('text').attr('x', 18).attr('y', 10).attr('class', 'radar-dec-legend-label').text(label);
        });

        const bmRow = legendG.append('g')
            .attr('transform', `translate(0, ${legendItems.length * ITEM_H + 14})`);
        bmRow.append('line')
            .attr('x1', 0).attr('y1', 6).attr('x2', 14).attr('y2', 6)
            .attr('stroke', POINT_COLOR_BENCHMARK).attr('stroke-width', 2.5)
            .attr('stroke-dasharray', '6 4');
        bmRow.append('text').attr('x', 18).attr('y', 10).attr('class', 'radar-dec-legend-label').text('Benchmark');
    }

    // ── Grid rings ────────────────────────────────────────────────────────────
    const GRID_LEVELS = [0.2, 0.4, 0.6, 0.8, 1.0];
    GRID_LEVELS.forEach((level) => {
        const pts = activeAxes.map((axis) => spokeXY(axis, radius * level, angleMap));
        gridG.append('path')
            .attr('class', 'radar-grid-ring')
            .attr('data-level', level)
            .attr('d', d3.line()(pts) + 'Z');
    });

    // Spoke visual lines + tick value labels at each grid ring
    activeAxes.forEach((axis) => {
        const [x2, y2] = spokeXY(axis, radius, angleMap);
        gridG.append('line')
            .attr('class', 'radar-spoke-line')
            .attr('data-axis', axis)
            .attr('x1', cx).attr('y1', cy)
            .attr('x2', x2).attr('y2', y2);

        // Perpendicular offset direction (right side of spoke, looking outward)
        const angle = angleMap[axis];
        const perpX = -Math.cos(angle);  // right-hand perpendicular of (sinA, -cosA)
        const perpY = -Math.sin(angle);
        const TICK_OFFSET = 8;

        GRID_LEVELS.forEach((level) => {
            const [tx, ty] = spokeXY(axis, radius * level, angleMap);
            const dataVal = rScales[axis].invert(radius * level);
            gridG.append('text')
                .attr('class', 'radar-tick-label')
                .attr('x', tx + perpX * TICK_OFFSET)
                .attr('y', ty + perpY * TICK_OFFSET)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .text(Number(dataVal.toPrecision(3)));
        });
    });

    // ── Step 1 + 6: Polygons ──────────────────────────────────────────────────
    pathsG.selectAll('path.radar-path')
        .data(data)
        .enter()
        .append('path')
        // Step 6: benchmark class
        .attr('class', (row) => row.__isBenchmark ? 'radar-path is-benchmark' : 'radar-path')
        .attr('data-row-index', (row, i) => row.__rowIndex ?? i)
        .style('stroke', (row) => {
            if (row.__isBenchmark) return null;
            return effectiveGroupColorOverrides?.get(row.__rowIndex) ?? null;
        })
        .attr('d', (row) => buildRadarPath(activeAxes, angleMap, rScales, row))
        // Step 4: shift-click
        .on('click', function (event) {
            if (event.shiftKey) {
                event.stopPropagation();
                onShiftClick(+(this.dataset.rowIndex));
            }
        })
        // Step 3: hover + tooltip
        .on('mouseenter', function (event) {
            const rowIndex = +(this.dataset.rowIndex);
            onHoverStart(rowIndex);
            const row = this.__dataRow;
            if (row) {
                const lines = activeAxes.map((col) => `${col}: ${(+row[col]).toFixed(3)}`).join('<br>');
                tooltip.classed('visible', true)
                    .html(`${row.__isBenchmark ? 'Benchmark' : `Point: ${rowIndex}`}<br>${lines}`)
                    .style('left', `${event.pageX + 12}px`)
                    .style('top', `${event.pageY - 36}px`);
            }
        })
        .on('mousemove', (event) => {
            tooltip.style('left', `${event.pageX + 12}px`).style('top', `${event.pageY - 36}px`);
        })
        .on('mouseleave', () => { onHoverEnd(); tooltip.classed('visible', false); });

    pathsG.selectAll('path.radar-path').each(function (row) { this.__dataRow = row; });

    // Step 6: keep benchmark polygon on top of all others
    pathsG.selectAll('path.radar-path.is-benchmark').raise();

    // ── Step 5: Per-spoke brush filtering ────────────────────────────────────
    // Each spoke has: an invisible hit area (for creating a new filter by dragging)
    // and two circular handles (visible only when a filter is active on that spoke).
    // Filters are stored as { t1, t2 } in normalised radius space [0,1].

    function updateFilteredPaths() {
        const activeFilters = Object.entries(state.axisFilters)
            .filter(([axis]) => !state.hiddenFilters.has(axis) && activeAxes.includes(axis));

        const hasBrushFilter = activeFilters.length > 0;
        pathsG.selectAll('path.radar-path').classed('is-brush-filtered', function (row) {
            if (!hasBrushFilter) return false;
            return activeFilters.some(([axis, filter]) => {
                const t = rScales[axis](+row[axis]) / radius;
                return t < filter.t1 || t > filter.t2;
            });
        });

        const hasOnlyHidden = Object.keys(state.axisFilters).length > 0 && !hasBrushFilter;
        if (hasOnlyHidden) return;

        const wasActive = state.hadActiveBrushFilters || false;
        state.hadActiveBrushFilters = hasBrushFilter;

        if (hasBrushFilter) {
            const passingIndices = data
                .filter((row) => activeFilters.every(([axis, filter]) => {
                    const t = rScales[axis](+row[axis]) / radius;
                    return t >= filter.t1 && t <= filter.t2;
                }))
                .map((row, i) => row.__rowIndex ?? i);
            onBrushFilterChange(passingIndices);
        } else if (wasActive) {
            onBrushFilterChange(null);
        }
    }

    if (!disableBrush) {
        activeAxes.forEach((axis) => {
            if (state.hiddenFilters.has(axis)) return;

            const dirX = Math.sin(angleMap[axis]);
            const dirY = -Math.cos(angleMap[axis]);
            const existingFilter = state.axisFilters[axis];

            const axisFilterG = filterG.append('g')
                .attr('class', 'radar-axis-filter')
                .attr('data-axis', axis);

            // Invisible wide hit area (rendered first = below handles in z-order)
            const [tipX, tipY] = spokeXY(axis, radius, angleMap);
            let brushAnchorT = null;

            const hitLine = axisFilterG.append('line')
                .attr('class', 'radar-spoke-hit')
                .attr('x1', cx).attr('y1', cy)
                .attr('x2', tipX).attr('y2', tipY);

            // Visual: line between the two handles
            const filterRangeLine = axisFilterG.append('line')
                .attr('class', 'radar-filter-range')
                .style('display', existingFilter ? null : 'none');

            // Inner (t1) handle — rendered last = on top of hit line
            const minHandle = axisFilterG.append('circle')
                .attr('class', 'radar-filter-handle radar-filter-handle--min')
                .attr('r', 6)
                .style('display', existingFilter ? null : 'none');

            // Outer (t2) handle
            const maxHandle = axisFilterG.append('circle')
                .attr('class', 'radar-filter-handle radar-filter-handle--max')
                .attr('r', 6)
                .style('display', existingFilter ? null : 'none');

            function positionHandles() {
                const f = state.axisFilters[axis];
                if (!f) return;
                const r1 = f.t1 * radius;
                const r2 = f.t2 * radius;
                minHandle
                    .attr('cx', cx + r1 * dirX)
                    .attr('cy', cy + r1 * dirY);
                maxHandle
                    .attr('cx', cx + r2 * dirX)
                    .attr('cy', cy + r2 * dirY);
                filterRangeLine
                    .attr('x1', cx + r1 * dirX).attr('y1', cy + r1 * dirY)
                    .attr('x2', cx + r2 * dirX).attr('y2', cy + r2 * dirY);
            }

            if (existingFilter) positionHandles();

            hitLine.call(d3.drag()
                .on('start', function (event) {
                    brushAnchorT = Math.max(0, Math.min(1,
                        ((event.x - cx) * dirX + (event.y - cy) * dirY) / radius));
                })
                .on('drag', function (event) {
                    const currentT = Math.max(0, Math.min(1,
                        ((event.x - cx) * dirX + (event.y - cy) * dirY) / radius));
                    if (Math.abs(currentT - brushAnchorT) < 0.01) return;
                    state.axisFilters[axis] = {
                        t1: Math.min(brushAnchorT, currentT),
                        t2: Math.max(brushAnchorT, currentT),
                    };
                    minHandle.style('display', null);
                    maxHandle.style('display', null);
                    filterRangeLine.style('display', null);
                    positionHandles();
                    updateFilteredPaths();
                })
                .on('end', () => { brushAnchorT = null; })
            );

            // Individual handle drags (adjust an existing filter)
            minHandle.call(d3.drag()
                .on('drag', function (event) {
                    const t = Math.max(0, Math.min(1,
                        ((event.x - cx) * dirX + (event.y - cy) * dirY) / radius));
                    const f = state.axisFilters[axis];
                    if (!f) return;
                    state.axisFilters[axis] = { t1: Math.min(t, f.t2 - 0.01), t2: f.t2 };
                    positionHandles();
                    updateFilteredPaths();
                })
            );

            maxHandle.call(d3.drag()
                .on('drag', function (event) {
                    const t = Math.max(0, Math.min(1,
                        ((event.x - cx) * dirX + (event.y - cy) * dirY) / radius));
                    const f = state.axisFilters[axis];
                    if (!f) return;
                    state.axisFilters[axis] = { t1: f.t1, t2: Math.max(t, f.t1 + 0.01) };
                    positionHandles();
                    updateFilteredPaths();
                })
            );

            // Double-click anywhere in the axis filter group to remove filter
            axisFilterG.on('dblclick', function (event) {
                event.stopPropagation();
                delete state.axisFilters[axis];
                state.hiddenFilters.delete(axis);
                minHandle.style('display', 'none');
                maxHandle.style('display', 'none');
                filterRangeLine.style('display', 'none');
                updateFilteredPaths();
            });
        });
    }

    // ── Step 8: Axis labels with direction indicator ──────────────────────────
    const LABEL_OFFSET = 18;

    const labelGroups = labelsG
        .selectAll('g.radar-label-group')
        .data(activeAxes)
        .enter()
        .append('g')
        .attr('class', 'radar-label-group')
        .attr('data-axis', (d) => d);

    labelGroups.each(function (axis) {
        const [lx, ly] = spokeXY(axis, radius + LABEL_OFFSET, angleMap);
        const grp = d3.select(this);

        // Invisible drag overlay rectangle (gives a comfortable grab area)
        grp.append('rect')
            .attr('class', 'radar-label-drag-overlay')
            .attr('x', lx - 38).attr('y', ly - 12)
            .attr('width', 76).attr('height', 24);

        // Label text — Step 8: append ↑/↓ for max/min objectives
        grp.append('text')
            .attr('class', 'radar-axis-label')
            .attr('data-axis', axis)
            .attr('x', lx).attr('y', ly)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .text(() => {
                const dir = objectiveDirections[axis];
                if (dir === 'max') return `${axis} ↑`;
                if (dir === 'min') return `${axis} ↓`;
                return axis;
            });
    });

    // ── Step 7: Spoke drag to reorder ────────────────────────────────────────
    const liveAngles = { ...angleMap };
    let liveOrder = [...activeAxes];

    labelGroups.call(d3.drag()
        .on('start', function () {
            d3.select(this).classed('radar-spoke--dragging', true);
        })
        .on('drag', function (event, axis) {
            const mouseAngle = Math.atan2(event.x - cx, -(event.y - cy));
            liveAngles[axis] = (mouseAngle + 2 * Math.PI) % (2 * Math.PI);

            // Derive new logical order from visual angles
            const newOrder = [...activeAxes].sort((a, b) => liveAngles[a] - liveAngles[b]);
            if (newOrder.join('|') !== liveOrder.join('|')) {
                liveOrder = newOrder;
                // Snap non-dragged axes to evenly-spaced angles
                newOrder.forEach((a, i) => {
                    if (a !== axis) {
                        liveAngles[a] = (2 * Math.PI * i) / newOrder.length;
                        // Update their visual position
                        const [x2, y2] = spokeXY(a, radius, liveAngles);
                        gridG.select(`line.radar-spoke-line[data-axis="${a}"]`)
                            .attr('x2', x2).attr('y2', y2);
                        const [lx, ly] = spokeXY(a, radius + LABEL_OFFSET, liveAngles);
                        labelsG.select(`g.radar-label-group[data-axis="${a}"] text`)
                            .attr('x', lx).attr('y', ly);
                        labelsG.select(`g.radar-label-group[data-axis="${a}"] rect`)
                            .attr('x', lx - 38).attr('y', ly - 12);
                    }
                });
            }

            // Move dragged spoke
            const [x2, y2] = spokeXY(axis, radius, liveAngles);
            gridG.select(`line.radar-spoke-line[data-axis="${axis}"]`)
                .attr('x2', x2).attr('y2', y2);
            const [lx, ly] = spokeXY(axis, radius + LABEL_OFFSET, liveAngles);
            labelsG.select(`g.radar-label-group[data-axis="${axis}"] text`)
                .attr('x', lx).attr('y', ly);
            labelsG.select(`g.radar-label-group[data-axis="${axis}"] rect`)
                .attr('x', lx - 38).attr('y', ly - 12);

            // Update grid rings
            GRID_LEVELS.forEach((level) => {
                const pts = activeAxes.map((a) => spokeXY(a, radius * level, liveAngles));
                gridG.select(`.radar-grid-ring[data-level="${level}"]`)
                    .attr('d', d3.line()(pts) + 'Z');
            });

            // Redraw all polygons with live angles
            pathsG.selectAll('path.radar-path')
                .attr('d', (row) => buildRadarPath(activeAxes, liveAngles, rScales, row));
        })
        .on('end', function (event, axis) {
            d3.select(this).classed('radar-spoke--dragging', false);
            const inactiveAxes = state.axisOrder.filter((c) => !activeAxes.includes(c));
            state.axisOrder = [...liveOrder, ...inactiveAxes];
            rerender(false);
        })
    );

    // ── Step 4: Selection state ───────────────────────────────────────────────
    function setSelection(rowIndexSet) {
        const hasSel = rowIndexSet !== null && rowIndexSet.size > 0;
        pathsG.selectAll('path.radar-path')
            .classed('is-selection-dim', function () {
                return hasSel && !rowIndexSet.has(Number(this.dataset.rowIndex));
            })
            .classed('is-path-selected', function () {
                return hasSel && rowIndexSet.has(Number(this.dataset.rowIndex));
            });
    }

    _radarSetSelectionFns.set(containerSelector, setSelection);
    _radarLastSelection.set(
        containerSelector,
        _radarLastSelection.get(containerSelector) ?? getEffectiveSelection()
    );

    const lastSel = _radarLastSelection.get(containerSelector);
    if (lastSel && lastSel.size > 0) setSelection(lastSel);

    // Apply carry-over filters from before rerender
    updateFilteredPaths();

    // Reapply hover state (subscribers don't fire on rerender)
    applyRadarHighlight(getActiveRowIndex());
}
