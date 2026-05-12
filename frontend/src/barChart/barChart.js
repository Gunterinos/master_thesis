import * as d3 from 'd3';
import './barChart.css';
import { subscribe, getActiveRowIndex, getEffectiveSelection } from '../state/appState.js';
import { CB_PALETTE, POINT_COLOR_BENCHMARK, getGroupBaseColor, getVariableColor, getGroupOrder, getGroupMembers } from '../colors.js';
import { formatLabel } from '../formatLabel.js';

// ── Per-container persistent state ───────────────────────────────────────────

const _legendExpandedGroups = new Map(); // containerSelector → Set<groupName>

// ── Highlight / selection ─────────────────────────────────────────────────────

function applyBarChartHighlight(rowIndex) {
    d3.selectAll('.bar-chart-segment[data-row-index], .bar-benchmark-outline[data-row-index]')
        .classed('is-linked-highlight', function () { return rowIndex !== null && Number(this.dataset.rowIndex) === rowIndex; })
        .classed('is-linked-dim',       function () { return rowIndex !== null && Number(this.dataset.rowIndex) !== rowIndex; });
}

function applyBarChartSelection(rowIndexSet) {
    const hasSelection = rowIndexSet !== null;
    d3.selectAll('.bar-chart-segment[data-row-index], .bar-benchmark-outline[data-row-index]')
        .classed('is-selection-dim', function () {
            return hasSelection && !rowIndexSet.has(Number(this.dataset.rowIndex));
        })
        .classed('is-point-selected', function () {
            return hasSelection && rowIndexSet.has(Number(this.dataset.rowIndex));
        });
}

subscribe('hover-change',    applyBarChartHighlight);
subscribe('selection-change', applyBarChartSelection);

// ── Data helpers ──────────────────────────────────────────────────────────────

/**
 * Compute per-row segment data for grouped mode.
 * Each segment has group-level share (y0, y1) and nested varSegs for hover expansion.
 */
function computeGroupedRows(data, groupOrder, groupMembersMap) {
    return data.map((row, index) => {
        const rowIndex    = row.__rowIndex ?? index;
        const isBenchmark = row.__isBenchmark === true;

        const groupVals = groupOrder.map(grp => ({
            grp,
            val: (groupMembersMap[grp] || []).reduce((s, col) => s + Math.max(+row[col] || 0, 0), 0),
        }));

        const total = groupVals.reduce((s, g) => s + g.val, 0);
        if (total <= 0) return null;

        let cum = 0;
        const segments = groupVals.map(({ grp, val }, gi) => {
            const share = val / total;
            const y0 = cum, y1 = cum + share;
            cum += share;

            const members = groupMembersMap[grp] || [];
            let varCum = 0;
            const varSegs = members.map((col, vi) => {
                const v       = Math.max(+row[col] || 0, 0);
                const vShare  = val > 0 ? v / val : 0;
                const vy0     = y0 + (y1 - y0) * varCum;
                const vy1     = y0 + (y1 - y0) * (varCum + vShare);
                varCum += vShare;
                return { col, vi, val: v, shareOfTotal: v / total, y0: vy0, y1: vy1, gi, members };
            });

            return { grp, gi, share, y0, y1, varSegs };
        });

        return { rowIndex, isBenchmark, pointLabel: isBenchmark ? 'BM' : String(rowIndex), segments };
    }).filter(Boolean);
}

// ── Main render ───────────────────────────────────────────────────────────────

