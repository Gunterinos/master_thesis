import * as d3 from 'd3';
import './correlationHeatmap.css';
import { formatLabel } from '../formatLabel.js';
import { computeFrontierColors } from '../colors.js';

function pearson(xs, ys) {
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < xs.length; i++) {
        const x = +xs[i];
        const y = +ys[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        n++;
        sx += x; sy += y;
        sxx += x * x; syy += y * y;
        sxy += x * y;
    }
    if (n < 2) return NaN;
    const cov = sxy - (sx * sy) / n;
    const vx = sxx - (sx * sx) / n;
    const vy = syy - (sy * sy) / n;
    const denom = Math.sqrt(vx * vy);
    if (denom === 0) return NaN;
    return cov / denom;
}

function buildMatrix(rows, vars) {
    const columnValues = vars.map((v) => rows.map((r) => +r[v]));
    const n = vars.length;
    const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        matrix[i][i] = 1;
        for (let j = i + 1; j < n; j++) {
            const r = pearson(columnValues[i], columnValues[j]);
            matrix[i][j] = r;
            matrix[j][i] = r;
        }
    }
    return matrix;
}

function corrToT(r) {
    if (!Number.isFinite(r)) return 0.5;
    return (Math.max(-1, Math.min(1, r)) + 1) / 2;
}

function getTooltip(id) {
    let tip = d3.select(`#${id}`);
    if (tip.empty()) {
        tip = d3.select('body').append('div')
            .attr('id', id)
            .attr('class', 'corr-heatmap-tooltip');
    }
    return tip;
}

function renderStandaloneLegend(containerEl, gradId) {
    const legendBarW = 14;
    const legendBarH = 200;
    const tickColW = 36;
    const svgW = legendBarW + tickColW;
    const svgH = legendBarH;

    const svg = d3.select(containerEl).append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('viewBox', `0 0 ${svgW} ${svgH}`)
        .attr('preserveAspectRatio', 'xMidYMid meet');

    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
        .attr('id', gradId)
        .attr('x1', '0%').attr('y1', '100%')
        .attr('x2', '0%').attr('y2', '0%');
    for (let s = 0; s <= 10; s++) {
        const t = s / 10;
        gradient.append('stop')
            .attr('offset', `${t * 100}%`)
            .attr('stop-color', d3.interpolateCividis(t));
    }

    const g = svg.append('g');

    g.append('rect')
        .attr('width', legendBarW)
        .attr('height', legendBarH)
        .attr('fill', `url(#${gradId})`)
        .attr('stroke', 'var(--color-axis-line)');

    g.selectAll('text')
        .data([-1, -0.5, 0, 0.5, 1])
        .enter().append('text')
        .attr('class', 'corr-heatmap-legend-tick')
        .attr('x', legendBarW + 4)
        .attr('y', (d) => legendBarH * (1 - (d + 1) / 2))
        .attr('dy', '0.35em')
        .text((d) => d.toFixed(1));

    g.append('text')
        .attr('class', 'corr-heatmap-legend-label')
        .attr('x', legendBarW - 15)
        .attr('y', -14)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .text('Positive');

    g.append('text')
        .attr('class', 'corr-heatmap-legend-label')
        .attr('x', legendBarW - 15)
        .attr('y', legendBarH + 14)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .text('Negative');
}

