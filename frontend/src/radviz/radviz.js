import * as d3 from 'd3';
import './radviz.css';
import { subscribe, getActiveRowIndex, getEffectiveSelection } from '../state/appState.js';
import { computeRadvizPoints, computeEquilibrium, getTransform } from './radvizLayout.js';
import { renderGlyph, DEC_COLORS, MINI_R } from './radvizGlyph.js';

const LEGEND_W = 120;

// ── Per-container persistent state ──────────────────────────────────────────

const _radvizInstances = new Map(); // containerSelector → setSelection callback
const _expandedIndex   = new Map(); // containerSelector → rowIndex | null
const _prevPositions   = new Map(); // containerSelector → Map<rowIndex, {px, py}>
const _spreadValue     = new Map(); // containerSelector → 0..1
const _renderState     = new Map(); // containerSelector → { R, eqMap, maxGlyphR }

// ── Pub-sub wiring ──────────────────────────────────────────────────────────

function applyRadvizHighlight(rowIndex) {
    d3.selectAll('g.radviz-point[data-row-index]')
        .classed('is-linked-highlight', function () { return rowIndex !== null && Number(this.dataset.rowIndex) === rowIndex; })
        .classed('is-linked-dim', function () { return rowIndex !== null && Number(this.dataset.rowIndex) !== rowIndex; });
}

subscribe('hover-change', applyRadvizHighlight);

export function setRadvizSelection(rowIndexSet) {
    _radvizInstances.forEach((setSelection) => setSelection(rowIndexSet));
}

subscribe('selection-change', setRadvizSelection);

// ── Spread API (driven by the slider in spacePanel) ─────────────────────────

export function setRadvizSpread(containerSelector, s) {
    _spreadValue.set(containerSelector, s);
    const state = _renderState.get(containerSelector);
    if (!state) return;
    const { R, eqMap, maxGlyphR } = state;
    d3.select(containerSelector).selectAll('g.radviz-point[data-row-index]')
        .transition().duration(80).ease(d3.easeCubicInOut)
        .attr('transform', (p) => getTransform(p, s, R, eqMap, maxGlyphR));
}

// ── Main render ─────────────────────────────────────────────────────────────