export function renderBarChart(containerSelector, columns, data, options = {}) {
    const { onHoverStart = () => {}, onHoverEnd = () => {}, onShiftClick = () => {}, groups = {} } = options;

    const container     = d3.select(containerSelector);
    const containerNode = container.node();
    if (!containerNode) return;

    const hasGroups      = groups && Object.keys(groups).length > 0;
    const groupOrder     = hasGroups ? getGroupOrder(columns, groups)     : [];
    const groupMembersMap = hasGroups ? getGroupMembers(columns, groups)  : {};

    const frontierByIndex = new Map(data.map(row => [row.__rowIndex, row.__frontier ?? null]));

    // ── Tooltip ───────────────────────────────────────────────────────────────

    const tooltip = d3.select('body')
        .selectAll('.bar-chart-tooltip').data([null]).join('div')
        .attr('class', 'bar-chart-tooltip');

    const positionTooltip = (event) => {
        const tn = tooltip.node();
        if (!tn) return;
        const gap = 12, tw = tn.offsetWidth, th = tn.offsetHeight;
        let left = event.pageX + gap;
        if (left + tw > window.innerWidth - 12) left = event.pageX - tw - gap;
        left = Math.max(12, left);
        let top = event.pageY - th / 2;
        if (top + th > window.innerHeight - 12) top = window.innerHeight - th - 12;
        tooltip.style('left', `${left}px`)
            .style('top',  `${Math.max(12, top)}px`);
    };

    // ── Row data ──────────────────────────────────────────────────────────────

    let rows;
    if (hasGroups) {
        rows = computeGroupedRows(data, groupOrder, groupMembersMap);
    } else {
        const colorScale = d3.scaleOrdinal(CB_PALETTE).domain(columns);
        rows = data.map((row, index) => {
            const rowIndex    = row.__rowIndex ?? index;
            const isBenchmark = row.__isBenchmark === true;
            const values = columns
                .map(col => ({ key: col, value: Number(row[col]) }))
                .filter(e => Number.isFinite(e.value) && e.value >= 0);
            const total = d3.sum(values, e => e.value);
            if (!values.length || total <= 0) return null;
            let cum = 0;
            const segments = values.map(e => {
                const share = e.value / total;
                const start = cum; cum += share;
                return { ...e, share, y0: start, y1: cum, isBenchmark };
            });
            return { rowIndex, isBenchmark, pointLabel: isBenchmark ? 'BM' : String(rowIndex), segments };
        }).filter(Boolean);
    }

    if (rows.length === 0) {
        container.selectAll('*').remove();
        container.append('p').text('No valid non-negative numeric bar chart data.');
        return;
    }

    // ── Frontier spans (for bracket annotations) ──────────────────────────────

    const frontierSpans = [];
    rows.forEach(r => {
        const f = r.isBenchmark ? null : (frontierByIndex.get(r.rowIndex) ?? null);
        if (!f) return;
        const last = frontierSpans[frontierSpans.length - 1];
        if (last && last.frontier === f) {
            last.endRow = r;
        } else {
            frontierSpans.push({ frontier: f, startRow: r, endRow: r });
        }
    });
    const uniqueFrontierCount = new Set(frontierSpans.map(s => s.frontier)).size;
    const showBrackets = uniqueFrontierCount >= 2;

    // ── Geometry ──────────────────────────────────────────────────────────────

    const containerWidth  = Math.max(440, containerNode.clientWidth  || 0);
    const containerHeight = Math.max(300, containerNode.clientHeight || 0);

    const legendExpandedSet = _legendExpandedGroups.get(containerSelector) ?? new Set();

    const LEGEND_ROW_H = 28;
    const LEGEND_PAD   = 6;
    const LEGEND_H     = hasGroups
        ? LEGEND_PAD + LEGEND_ROW_H + 4 + LEGEND_ROW_H + LEGEND_PAD
        : LEGEND_PAD + LEGEND_ROW_H + LEGEND_PAD;

    const svgHeight = containerHeight - LEGEND_H;
    const margin    = { top: showBrackets ? 24 : 24, right: 24, bottom: 56, left: 56 };
    const width     = containerWidth - margin.left - margin.right;
    const height    = svgHeight - margin.top - margin.bottom;

    // ── Scales ────────────────────────────────────────────────────────────────

    const xScale = d3.scaleBand()
        .domain(rows.map(r => r.pointLabel))
        .range([0, width]).paddingInner(0.2).paddingOuter(0.1);

    const yScale = d3.scaleLinear().domain([0, 1]).range([height, 0]);

    const xAxis = d3.axisBottom(xScale);
    if (rows.length > 20) {
        const step = Math.ceil(rows.length / 10);
        xAxis.tickValues(rows.filter((_, i) => i % step === 0).map(r => r.pointLabel));
    }

    const colorScale = d3.scaleOrdinal(CB_PALETTE).domain(columns);

    container.selectAll('*').remove();
    container.style('display', 'flex').style('flex-direction', 'column');

    {

        const svgRoot = container.append('svg')
            .style('flex', '1 1 0').style('min-height', '0')
            .attr('viewBox', `0 0 ${containerWidth} ${svgHeight}`)
            .attr('preserveAspectRatio', 'none');

        const svg = svgRoot.append('g').attr('class', 'chart-root')
            .attr('transform', `translate(${margin.left}, ${margin.top})`);

        svg.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${height})`).call(xAxis);
        svg.append('g').attr('class', 'y-axis')
            .call(d3.axisLeft(yScale).ticks(5).tickFormat(v => `${Math.round(v * 100)}%`));

        svg.append('text').attr('class', 'x-label')
            .attr('x', width / 2).attr('y', height + 44).attr('text-anchor', 'middle').text('Point');
        svg.append('text').attr('class', 'y-label')
            .attr('transform', 'rotate(-90)').attr('x', -height / 2).attr('y', -40)
            .attr('text-anchor', 'middle').text('Percentage');

        // ── Legend (HTML rows outside SVG) ───────────────────────────────────

        const rerender = () => renderBarChart(containerSelector, columns, data, options);
        const legendWrap = container.append('div').attr('class', 'bar-legend-wrap');

        // Row 1: groups / columns + benchmark
        const row1 = legendWrap.append('div').attr('class', 'bar-legend-row bar-legend-groups');

        if (hasGroups) {
            groupOrder.forEach((grp, gi) => {
                const isExp = legendExpandedSet.has(grp);
                const canExpand = (groupMembersMap[grp] || []).length > 1;
                const item = row1.append('div')
                    .attr('class', isExp ? 'bar-legend-item is-active' : 'bar-legend-item')
                    .style('cursor', canExpand ? 'pointer' : 'default');
                if (canExpand) {
                    item.on('click', () => {
                        const next = new Set(_legendExpandedGroups.get(containerSelector) ?? new Set());
                        const expanding = !next.has(grp);
                        expanding ? next.add(grp) : next.delete(grp);
                        _legendExpandedGroups.set(containerSelector, next);
                        window.dispatchEvent(new CustomEvent('survey:action', { detail: { type: 'barchart_group_expand', group: grp, expanded: expanding } }));
                        rerender();
                    });
                }
                item.append('span').attr('class', 'bar-legend-swatch').style('background', getGroupBaseColor(gi));
                item.append('span').attr('class', 'bar-legend-text').text(formatLabel(grp));
                if (canExpand) item.append('span').attr('class', 'bar-legend-arrow').text(isExp ? '▾' : '▸');
            });
        } else {
            columns.forEach((col, i) => {
                const item = row1.append('div').attr('class', 'bar-legend-item');
                item.append('span').attr('class', 'bar-legend-swatch').style('background', colorScale(col));
                item.append('span').attr('class', 'bar-legend-text').text(formatLabel(col));
            });
        }

        const bmItem = row1.append('div').attr('class', 'bar-legend-item');
        bmItem.append('span').attr('class', 'bar-legend-swatch bar-legend-swatch--outline').style('border-color', POINT_COLOR_BENCHMARK);
        bmItem.append('span').attr('class', 'bar-legend-text').text('Benchmark');

        // Row 2: variables for all expanded groups (horizontally scrollable)
        if (hasGroups) {
            const row2 = legendWrap.append('div').attr('class', 'bar-legend-row bar-legend-vars');
            groupOrder.forEach((grp, gi) => {
                if (!legendExpandedSet.has(grp)) return;
                const members = groupMembersMap[grp] || [];
                members.forEach((col, vi) => {
                    const item = row2.append('div').attr('class', 'bar-legend-item bar-legend-item--var');
                    item.append('span').attr('class', 'bar-legend-swatch bar-legend-swatch--sm').style('background', getVariableColor(gi, vi, members.length));
                    item.append('span').attr('class', 'bar-legend-text').text(formatLabel(col));
                });
            });
        }

        // ── Bars ─────────────────────────────────────────────────────────────

        const barsRoot = svg.append('g').attr('class', 'bars-root');

        const barGroup = barsRoot.selectAll('g.bar-chart-bar')
            .data(rows, r => r.rowIndex)
            .enter()
            .append('g')
            .attr('class', r => r.isBenchmark ? 'bar-chart-bar is-benchmark' : 'bar-chart-bar')
            .attr('data-row-index', r => r.rowIndex)
            .attr('transform', r => `translate(${xScale(r.pointLabel)}, 0)`);

        if (hasGroups) {
            // ── Grouped bars with click expansion ────────────────────────────

            // Build tooltip HTML: all groups listed, expanded group shows its variables
            const buildGroupTooltip = (row, hoveredGrp, expandedGrp, activeVar = null) => {
                const frontier = frontierByIndex.get(row.rowIndex);
                const header = row.isBenchmark
                    ? 'Benchmark'
                    : `Point: ${row.pointLabel}${frontier ? `<br>${frontier}` : ''}`;  
                const lines = row.segments.map(seg => {
                    const isHovered  = seg.grp === hoveredGrp;
                    const isExpanded = seg.grp === expandedGrp;
                    const pct = `${(seg.share * 100).toFixed(1)}%`;
                    const groupLine  = isHovered
                        ? `<b>${formatLabel(seg.grp)}: ${pct}</b>`
                        : `${formatLabel(seg.grp)}: ${pct}`;
                    if (isExpanded) {
                        const varLines = seg.varSegs.map(v => {
                            const vPct = `${(v.shareOfTotal * 100).toFixed(2)}%`;
                            return v.col === activeVar
                                ? `&nbsp;&nbsp;<b>${formatLabel(v.col)}: ${vPct}</b>`
                                : `&nbsp;&nbsp;${formatLabel(v.col)}: ${vPct}`;
                        }).join('<br>');
                        return `${groupLine}<br>${varLines}`;
                    }
                    return groupLine;
                }).join('<br>');
                return `${header}<br>${lines}`;
            };

            barGroup.each(function (row) {
                const barG = d3.select(this);

                row.segments.forEach(seg => {
                    // One group area per group per bar
                    const isSegExpanded = legendExpandedSet.has(seg.grp);
                    const groupArea = barG.append('g')
                        .attr('class', isSegExpanded ? 'bar-group-area is-expanded' : 'bar-group-area')
                        .attr('data-group', seg.grp)
                        .on('click', (event) => {
                            if (event.shiftKey) { event.stopPropagation(); onShiftClick(row.rowIndex); return; }
                            if ((groupMembersMap[seg.grp] || []).length <= 1) return;
                            const next = new Set(_legendExpandedGroups.get(containerSelector) ?? new Set());
                            const expanding = !next.has(seg.grp);
                            expanding ? next.add(seg.grp) : next.delete(seg.grp);
                            _legendExpandedGroups.set(containerSelector, next);
                            window.dispatchEvent(new CustomEvent('survey:action', { detail: { type: 'barchart_group_expand', group: seg.grp, expanded: expanding } }));
                            rerender();
                        })
                        .on('mouseenter', function (event) {
                            onHoverStart(row.rowIndex);
                            const isExpanded = d3.select(this).classed('is-expanded');
                            tooltip.classed('visible', true)
                                .html(buildGroupTooltip(row, seg.grp, isExpanded ? seg.grp : null));
                            positionTooltip(event);
                        })
                        .on('mousemove', event => positionTooltip(event))
                        .on('mouseleave', () => {
                            onHoverEnd();
                            tooltip.classed('visible', false);
                        });

                    // Group segment rect (dimmed by CSS when expanded)
                    groupArea.append('rect')
                        .attr('class', 'bar-group-seg bar-chart-segment')
                        .attr('data-row-index', row.rowIndex)
                        .attr('data-group', seg.grp)
                        .attr('x', 0)
                        .attr('y', yScale(seg.y1))
                        .attr('width', xScale.bandwidth())
                        .attr('height', yScale(seg.y0) - yScale(seg.y1))
                        .attr('fill', getGroupBaseColor(seg.gi));

                    // Variable sub-layer (hidden; shown via CSS .is-expanded on parent)
                    const varLayer = groupArea.append('g').attr('class', 'bar-var-layer');

                    seg.varSegs.forEach(v => {
                        varLayer.append('rect')
                            .attr('class', 'bar-chart-segment')
                            .attr('data-row-index', row.rowIndex)
                            .attr('x', 0)
                            .attr('y', yScale(v.y1))
                            .attr('width', xScale.bandwidth())
                            .attr('height', yScale(v.y0) - yScale(v.y1))
                            .attr('fill', getVariableColor(v.gi, v.vi, v.members.length))
                            .on('mouseenter', event => {
                                tooltip.classed('visible', true)
                                    .html(buildGroupTooltip(row, seg.grp, seg.grp, v.col));
                                positionTooltip(event);
                            })
                            .on('mousemove', event => positionTooltip(event));
                    });
                });

                // Benchmark outline
                if (row.isBenchmark) {
                    barG.append('rect')
                        .attr('class', 'bar-benchmark-outline')
                        .attr('data-row-index', row.rowIndex)
                        .attr('x', 0).attr('width', xScale.bandwidth())
                        .attr('y', yScale(1))
                        .attr('height', yScale(0) - yScale(1));
                }
            });

        } else {
            // ── Flat (no groups) bars ─────────────────────────────────────────

            barGroup.selectAll('rect.bar-chart-segment')
                .data(r => r.segments.map(seg => ({
                    ...seg, rowIndex: r.rowIndex, pointLabel: r.pointLabel, allSegments: r.segments,
                })), seg => seg.key)
                .enter()
                .append('rect')
                .attr('class', 'bar-chart-segment')
                .attr('data-row-index', seg => seg.rowIndex)
                .attr('x', 0)
                .attr('y', seg => yScale(seg.y1))
                .attr('width', xScale.bandwidth())
                .attr('height', seg => yScale(seg.y0) - yScale(seg.y1))
                .attr('fill', seg => colorScale(seg.key))
                .on('click', (event, seg) => {
                    if (!event.shiftKey) return;
                    event.stopPropagation();
                    onShiftClick(seg.rowIndex);
                })
                .on('mouseenter', (event, seg) => {
                    onHoverStart(seg.rowIndex);
                    const lines = seg.allSegments
                        .map(s => `${formatLabel(s.key)}: ${(s.share * 100).toFixed(2)}%`).join('<br>');
                    const frontier = frontierByIndex.get(seg.rowIndex);
                    const header = seg.isBenchmark
                        ? 'Benchmark'
                        : `Point: ${seg.pointLabel}${frontier ? `<br>${frontier}` : ''}`;
                    tooltip.classed('visible', true)
                        .html(`${header}<br>${lines}`);
                    positionTooltip(event);
                })
                .on('mousemove', event => positionTooltip(event))
                .on('mouseleave', () => { onHoverEnd(); tooltip.classed('visible', false); });

            barGroup.filter(r => r.isBenchmark)
                .append('rect')
                .attr('class', 'bar-benchmark-outline')
                .attr('data-row-index', r => r.rowIndex)
                .attr('x', 0).attr('width', xScale.bandwidth())
                .attr('y', yScale(1))
                .attr('height', yScale(0) - yScale(1));
        }

        // ── Frontier brackets ─────────────────────────────────────────────────
        if (showBrackets) {
            const BRACKET_Y = -8;
            const TICK_H    = 6;
            const bracketsG = svg.append('g').attr('class', 'frontier-brackets');

            frontierSpans.forEach(({ frontier, startRow, endRow }) => {
                const x1 = xScale(startRow.pointLabel);
                const x2 = xScale(endRow.pointLabel) + xScale.bandwidth();
                const cx = (x1 + x2) / 2;

                bracketsG.append('path')
                    .attr('class', 'frontier-bracket-line')
                    .attr('d', `M${x1},${BRACKET_Y + TICK_H} L${x1},${BRACKET_Y} L${x2},${BRACKET_Y} L${x2},${BRACKET_Y + TICK_H}`);

                bracketsG.append('text')
                    .attr('class', 'frontier-bracket-label')
                    .attr('x', cx)
                    .attr('y', BRACKET_Y - 4)
                    .attr('text-anchor', 'middle')
                    .text(frontier);
            });
        }

        applyBarChartHighlight(getActiveRowIndex());
        applyBarChartSelection(getEffectiveSelection());
    }
}
