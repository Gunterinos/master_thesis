import * as d3 from 'd3';
import { CB_PALETTE, getGroupBaseColor, getVariableColor, getGroupOrder, getGroupMembers } from '../colors.js';

export const DEC_COLORS = CB_PALETTE;
export const MINI_R     = 8;
export const DONUT_OUTER = 58;
export const DONUT_INNER = 34;

/**
 * Draw the glyph contents for a single RadViz point.
 *
 * Collapsed: mini pie (radius MINI_R). Uses group base colours when groups provided.
 *
 * Expanded: full-chart donut (radius derived from glyphR).
 *   - Default: one arc per group (summed allocation).
 *   - Click a group arc → inner ring shows variable breakdown for that group.
 *
 * options:
 *   groups              { colName: groupName } — group membership map
 *   glyphR              number — chart radius R; drives dynamic donut sizing
 *   expandedGlyphGroup  string|null — group currently expanded in the inner ring
 *   onGlyphGroupToggle  (groupName) => void — called when user clicks a group arc
 */
export function renderGlyph(glyphG, point, decisionColumns, expandedRowIndex, tooltip, options = {}) {
    const { groups = {}, glyphR = null, expandedGlyphGroup = null, onGlyphGroupToggle = () => {} } = options;

    glyphG.selectAll('*').remove();

    const hasGroups = groups && Object.keys(groups).length > 0;

    // ── Colour helpers ────────────────────────────────────────────────────────

    function sliceColor(col, index) {
        if (!hasGroups) return DEC_COLORS[index % DEC_COLORS.length];
        const groupOrder = getGroupOrder(decisionColumns, groups);
        const grp = groups[col];
        const gi = groupOrder.indexOf(grp);
        const members = getGroupMembers(decisionColumns, groups)[grp] || [];
        const vi = members.indexOf(col);
        return getVariableColor(gi, vi, members.length);
    }

    function groupColor(grp) {
        if (!hasGroups) return DEC_COLORS[0];
        const groupOrder = getGroupOrder(decisionColumns, groups);
        return getGroupBaseColor(groupOrder.indexOf(grp));
    }

    // ── Pie data ──────────────────────────────────────────────────────────────

    const pieData = decisionColumns.map((col, i) => ({
        col, val: Math.max(+point.row[col] || 0, 0.01), color: sliceColor(col, i),
    }));

    const isExpanded = expandedRowIndex === point.rowIndex;

    // ── Collapsed mini pie ────────────────────────────────────────────────────

    if (!isExpanded) {
        glyphG.classed('radviz-point--expanded', false);

        // When groups provided, aggregate per group for the mini pie
        const miniSlices = hasGroups
            ? (() => {
                const groupOrder = getGroupOrder(decisionColumns, groups);
                const members = getGroupMembers(decisionColumns, groups);
                return groupOrder.map((grp, gi) => ({
                    col: grp,
                    val: Math.max((members[grp] || []).reduce((s, col) => s + (+point.row[col] || 0), 0), 0.01),
                    color: getGroupBaseColor(gi),
                }));
            })()
            : pieData;

        const miniArc = d3.arc().innerRadius(0).outerRadius(MINI_R);
        const pieLayout = d3.pie().sort(null).value(d => d.val);
        pieLayout(miniSlices).forEach(slice => {
            glyphG.append('path')
                .attr('class', 'radviz-slice')
                .attr('d', miniArc(slice))
                .attr('fill', slice.data.color);
        });

        glyphG.append('circle').attr('class', 'radviz-selection-ring').attr('r', MINI_R + 3);
        if (point.row.__isBenchmark) {
            glyphG.append('circle').attr('class', 'radviz-benchmark-ring').attr('r', MINI_R + 1);
        }
        return;
    }

    // ── Expanded donut ────────────────────────────────────────────────────────

    glyphG.classed('radviz-point--expanded', true);

    const dynOuter = glyphR ? Math.floor(glyphR * 0.82) : DONUT_OUTER;
    const dynInner = glyphR ? Math.floor(glyphR * 0.46) : DONUT_INNER;
    const varRingInner = Math.floor(dynInner * 0.52);

    if (hasGroups) {
        // ── Group-level outer donut ───────────────────────────────────────────

        const groupOrder = getGroupOrder(decisionColumns, groups);
        const membersMap = getGroupMembers(decisionColumns, groups);

        const groupSliceData = groupOrder.map((grp, gi) => ({
            grp,
            val: Math.max((membersMap[grp] || []).reduce((s, col) => s + (+point.row[col] || 0), 0), 0.001),
            color: getGroupBaseColor(gi),
        }));

        const donutArc  = d3.arc().innerRadius(dynInner).outerRadius(dynOuter);
        const pieLayout = d3.pie().sort(null).value(d => d.val);
        const groupArcs = pieLayout(groupSliceData);

        groupArcs.forEach(slice => {
            glyphG.append('path')
                .attr('class', 'radviz-slice radviz-group-slice')
                .attr('d', donutArc(slice))
                .attr('fill', slice.data.color)
                .style('cursor', 'pointer')
                .on('mouseenter', event => {
                    tooltip.classed('visible', true)
                        .html(`<b>${slice.data.grp}</b><br>${(+slice.data.val).toFixed(3)}`)
                        .style('left', `${event.pageX + 12}px`)
                        .style('top',  `${event.pageY - 36}px`);
                })
                .on('mousemove', event => {
                    tooltip.style('left', `${event.pageX + 12}px`).style('top', `${event.pageY - 36}px`);
                })
                .on('mouseleave', () => tooltip.classed('visible', false))
                .on('click', event => {
                    event.stopPropagation();
                    onGlyphGroupToggle(slice.data.grp);
                });
        });

        // ── Variable inner ring for the expanded group ────────────────────────

        if (expandedGlyphGroup && membersMap[expandedGlyphGroup]) {
            const expandedArc = groupArcs.find(a => a.data.grp === expandedGlyphGroup);
            if (expandedArc) {
                const members = membersMap[expandedGlyphGroup];
                const gi = groupOrder.indexOf(expandedGlyphGroup);
                const varArc = d3.arc().innerRadius(varRingInner).outerRadius(dynInner - 2);

                // Distribute variable arcs within the group's angular range
                const totalVal = members.reduce((s, col) => s + (+point.row[col] || 0), 0) || 1;
                const angleRange = expandedArc.endAngle - expandedArc.startAngle;
                let cumAngle = expandedArc.startAngle;

                members.forEach((col, vi) => {
                    const val = +point.row[col] || 0;
                    const arc = angleRange * (val / totalVal);
                    const slice = { startAngle: cumAngle, endAngle: cumAngle + arc, data: { col } };
                    cumAngle += arc;

                    glyphG.append('path')
                        .attr('class', 'radviz-slice radviz-var-slice')
                        .attr('d', varArc(slice))
                        .attr('fill', getVariableColor(gi, vi, members.length))
                        .on('mouseenter', event => {
                            tooltip.classed('visible', true)
                                .html(`<b>${col}</b><br>${val.toFixed(3)}`)
                                .style('left', `${event.pageX + 12}px`)
                                .style('top',  `${event.pageY - 36}px`);
                        })
                        .on('mousemove', event => {
                            tooltip.style('left', `${event.pageX + 12}px`).style('top', `${event.pageY - 36}px`);
                        })
                        .on('mouseleave', () => tooltip.classed('visible', false));
                });
            }
        }

    } else {
        // ── No groups: original per-variable donut ────────────────────────────

        const donutArc  = d3.arc().innerRadius(dynInner).outerRadius(dynOuter);
        const pieLayout = d3.pie().sort(null).value(d => d.val);

        pieLayout(pieData).forEach(slice => {
            glyphG.append('path')
                .attr('class', 'radviz-slice')
                .attr('d', donutArc(slice))
                .attr('fill', slice.data.color)
                .on('mouseenter', event => {
                    tooltip.classed('visible', true)
                        .html(`<b>${slice.data.col}</b><br>${(+point.row[slice.data.col]).toFixed(3)}`)
                        .style('left', `${event.pageX + 12}px`)
                        .style('top',  `${event.pageY - 36}px`);
                })
                .on('mousemove', event => {
                    tooltip.style('left', `${event.pageX + 12}px`).style('top', `${event.pageY - 36}px`);
                })
                .on('mouseleave', () => tooltip.classed('visible', false));
        });
    }

    // ── Objective labels in the centre ────────────────────────────────────────

    const objColumns = Object.keys(point.row).filter(
        k => !k.startsWith('__') && !decisionColumns.includes(k) && Number.isFinite(+point.row[k])
    );
    const lineH  = 14;
    const totalH = objColumns.length * lineH;
    objColumns.forEach((col, i) => {
        glyphG.append('text')
            .attr('class', 'radviz-obj-label')
            .attr('x', 0)
            .attr('y', -totalH / 2 + i * lineH + lineH * 0.75)
            .attr('text-anchor', 'middle')
            .text(`${col} ${(+point.row[col]).toFixed(2)}`);
    });

    glyphG.append('circle').attr('class', 'radviz-selection-ring').attr('r', dynOuter + 3);
    if (point.row.__isBenchmark) {
        glyphG.append('circle').attr('class', 'radviz-benchmark-ring').attr('r', dynOuter + 7);
    }
}
