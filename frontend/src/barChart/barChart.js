import * as d3 from 'd3';
import './barChart.css';
import { subscribe, getActiveRowIndex, getEffectiveSelection } from '../state/appState.js';
import { CB_PALETTE, POINT_COLOR_BENCHMARK, getGroupBaseColor, getVariableColor, getGroupOrder, getGroupMembers } from '../colors.js';

// ── Per-container persistent state ───────────────────────────────────────────

const _legendExpandedGroups = new Map(); // containerSelector → Set<groupName>

// ── Highlight / selection ─────────────────────────────────────────────────────

function applyBarChartHighlight(rowIndex) {
    d3.selectAll('.bar-chart-segment[data-row-index], .bar-benchmark-outline[data-row-index]')
        .classed('is-linked-highlight', function () { return rowIndex !== null && Number(this.dataset.rowIndex) === rowIndex; })
        .classed('is-linked-dim',       function () { return rowIndex !== null && Number(this.dataset.rowIndex) !== rowIndex; });
}

function applyBarChartSelection(rowIndexSet) {
    d3.selectAll('.bar-chart-segment[data-row-index], .bar-benchmark-outline[data-row-index]')
        .classed('is-selection-dim', function () {
            return rowIndexSet !== null && !rowIndexSet.has(Number(this.dataset.rowIndex));
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
    const { onHoverStart = () => {}, onHoverEnd = () => {}, animate = false, groups = {} } = options;

    const container     = d3.select(containerSelector);
    const containerNode = container.node();
    if (!containerNode) return;

    const hasGroups      = groups && Object.keys(groups).length > 0;
    const groupOrder     = hasGroups ? getGroupOrder(columns, groups)     : [];
    const groupMembersMap = hasGroups ? getGroupMembers(columns, groups)  : {};

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

    // ── Geometry ──────────────────────────────────────────────────────────────

    const containerWidth  = Math.max(440, containerNode.clientWidth  || 0);
    const containerHeight = Math.max(300, containerNode.clientHeight || 0);

    const baseMargin       = { top: 24, right: 24, bottom: 56, left: 56 };
    const estWidth         = containerWidth - baseMargin.left - baseMargin.right;
    const legendItemWidth  = 140;
    const legendRowHeight  = 20;
    const itemsPerRow      = Math.max(1, Math.floor(estWidth / legendItemWidth));

    const legendExpandedSet = _legendExpandedGroups.get(containerSelector) ?? new Set();

    // Count total legend items (only expanded groups show their variables)
    const legendItemCount = hasGroups
        ? groupOrder.reduce((s, grp) => s + 1 + (legendExpandedSet.has(grp) ? (groupMembersMap[grp] || []).length : 0), 0) + 1
        : columns.length + 1;
    const legendRows   = Math.ceil(legendItemCount / itemsPerRow);
    const legendHeight = legendRows * legendRowHeight + legendRowHeight + 8;

    const margin = { ...baseMargin, bottom: baseMargin.bottom + legendHeight };
    const width  = containerWidth  - margin.left - margin.right;
    const height = containerHeight - margin.top  - margin.bottom;

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
    const transition  = d3.transition().duration(420);

    // For groups path always do full redraw (hover state is ephemeral, no click state)
    const existingSvg = container.select('svg');
    const isUpdate    = animate && !existingSvg.empty() && !hasGroups;

    // ── Full redraw ───────────────────────────────────────────────────────────

    if (!isUpdate) {
        container.selectAll('*').remove();

        const svgRoot = container.append('svg')
            .attr('viewBox', `0 0 ${containerWidth} ${containerHeight}`)
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

        // ── Legend ──────────────────────────────────────────────────────────

        const legendG = svg.append('g').attr('class', 'bar-chart-legend')
            .attr('transform', `translate(0, ${height + 64})`);

        let lRow = 0, lCol = 0;
        const addLegendItem = (color, label, bold = false, indent = false) => {
            const x = lCol * legendItemWidth + (indent ? 12 : 0);
            const y = lRow * legendRowHeight;
            const g = legendG.append('g').attr('transform', `translate(${x}, ${y})`);
            g.append('rect').attr('x', 0).attr('y', 1)
                .attr('width', indent ? 9 : 12).attr('height', indent ? 9 : 12)
                .attr('rx', indent ? 2 : 3).attr('fill', color);
            g.append('text').attr('x', indent ? 14 : 18).attr('y', indent ? 9 : 11)
                .style('font-weight', bold ? '600' : '400')
                .attr('class', indent ? 'bar-legend-var' : null)
                .text(label);
            lCol++;
            if (lCol >= itemsPerRow) { lCol = 0; lRow++; }
            return g;
        };

        if (hasGroups) {
            groupOrder.forEach((grp, gi) => {
                const isLegendExpanded = legendExpandedSet.has(grp);
                const grpG = addLegendItem(getGroupBaseColor(gi), grp, true, false);
                // Expand indicator appended after the text
                grpG.append('text')
                    .attr('x', legendItemWidth - 8)
                    .attr('y', 11)
                    .attr('text-anchor', 'end')
                    .style('font-size', '0.65rem')
                    .style('opacity', '0.6')
                    .text(isLegendExpanded ? '▼' : '▶');
                if (isLegendExpanded) {
                    (groupMembersMap[grp] || []).forEach((col, vi, arr) => {
                        addLegendItem(getVariableColor(gi, vi, arr.length), col, false, true);
                    });
                }
            });
        } else {
            columns.forEach(col => addLegendItem(colorScale(col), col));
        }

        // Benchmark legend entry
        const bmX = lCol * legendItemWidth, bmY = lRow * legendRowHeight + (lCol > 0 ? 0 : 0);
        const bmG = legendG.append('g').attr('transform', `translate(${bmX}, ${bmY + 4})`);
        bmG.append('rect').attr('x', 0).attr('y', 1).attr('width', 12).attr('height', 12)
            .attr('rx', 2).attr('fill', 'none')
            .attr('stroke', POINT_COLOR_BENCHMARK).attr('stroke-dasharray', '3 2').attr('stroke-width', 2);
        bmG.append('text').attr('x', 18).attr('y', 11).text('Benchmark');

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
                const header = row.isBenchmark ? 'Benchmark' : `Point: ${row.pointLabel}`;
                const lines = row.segments.map(seg => {
                    const isHovered  = seg.grp === hoveredGrp;
                    const isExpanded = seg.grp === expandedGrp;
                    const pct = `${(seg.share * 100).toFixed(1)}%`;
                    const groupLine  = isHovered
                        ? `<b>${seg.grp}: ${pct}</b>`
                        : `${seg.grp}: ${pct}`;
                    if (isExpanded) {
                        const varLines = seg.varSegs.map(v => {
                            const vPct = `${(v.shareOfTotal * 100).toFixed(2)}%`;
                            return v.col === activeVar
                                ? `&nbsp;&nbsp;<b>${v.col}: ${vPct}</b>`
                                : `&nbsp;&nbsp;${v.col}: ${vPct}`;
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
                        .on('click', () => {
                            const next = new Set(_legendExpandedGroups.get(containerSelector) ?? new Set());
                            next.has(seg.grp) ? next.delete(seg.grp) : next.add(seg.grp);
                            _legendExpandedGroups.set(containerSelector, next);
                            renderBarChart(containerSelector, columns, data, options);
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
                    const segRect = groupArea.append('rect')
                        .attr('class', 'bar-group-seg bar-chart-segment')
                        .attr('data-row-index', row.rowIndex)
                        .attr('data-group', seg.grp)
                        .attr('x', 0)
                        .attr('y', animate ? yScale(0) : yScale(seg.y1))
                        .attr('width', xScale.bandwidth())
                        .attr('height', animate ? 0 : yScale(seg.y0) - yScale(seg.y1))
                        .attr('fill', getGroupBaseColor(seg.gi));

                    if (animate) {
                        segRect.transition(transition)
                            .attr('y', yScale(seg.y1))
                            .attr('height', yScale(seg.y0) - yScale(seg.y1));
                    }

                    // Variable sub-layer (hidden; shown via CSS .is-expanded on parent)
                    const varLayer = groupArea.append('g').attr('class', 'bar-var-layer');

                    seg.varSegs.forEach(v => {
                        const varRect = varLayer.append('rect')
                            .attr('class', 'bar-chart-segment')
                            .attr('data-row-index', row.rowIndex)
                            .attr('x', 0)
                            .attr('y', animate ? yScale(0) : yScale(v.y1))
                            .attr('width', xScale.bandwidth())
                            .attr('height', animate ? 0 : yScale(v.y0) - yScale(v.y1))
                            .attr('fill', getVariableColor(v.gi, v.vi, v.members.length))
                            .on('mouseenter', event => {
                                tooltip.classed('visible', true)
                                    .html(buildGroupTooltip(row, seg.grp, seg.grp, v.col));
                                positionTooltip(event);
                            })
                            .on('mousemove', event => positionTooltip(event));

                        if (animate) {
                            varRect.transition(transition)
                                .attr('y', yScale(v.y1))
                                .attr('height', yScale(v.y0) - yScale(v.y1));
                        }
                    });
                });

                // Benchmark outline
                if (row.isBenchmark) {
                    const bmRect = barG.append('rect')
                        .attr('class', 'bar-benchmark-outline')
                        .attr('data-row-index', row.rowIndex)
                        .attr('x', 0).attr('width', xScale.bandwidth())
                        .attr('y', animate ? yScale(0) : yScale(1))
                        .attr('height', animate ? 0 : yScale(0) - yScale(1));

                    if (animate) {
                        bmRect.transition(transition)
                            .attr('y', yScale(1))
                            .attr('height', yScale(0) - yScale(1));
                    }
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
                .attr('y', seg => animate ? yScale(0) : yScale(seg.y1))
                .attr('width', xScale.bandwidth())
                .attr('height', seg => animate ? 0 : yScale(seg.y0) - yScale(seg.y1))
                .attr('fill', seg => colorScale(seg.key))
                .on('mouseenter', (event, seg) => {
                    onHoverStart(seg.rowIndex);
                    const lines = seg.allSegments
                        .map(s => `${s.key}: ${(s.share * 100).toFixed(2)}%`).join('<br>');
                    tooltip.classed('visible', true)
                        .html(`${seg.isBenchmark ? 'Benchmark' : `Point: ${seg.pointLabel}`}<br>${lines}`);
                    positionTooltip(event);
                })
                .on('mousemove', event => positionTooltip(event))
                .on('mouseleave', () => { onHoverEnd(); tooltip.classed('visible', false); });

            barGroup.filter(r => r.isBenchmark)
                .append('rect')
                .attr('class', 'bar-benchmark-outline')
                .attr('data-row-index', r => r.rowIndex)
                .attr('x', 0).attr('width', xScale.bandwidth())
                .attr('y', animate ? yScale(0) : yScale(1))
                .attr('height', animate ? 0 : yScale(0) - yScale(1));

            if (animate) {
                barGroup.selectAll('rect.bar-chart-segment')
                    .transition(transition)
                    .attr('y', seg => yScale(seg.y1))
                    .attr('height', seg => yScale(seg.y0) - yScale(seg.y1));
                barGroup.selectAll('rect.bar-benchmark-outline')
                    .transition(transition).attr('y', yScale(1)).attr('height', yScale(0) - yScale(1));
            }
        }

        applyBarChartHighlight(getActiveRowIndex());
        applyBarChartSelection(getEffectiveSelection());
        return;
    }

    // ── Incremental animated update (flat / no-groups mode only) ─────────────

    const svg = existingSvg.select('g.chart-root');
    svg.select('.x-axis').transition(transition).call(xAxis);

    const barsRoot    = svg.select('.bars-root');
    const barGroupSel = barsRoot.selectAll('g.bar-chart-bar').data(rows, r => r.rowIndex);

    barGroupSel.exit()
        .selectAll('rect.bar-chart-segment, rect.bar-benchmark-outline')
        .transition(transition).attr('y', yScale(0)).attr('height', 0);
    barGroupSel.exit().transition(transition).remove();

    const barGroupEnter = barGroupSel.enter()
        .append('g')
        .attr('class', r => r.isBenchmark ? 'bar-chart-bar is-benchmark' : 'bar-chart-bar')
        .attr('data-row-index', r => r.rowIndex)
        .attr('transform', r => `translate(${xScale(r.pointLabel)}, 0)`);

    const barGroupMerge = barGroupEnter.merge(barGroupSel);
    barGroupMerge.transition(transition).attr('transform', r => `translate(${xScale(r.pointLabel)}, 0)`);

    barGroupMerge.each(function (row) {
        const g = d3.select(this);
        const segData = row.segments.map(seg => ({
            ...seg, rowIndex: row.rowIndex, pointLabel: row.pointLabel, allSegments: row.segments,
        }));

        const segSel = g.selectAll('rect.bar-chart-segment').data(segData, seg => seg.key);

        segSel.exit().transition(transition).attr('y', yScale(0)).attr('height', 0).remove();

        const segEnter = segSel.enter()
            .append('rect')
            .attr('class', 'bar-chart-segment')
            .attr('data-row-index', seg => seg.rowIndex)
            .attr('x', 0).attr('y', yScale(0)).attr('width', xScale.bandwidth()).attr('height', 0)
            .attr('fill', seg => colorScale(seg.key))
            .on('mouseenter', (event, seg) => {
                onHoverStart(seg.rowIndex);
                const lines = seg.allSegments.map(s => `${s.key}: ${(s.share * 100).toFixed(2)}%`).join('<br>');
                tooltip.classed('visible', true)
                    .html(`${seg.isBenchmark ? 'Benchmark' : `Point: ${seg.pointLabel}`}<br>${lines}`);
                positionTooltip(event);
            })
            .on('mousemove', event => positionTooltip(event))
            .on('mouseleave', () => { onHoverEnd(); tooltip.classed('visible', false); });

        segEnter.merge(segSel)
            .transition(transition)
            .attr('y', seg => yScale(seg.y1))
            .attr('height', seg => yScale(seg.y0) - yScale(seg.y1))
            .attr('width', xScale.bandwidth())
            .attr('fill', seg => colorScale(seg.key));

        if (row.isBenchmark) {
            let outline = g.select('rect.bar-benchmark-outline');
            if (outline.empty()) {
                outline = g.append('rect').attr('class', 'bar-benchmark-outline')
                    .attr('data-row-index', row.rowIndex)
                    .attr('x', 0).attr('y', yScale(0)).attr('height', 0);
            }
            outline.attr('width', xScale.bandwidth())
                .transition(transition).attr('y', yScale(1)).attr('height', yScale(0) - yScale(1));
        }
    });

    applyBarChartHighlight(getActiveRowIndex());
    applyBarChartSelection(getEffectiveSelection());
}
