import * as d3 from 'd3';
import './correlationHeatmap.css';

const _dataCache = new Map();

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

export function renderCorrelationHeatmap(containerSelector, columns, data, options = {}) {
    const { decisionColumns = [] } = options;

    const container = d3.select(containerSelector);
    const containerNode = container.node();
    if (!containerNode) return;

    if (containerNode._corrHeatmapObserver) {
        containerNode._corrHeatmapObserver.disconnect();
    }
    const observer = new ResizeObserver(() => {
        if (!document.contains(containerNode)) {
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

    let rows = _dataCache.get(containerSelector);
    if (!rows) {
        rows = data.slice();
        _dataCache.set(containerSelector, rows);
    }

    const variables = [...decisionColumns, ...columns];
    if (variables.length < 2) {
        container.selectAll('*').remove();
        container.append('p').text('Need at least 2 numeric columns.');
        return;
    }

    const matrix = buildMatrix(rows, variables);

    const width = Math.max(440, containerNode.clientWidth || 0);
    const height = Math.max(300, containerNode.clientHeight || 0);

    const charPx = 6;
    const longestLabel = d3.max(variables, (v) => v.length) || 1;
    const leftPad = Math.min(140, Math.max(60, longestLabel * charPx + 8));
    const topPad = Math.min(140, Math.max(60, longestLabel * charPx * 0.75 + 8));
    const legendWidth = 56;
    const rightPad = 16;
    const bottomPad = topPad;

    const gridW = Math.max(50, width - leftPad - legendWidth - rightPad);
    const gridH = Math.max(50, height - topPad - bottomPad);
    const cellSize = Math.max(8, Math.min(gridW / variables.length, gridH / variables.length));
    const actualGridSize = cellSize * variables.length;

    container.selectAll('*').remove();
    const svg = container.append('svg')
        .attr('width', width)
        .attr('height', height)
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
                            .html(`<strong>${variables[i]}</strong> × <strong>${variables[j]}</strong><br/>${Number.isFinite(r) ? r.toFixed(3) : 'n/a'}`)
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
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .text((d) => d);

    const colLabels = svg.append('g')
        .attr('transform', `translate(${leftPad}, ${topPad + actualGridSize + 12})`);
    colLabels.selectAll('text')
        .data(variables)
        .enter().append('text')
        .attr('class', 'corr-heatmap-axis-label')
        .attr('transform', (_d, i) => `translate(${i * cellSize + cellSize / 2 + 10}, 0) rotate(-45)`)
        .attr('text-anchor', 'end')
        .text((d) => d);

    const legendG = svg.append('g')
        .attr('class', 'corr-heatmap-legend')
        .attr('transform', `translate(${leftPad + actualGridSize + 12}, ${topPad})`);

    const legendBarW = 14;
    const legendBarH = Math.min(actualGridSize, 260);
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