export function renderCorrelationHeatmap(containerSelector, columns, data, options = {}) {
    const { decisionColumns = [], frontierOrder = null, _isSubRender = false, _hideLegend = false, _forcedCellSize = null } = options;

    const container = d3.select(containerSelector);
    const containerNode = container.node();
    if (!containerNode) return;

    if (!_isSubRender) {
        if (containerNode._corrHeatmapObserver) {
            containerNode._corrHeatmapObserver.disconnect();
        }
        const observer = new ResizeObserver(() => {
            if (!document.contains(containerNode) || !containerNode.querySelector('.corr-heatmap, .corr-heatmap-multi-wrapper')) {
                observer.disconnect();
                return;
            }
            const w = containerNode.clientWidth;
            const h = containerNode.clientHeight;
            if (w === containerNode._corrRenderedW && h === containerNode._corrRenderedH) return;
            renderCorrelationHeatmap(containerSelector, columns, data, options);
        });
        observer.observe(containerNode);
        containerNode._corrHeatmapObserver = observer;
        containerNode._corrRenderedW = containerNode.clientWidth;
        containerNode._corrRenderedH = containerNode.clientHeight;

        // Multi-frontier: group data by __frontier and render one heatmap per frontier
        const frontierNames = [];
        for (const row of data) {
            if (row.__isBenchmark) continue;
            const name = row.__frontier ?? 'Unknown';
            if (!frontierNames.includes(name)) frontierNames.push(name);
        }
        if (frontierNames.length > 1) {
            container.selectAll('*').remove();
            const wrapper = container.append('div').attr('class', 'corr-heatmap-multi-wrapper');
            const heatmapsRow = wrapper.append('div').attr('class', 'corr-heatmap-heatmaps-row');

            // Compute a single shared cell size so both heatmaps are visually identical
            const sharedVariables = [...decisionColumns, ...columns];
            const n = frontierNames.length;
            const legendW = 56 + 16; // legend bar width + margin-left from CSS
            const gapPx = 8;
            const labelH = 24;
            const totalW = containerNode.clientWidth || 0;
            const totalH = containerNode.clientHeight || 0;
            const charPx = 6;
            const longestLabel = d3.max(sharedVariables, v => formatLabel(v).length) || 1;
            const sharedLeftPad = Math.min(100, Math.max(40, longestLabel * charPx * 0.7 + 8));
            const sharedTopPad = Math.min(80, Math.max(30, longestLabel * charPx * 0.4 + 8));
            const hasBothSections = decisionColumns.length > 0 && columns.length > 0;
            const sharedBottomPad = hasBothSections ? 36 : 12;
            const rightPad = 16;
            const subW = Math.max(200, (totalW - legendW - gapPx * (n - 1)) / n);
            const subH = Math.max(300, totalH - labelH);
            const sharedGridW = Math.max(50, subW - sharedLeftPad - rightPad);
            const sharedGridH = Math.max(50, subH - sharedTopPad - sharedBottomPad);
            const sharedCellSize = Math.max(8, Math.min(
                sharedGridW / sharedVariables.length,
                sharedGridH / sharedVariables.length,
            ));

            const { items } = computeFrontierColors(data, frontierOrder);
            const colorByName = new Map(items.map(({ label, color }) => [label, color]));
            frontierNames.forEach((fname) => {
                const subData = data.filter(row => row.__isBenchmark || (row.__frontier ?? 'Unknown') === fname);
                const subId = `corr-sub-${Math.abs([...containerSelector + fname].reduce((a, c) => a + c.charCodeAt(0), 0))}`;
                const subWrapper = heatmapsRow.append('div').attr('class', 'corr-heatmap-sub-wrapper');
                subWrapper.append('div')
                    .attr('class', 'corr-heatmap-sub-container')
                    .attr('id', subId);
                const labelRow = subWrapper.append('div').attr('class', 'corr-heatmap-frontier-label');
                labelRow.append('span')
                    .attr('class', 'corr-heatmap-frontier-dot')
                    .style('background', colorByName.get(fname) ?? '#888');
                labelRow.append('span').text(fname);
                renderCorrelationHeatmap(`#${subId}`, columns, subData, {
                    ...options, _isSubRender: true, _hideLegend: true, _forcedCellSize: sharedCellSize,
                });
            });
            const legendContainer = wrapper.append('div').attr('class', 'corr-heatmap-legend-container');
            const gradId = `corr-grad-multi-${Math.abs([...containerSelector].reduce((a, c) => a + c.charCodeAt(0), 0))}`;
            renderStandaloneLegend(legendContainer.node(), gradId);
            return;
        }
    }

    const rows = data.slice();

    const variables = [...decisionColumns, ...columns];
    if (variables.length < 2) {
        container.selectAll('*').remove();
        container.append('p').text('Need at least 2 numeric columns.');
        return;
    }

    const matrix = buildMatrix(rows, variables);

    const containerW = Math.max(440, containerNode.clientWidth || 0);
    const containerH = Math.max(300, containerNode.clientHeight || 0);

    const charPx = 6;
    const longestLabel = d3.max(variables, (v) => formatLabel(v).length) || 1;
    const leftPad = Math.min(100, Math.max(40, longestLabel * charPx * 0.7 + 8));
    const topPad = Math.min(80, Math.max(30, longestLabel * charPx * 0.4 + 8));
    const legendWidth = _hideLegend ? 0 : 56;
    const rightPad = 16;
    const hasBothSections = decisionColumns.length > 0 && columns.length > 0;
    const bottomPad = hasBothSections ? 36 : 12;

    const gridW = Math.max(50, containerW - leftPad - legendWidth - rightPad);
    const gridH = Math.max(50, containerH - topPad - bottomPad);
    const cellSize = _forcedCellSize ?? Math.max(8, Math.min(gridW / variables.length, gridH / variables.length));
    const actualGridSize = cellSize * variables.length;

    const svgW = leftPad + actualGridSize + legendWidth + rightPad;
    const svgH = topPad + actualGridSize + bottomPad;

    container.selectAll('*').remove();
    const svg = container.append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('viewBox', `0 0 ${svgW} ${svgH}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('class', 'corr-heatmap');

    const tipId = `corr-tip-${Math.abs([...containerSelector].reduce((a, c) => a + c.charCodeAt(0), 0))}`;
    const tooltip = getTooltip(tipId);

    const gridG = svg.append('g')
        .attr('transform', `translate(${leftPad}, ${topPad})`);

    const showText = cellSize >= 28;

    for (let i = 0; i < variables.length; i++) {
        for (let j = 0; j <= i; j++) {
            const isDiag = i === j;
            const r = matrix[i][j];
            const t = corrToT(r);
            const fill = isDiag ? 'var(--color-heatmap-diag)' : d3.interpolateCividis(t);

            const cell = gridG.append('rect')
                .attr('class', isDiag ? 'corr-heatmap-cell corr-heatmap-cell--diag' : 'corr-heatmap-cell')
                .attr('x', j * cellSize)
                .attr('y', i * cellSize)
                .attr('width', cellSize)
                .attr('height', cellSize)
                .attr('fill', fill);

            if (!isDiag) {
                cell
                    .on('mousemove', (event) => {
                        tooltip
                            .classed('visible', true)
                            .html(`<strong>${formatLabel(variables[i])}</strong> × <strong>${formatLabel(variables[j])}</strong><br/>${Number.isFinite(r) ? r.toFixed(3) : 'n/a'}`)
                            .style('left', `${event.clientX + 14}px`)
                            .style('top', `${event.clientY - 28}px`);
                    })
                    .on('mouseleave', () => tooltip.classed('visible', false));
            }

            if (showText && !isDiag) {
                gridG.append('text')
                    .attr('class', 'corr-heatmap-cell-text')
                    .attr('x', j * cellSize + cellSize / 2)
                    .attr('y', i * cellSize + cellSize / 2)
                    .attr('dy', '0.35em')
                    .attr('fill', t > 0.5 ? '#1d1d1f' : '#ffffff')
                    .attr('pointer-events', 'none')
                    .text(Number.isFinite(r) ? r.toFixed(2) : '—');
            }
        }
    }

    const rowLabels = svg.append('g')
        .attr('transform', `translate(${leftPad - 6}, ${topPad})`);
    rowLabels.selectAll('text')
        .data(variables)
        .enter().append('text')
        .attr('class', 'corr-heatmap-axis-label')
        .attr('transform', (_d, i) => `translate(0, ${i * cellSize + cellSize / 2}) rotate(-45)`)
        .attr('text-anchor', 'end')
        .text((d) => formatLabel(d));

    const colLabels = svg.append('g')
        .attr('transform', `translate(${leftPad}, ${topPad})`);
    colLabels.selectAll('text')
        .data(variables)
        .enter().append('text')
        .attr('class', 'corr-heatmap-axis-label')
        .attr('transform', (_d, i) => `translate(${i * cellSize + cellSize / 2}, ${i * cellSize - 4}) rotate(-45)`)
        .attr('text-anchor', 'start')
        .text((d) => formatLabel(d));

    if (hasBothSections) {
        const splitX = decisionColumns.length * cellSize;

        gridG.append('line')
            .attr('class', 'corr-heatmap-separator')
            .attr('x1', splitX).attr('y1', splitX)
            .attr('x2', splitX).attr('y2', actualGridSize);

        const labelsG = svg.append('g')
            .attr('transform', `translate(${leftPad}, ${topPad + actualGridSize + 20})`);

        labelsG.append('text')
            .attr('class', 'corr-heatmap-section-label')
            .attr('x', splitX / 2)
            .attr('text-anchor', 'middle')
            .text('Decision Variables');

        labelsG.append('text')
            .attr('class', 'corr-heatmap-section-label')
            .attr('x', splitX + (actualGridSize - splitX) / 2)
            .attr('text-anchor', 'middle')
            .text('Objectives');
    }

    if (!_hideLegend) {
        const legendBarW = 14;
        const legendBarH = Math.min(actualGridSize, 260);
        const legendOffsetY = topPad + (actualGridSize - legendBarH) / 2;

        const legendG = svg.append('g')
            .attr('class', 'corr-heatmap-legend')
            .attr('transform', `translate(${leftPad + actualGridSize + 12}, ${legendOffsetY})`);
        const gradId = `corr-grad-${Math.abs([...containerSelector].reduce((a, c) => a + c.charCodeAt(0), 0))}`;
        const defs = svg.append('defs');
        const gradient = defs.append('linearGradient')
            .attr('id', gradId)
            .attr('x1', '0%').attr('y1', '100%')
            .attr('x2', '0%').attr('y2', '0%');
        for (let s = 0; s <= 10; s++) {
            const t = s / 10;
            gradient.append('stop')
                .attr('offset', `${t * 100}%`)
                .attr('stop-color', d3.interpolateCividis(t));
        }
        legendG.append('rect')
            .attr('width', legendBarW)
            .attr('height', legendBarH)
            .attr('fill', `url(#${gradId})`)
            .attr('stroke', 'var(--color-axis-line)');

        legendG.selectAll('text')
            .data([-1, -0.5, 0, 0.5, 1])
            .enter().append('text')
            .attr('class', 'corr-heatmap-legend-tick')
            .attr('x', legendBarW + 4)
            .attr('y', (d) => legendBarH * (1 - (d + 1) / 2))
            .attr('dy', '0.35em')
            .text((d) => d.toFixed(1));

        legendG.append('text')
            .attr('class', 'corr-heatmap-legend-label')
            .attr('x', legendBarW / 2)
            .attr('y', -10)
            .attr('text-anchor', 'middle')
            .text('Positive');

        legendG.append('text')
            .attr('class', 'corr-heatmap-legend-label')
            .attr('x', legendBarW / 2)
            .attr('y', legendBarH + 18)
            .attr('text-anchor', 'middle')
            .text('Negative');
    }
}