export function renderRadviz(containerSelector, data, columns, options = {}) {
    const {
        onHoverStart = () => {},
        onHoverEnd = () => {},
        onSelectionChange = () => {},
        onShiftClick = () => {},
        animate = false,
    } = options;

    const container = d3.select(containerSelector);
    const containerNode = container.node();
    if (!containerNode) return;

    const decisionColumns = data.length > 0
        ? Object.keys(data[0]).filter(k => !k.startsWith('__') && !columns.includes(k) && Number.isFinite(+data[0][k]))
        : [];

    const expandedRowIndex = _expandedIndex.get(containerSelector) ?? null;
    const spread = _spreadValue.get(containerSelector) ?? 0;
    const rerender = () => renderRadviz(containerSelector, data, columns, options);

    // Snapshot current glyph positions before clearing DOM
    const prevPos = new Map();
    if (animate) {
        container.selectAll('g.radviz-point[data-row-index]').each(function () {
            const t = d3.select(this).attr('transform');
            const m = t && t.match(/translate\(([^,]+),([^)]+)\)/);
            if (m) prevPos.set(Number(this.dataset.rowIndex), { px: +m[1], py: +m[2] });
        });
        _prevPositions.set(containerSelector, prevPos);
    }

    container.selectAll('*').remove();

    const tooltip = d3
        .select('body')
        .selectAll('.scatter-tooltip')
        .data([null])
        .join('div')
        .attr('class', 'scatter-tooltip');

    // ── Geometry ─────────────────────────────────────────────────────────

    const containerWidth = Math.max(400, containerNode.clientWidth || 0);
    const containerHeight = Math.max(300, containerNode.clientHeight || 0);

    const availW = containerWidth - LEGEND_W;
    const labelPad = 52;
    const R = Math.min(availW, containerHeight) / 2 - labelPad;
    const cx = availW / 2;
    const cy = containerHeight / 2;

    const svg = container
        .append('svg')
        .attr('viewBox', `0 0 ${containerWidth} ${containerHeight}`)
        .attr('preserveAspectRatio', 'none');

    const g = svg.append('g').attr('transform', `translate(${cx}, ${cy})`);

    g.append('circle').attr('class', 'radviz-boundary').attr('r', R);

    // ── Layout computation ───────────────────────────────────────────────

    const { anchors, points } = computeRadvizPoints(data, columns);
    const vertices = anchors.map(({ ax, ay }) => [ax * R, ay * R]);
    const { nodes: eq, nodeRadius } = computeEquilibrium(points, R, vertices);
    const eqMap = new Map(eq.map(n => [n.rowIndex, n]));
    const maxGlyphR = nodeRadius * 0.7;

    _renderState.set(containerSelector, { R, eqMap, maxGlyphR });

    // ── Anchors ──────────────────────────────────────────────────────────

    anchors.forEach(({ col, ax, ay }) => {
        g.append('circle')
            .attr('class', 'radviz-anchor')
            .attr('cx', ax * R)
            .attr('cy', ay * R)
            .attr('r', 4);

        const labelR = R + 16;
        g.append('text')
            .attr('class', 'radviz-anchor-label')
            .attr('x', ax * labelR)
            .attr('y', ay * labelR)
            .attr('text-anchor', Math.abs(ax) < 0.1 ? 'middle' : ax > 0 ? 'start' : 'end')
            .attr('dominant-baseline', ay > 0.1 ? 'hanging' : ay < -0.1 ? 'auto' : 'middle')
            .text(col);
    });

    g.append('text')
        .attr('class', 'radviz-hint')
        .attr('x', R)
        .attr('y', R + labelPad - 8)
        .attr('text-anchor', 'end')
        .text('Shift+click to select \u00b7 click to inspect');

    // ── Legend ────────────────────────────────────────────────────────────

    if (decisionColumns.length > 0) {
        const itemH = 22;
        const legendX = availW + 12;
        const legendY = cy - (decisionColumns.length * itemH) / 2;

        const legendG = svg.append('g')
            .attr('class', 'radviz-legend')
            .attr('transform', `translate(${legendX}, ${legendY})`);

        legendG.append('text')
            .attr('class', 'radviz-legend-title')
            .attr('x', 0)
            .attr('y', -8)
            .text('Decision vars');

        decisionColumns.forEach((col, i) => {
            const row = legendG.append('g').attr('transform', `translate(0, ${i * itemH})`);
            row.append('rect')
                .attr('width', 12).attr('height', 12).attr('y', 0)
                .attr('fill', DEC_COLORS[i % DEC_COLORS.length]).attr('rx', 2);
            row.append('text')
                .attr('class', 'radviz-legend-label')
                .attr('x', 18).attr('y', 10)
                .text(col);
        });
    }

    // ── Lasso ────────────────────────────────────────────────────────────

    const lassoOverlay = g.append('circle').attr('class', 'radviz-lasso-layer').attr('r', R);
    const lassoPath = g.append('path').attr('class', 'radviz-lasso-path hidden');
    let lassoPoints = [];

    const updateLassoPath = () => {
        if (lassoPoints.length < 2) return;
        lassoPath.classed('hidden', false)
            .attr('d', `M${lassoPoints.map((p) => `${p[0]},${p[1]}`).join('L')}Z`);
    };

    const finalizeLasso = () => {
        if (lassoPoints.length < 3) { lassoPath.classed('hidden', true); lassoPoints = []; return; }
        const s = _spreadValue.get(containerSelector) ?? 0;
        const selected = points
            .filter((p) => {
                const rx = p.x * R, ry = p.y * R;
                if (s < 0.001) return d3.polygonContains(lassoPoints, [rx, ry]);
                const en = eqMap.get(p.rowIndex);
                return d3.polygonContains(lassoPoints, [rx * (1 - s) + en.x * s, ry * (1 - s) + en.y * s]);
            })
            .map((p) => p.rowIndex);
        lassoPath.classed('hidden', true);
        lassoPoints = [];
        if (selected.length > 0) onSelectionChange(selected);
    };

    lassoOverlay.on('click', () => {
        if (_expandedIndex.get(containerSelector) !== null) {
            _expandedIndex.set(containerSelector, null);
            rerender();
        }
    });

    lassoOverlay.on('mousedown', (event) => {
        if (event.button !== 0 || event.shiftKey) return;
        event.preventDefault();
        const [mx, my] = d3.pointer(event, g.node());
        lassoPoints = [[mx, my]];
        updateLassoPath();
        d3.select(window)
            .on('mousemove.radviz-lasso', (e) => { lassoPoints.push(d3.pointer(e, g.node())); updateLassoPath(); })
            .on('mouseup.radviz-lasso', () => { d3.select(window).on('mousemove.radviz-lasso', null).on('mouseup.radviz-lasso', null); finalizeLasso(); });
    });

    // ── Glyph groups ─────────────────────────────────────────────────────

    const storedPrev = animate ? (_prevPositions.get(containerSelector) ?? new Map()) : new Map();

    const glyphGroups = g.append('g').attr('class', 'radviz-glyphs')
        .selectAll('g.radviz-point')
        .data(points)
        .enter()
        .append('g')
        .attr('class', (p) => p.row.__isBenchmark ? 'radviz-point is-benchmark' : 'radviz-point')
        .attr('data-row-index', (p) => p.rowIndex)
        .attr('transform', (p) => {
            if (animate && storedPrev.has(p.rowIndex)) {
                const { px, py } = storedPrev.get(p.rowIndex);
                return `translate(${px}, ${py})`;
            }
            return getTransform(p, spread, R, eqMap, maxGlyphR);
        });

    glyphGroups.each(function (p) {
        renderGlyph(d3.select(this), p, decisionColumns, expandedRowIndex, tooltip);
    });

    if (animate && storedPrev.size > 0) {
        glyphGroups.transition()
            .duration(420)
            .ease(d3.easeCubicInOut)
            .attr('transform', (p) => getTransform(p, spread, R, eqMap, maxGlyphR));
    }

    // Keep benchmark glyph on top
    glyphGroups.filter((p) => p.row.__isBenchmark).raise();

    // ── Expanded-mode dimming ────────────────────────────────────────────

    if (expandedRowIndex !== null) {
        g.classed('radviz-expanded', true);
        glyphGroups.filter((p) => p.rowIndex === expandedRowIndex).raise();
    }

    // ── Interactions ─────────────────────────────────────────────────────

    glyphGroups
        .on('click', function (event, p) {
            if (event.shiftKey) { event.stopPropagation(); onShiftClick(p.rowIndex); return; }
            event.stopPropagation();
            const current = _expandedIndex.get(containerSelector);
            _expandedIndex.set(containerSelector, current === p.rowIndex ? null : p.rowIndex);
            rerender();
        })
        .on('mouseenter', function (event, p) {
            if (expandedRowIndex !== null) return;
            onHoverStart(p.rowIndex);
            const objLines = columns.map(col => `${col}: ${(+p.row[col]).toFixed(2)}`).join('<br>');
            tooltip.classed('visible', true)
                .html(`<b>${p.row.__isBenchmark ? 'Benchmark' : `Point ${p.rowIndex}`}</b><br>${objLines}`)
                .style('left', `${event.pageX + 12}px`)
                .style('top', `${event.pageY - 36}px`);
        })
        .on('mousemove', (event) => {
            tooltip.style('left', `${event.pageX + 12}px`).style('top', `${event.pageY - 36}px`);
        })
        .on('mouseleave', () => { onHoverEnd(); tooltip.classed('visible', false); });

    // ── Selection state ──────────────────────────────────────────────────

    function setSelection(rowIndexSet) {
        const hasSel = rowIndexSet !== null && rowIndexSet.size > 0;
        container.selectAll('g.radviz-point[data-row-index]')
            .classed('is-selection-dim', function () { return hasSel && !rowIndexSet.has(Number(this.dataset.rowIndex)); })
            .classed('is-point-selected', function () { return hasSel && rowIndexSet.has(Number(this.dataset.rowIndex)); });
    }

    _radvizInstances.set(containerSelector, setSelection);
    setSelection(getEffectiveSelection());
    applyRadvizHighlight(getActiveRowIndex());
}
