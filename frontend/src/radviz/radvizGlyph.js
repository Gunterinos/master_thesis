import * as d3 from 'd3';

export const DEC_COLORS = ['#4f8cff', '#ff9500', '#34c759', '#ff3b30', '#af52de', '#5ac8fa'];
export const MINI_R = 8;
export const DONUT_OUTER = 58;
export const DONUT_INNER = 34;

/**
 * Draw the glyph contents for a single RadViz point.
 *
 * Collapsed: a mini pie chart (radius MINI_R) showing decision-variable proportions.
 * Expanded:  a donut ring with per-slice hover tooltips and objective scores in the centre.
 */
export function renderGlyph(glyphG, point, decisionColumns, expandedRowIndex, tooltip) {
    glyphG.selectAll('*').remove();

    const pieData = decisionColumns.map((col, i) => ({
        col,
        val: Math.max(+point.row[col] || 0, 0.01),
        color: DEC_COLORS[i % DEC_COLORS.length],
    }));

    const isExpanded = expandedRowIndex === point.rowIndex;

    if (isExpanded) {
        glyphG.classed('radviz-point--expanded', true);

        const donutArc = d3.arc().innerRadius(DONUT_INNER).outerRadius(DONUT_OUTER);
        const pieLayout = d3.pie().sort(null).value((d) => d.val);

        pieLayout(pieData).forEach((slice) => {
            glyphG.append('path')
                .attr('class', 'radviz-slice')
                .attr('d', donutArc(slice))
                .attr('fill', slice.data.color)
                .on('mouseenter', (event) => {
                    tooltip.classed('visible', true)
                        .html(`<b>${slice.data.col}</b><br>${(+point.row[slice.data.col]).toFixed(3)}`)
                        .style('left', `${event.pageX + 12}px`)
                        .style('top', `${event.pageY - 36}px`);
                })
                .on('mousemove', (event) => {
                    tooltip.style('left', `${event.pageX + 12}px`).style('top', `${event.pageY - 36}px`);
                })
                .on('mouseleave', () => tooltip.classed('visible', false));
        });

        const objColumns = Object.keys(point.row).filter(
            k => !k.startsWith('__') && !decisionColumns.includes(k) && Number.isFinite(+point.row[k])
        );
        const lineH = 13;
        const totalH = objColumns.length * lineH;
        objColumns.forEach((col, i) => {
            glyphG.append('text')
                .attr('class', 'radviz-obj-label')
                .attr('x', 0)
                .attr('y', -totalH / 2 + i * lineH + lineH * 0.75)
                .attr('text-anchor', 'middle')
                .text(`${col} ${(+point.row[col]).toFixed(2)}`);
        });

        glyphG.append('circle').attr('class', 'radviz-selection-ring').attr('r', DONUT_OUTER + 3);
        if (point.row.__isBenchmark) {
            glyphG.append('circle').attr('class', 'radviz-benchmark-ring').attr('r', DONUT_OUTER + 7);
        }
    } else {
        glyphG.classed('radviz-point--expanded', false);

        const miniArc = d3.arc().innerRadius(0).outerRadius(MINI_R);
        const pieLayout = d3.pie().sort(null).value((d) => d.val);

        pieLayout(pieData).forEach((slice) => {
            glyphG.append('path')
                .attr('class', 'radviz-slice')
                .attr('d', miniArc(slice))
                .attr('fill', slice.data.color);
        });

        glyphG.append('circle').attr('class', 'radviz-selection-ring').attr('r', MINI_R + 3);
        if (point.row.__isBenchmark) {
            glyphG.append('circle').attr('class', 'radviz-benchmark-ring').attr('r', MINI_R + 1);
        }
    }
}
