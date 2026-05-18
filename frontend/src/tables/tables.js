import * as d3 from 'd3';
import './tables.css';
import { subscribe, getActiveRowIndex, getEffectiveSelection } from '../state/appState.js';
import { getGroupBaseColor, getVariableColor, getGroupOrder, getGroupMembers, computeFrontierColors } from '../colors.js';
import { formatLabel } from '../formatLabel.js';

// ── Per-container persistent state ───────────────────────────────────────────

const _expandedGroups = new Map(); // containerSelector → Set<groupName>
const _columnFilters  = new Map(); // containerSelector → Map<col, [lo, hi]>

// ── Highlight / selection ─────────────────────────────────────────────────────

function applyTableHighlight(rowIndex) {
    d3.selectAll('tr[data-row-index]')
        .classed('is-linked-highlight', function () { return rowIndex !== null && Number(this.dataset.rowIndex) === rowIndex; })
        .classed('is-linked-dim', function () { return rowIndex !== null && Number(this.dataset.rowIndex) !== rowIndex; });

    if (rowIndex !== null) {
        document.querySelectorAll(`tr[data-row-index="${rowIndex}"]`).forEach(el => {
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth', inline: 'nearest' });
        });
    }
}

function applyTableSelection(rowIndexSet) {
    const hasSelection = rowIndexSet !== null;
    d3.selectAll('tr[data-row-index]')
        .classed('is-selection-dim', function () {
            return hasSelection && !rowIndexSet.has(Number(this.dataset.rowIndex));
        })
        .classed('is-point-selected', function () {
            return hasSelection && rowIndexSet.has(Number(this.dataset.rowIndex));
        });
}

subscribe('hover-change',    applyTableHighlight);
subscribe('selection-change', applyTableSelection);
subscribe('filters-clear',    () => _columnFilters.forEach(m => m.clear()));

// ── Group helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the effective column list: group aggregate columns for collapsed groups,
 * individual variable columns for expanded groups.
 */
function buildEffectiveColumns(columns, groups, expandedSet) {
    if (!groups || Object.keys(groups).length === 0) return { effective: columns, isGroupCol: {}, isVarCol: {}, groupOrder: [], groupMembersMap: {} };

    const groupOrder = getGroupOrder(columns, groups);
    const groupMembersMap = getGroupMembers(columns, groups);
    const effective = [];
    const isGroupCol = {};
    const isVarCol = {};

    for (const grp of groupOrder) {
        effective.push(grp);
        isGroupCol[grp] = true;
        if (expandedSet.has(grp)) {
            for (const col of (groupMembersMap[grp] || [])) {
                effective.push(col);
                isVarCol[col] = grp;
            }
        }
    }
    for (const col of columns) {
        if (!groups[col]) effective.push(col);
    }
    return { effective, isGroupCol, isVarCol, groupOrder, groupMembersMap };
}

function getCellValue(row, col, isGroupCol, groupMembersMap) {
    if (isGroupCol[col]) {
        return (groupMembersMap[col] || []).reduce((s, c) => s + (Number(row[c]) || 0), 0);
    }
    return row[col];
}

// ── Main render ───────────────────────────────────────────────────────────────

export function renderTable(containerSelector, columns, data, options = {}) {
    const { onHoverStart = () => {}, onHoverEnd = () => {}, onShiftClick = () => {}, onBrushFilterChange = () => {}, animate = false, groups = {}, measures = {}, disableBrush = false, frontierOrder = null, objectiveDirections = {} } = options;

    const multiFrontier = (frontierOrder?.length ?? 0) > 1;
    let borderColorMap = null;
    let frontierColorByName = new Map();
    let frontierNames = [];
    let frontierRowsMap = new Map();
    if (multiFrontier) {
        const { colorMap, items } = computeFrontierColors(data, frontierOrder);
        borderColorMap = colorMap;
        for (const { label, color } of items) {
            frontierColorByName.set(label, color);
            frontierNames.push(label);
            frontierRowsMap.set(label, []);
        }
        for (const row of data) {
            if (row.__isBenchmark) continue;
            const fname = row.__frontier ?? 'Unknown';
            if (frontierRowsMap.has(fname)) frontierRowsMap.get(fname).push(row);
        }
    }

    const container = d3.select(containerSelector);
    const containerNode = container.node();

    const hasGroups = groups && Object.keys(groups).length > 0;
    const expandedSet = _expandedGroups.get(containerSelector) ?? new Set();
    const { effective: effectiveColumns, isGroupCol, isVarCol, groupOrder, groupMembersMap } =
        buildEffectiveColumns(columns, groups, expandedSet);

    const tableColumns = ["Point", ...effectiveColumns];

    // Compute group colour mapping for headers
    const headerColors = {};
    if (hasGroups) {
        groupOrder.forEach((grp, gi) => {
            headerColors[grp] = getGroupBaseColor(gi);
            (groupMembersMap[grp] || []).forEach((col, vi, arr) => {
                headerColors[col] = getVariableColor(gi, vi, arr.length);
            });
        });
    }

    // Sort state stored on the DOM node to survive re-renders
    if (!containerNode._sortState) containerNode._sortState = { col: null, dir: 1 };
    const sortState = containerNode._sortState;

    function getColValue(row, col) {
        if (col === 'Point') return row.__isBenchmark ? 'Benchmark' : row.__rowIndex;
        return getCellValue(row, col, isGroupCol, groupMembersMap);
    }

    function cycleSort(col) {
        if (sortState.col !== col) {
            Object.assign(sortState, { col, dir: 1 });
        } else if (sortState.dir === 1) {
            sortState.dir = -1;
        } else {
            sortState.col = null;
            sortState.dir = 1;
        }
    }

    function getSortedData(rawData) {
        if (!sortState.col) return rawData;
        return [...rawData].sort((a, b) => {
            if (a.__isBenchmark && !b.__isBenchmark) return -1;
            if (!a.__isBenchmark && b.__isBenchmark) return 1;
            const av = getColValue(a, sortState.col), bv = getColValue(b, sortState.col);
            const an = Number(av), bn = Number(bv);
            if (Number.isFinite(an) && Number.isFinite(bn)) return sortState.dir * (an - bn);
            return sortState.dir * String(av).localeCompare(String(bv));
        });
    }

    const existingTable = container.select("table");
    const isUpdate = false; // always full redraw so histograms stay in sync with data

    const formatCell = (value, cellIndex) => {
        if (cellIndex === 0) {
            if (typeof value === 'string') return value;
            return String(Math.trunc(Number(value)));
        }
        const n = Number(value);
        return Number.isFinite(n) ? n.toFixed(3) : String(value);
    };

    const attachRowEvents = (rowSelection) => {
        rowSelection
            .on("mouseenter", (event, row) => onHoverStart(row.__rowIndex))
            .on("mouseleave", () => onHoverEnd())
            .on("click", (event, row) => {
                if (!event.shiftKey) return;
                event.stopPropagation();
                onShiftClick(row.__rowIndex);
            });
    };

    // ── Histogram size knobs — adjust these to resize ────────────────────────
    const HIST_BAR_H  = 30; 
    const HIST_M_BOT  = 15; 
    const HIST_BINS   = 15; 
    // ─────────────────────────────────────────────────────────────────────────
    const HIST_M      = 3;                          
    const HIST_SVG_H  = HIST_BAR_H + HIST_M + HIST_M_BOT; 
    const HIST_VW     = 100;

    function getColValues(col) {
        return data
            .filter(r => !r.__isBenchmark)
            .map(r => isGroupCol[col]
                ? (groupMembersMap[col] || []).reduce((s, c) => s + (Number(r[c]) || 0), 0)
                : Number(r[col]))
            .filter(v => Number.isFinite(v));
    }

    function applyColumnFilters() {
        const filters = _columnFilters.get(containerSelector) ?? new Map();
        if (filters.size === 0) { onBrushFilterChange(null); return; }
        const passing = data
            .filter(r => {
                if (r.__isBenchmark) return false;
                for (const [col, [lo, hi]] of filters) {
                    const v = isGroupCol[col]
                        ? (groupMembersMap[col] || []).reduce((s, c) => s + (Number(r[c]) || 0), 0)
                        : Number(r[col]);
                    if (!Number.isFinite(v) || v < lo || v > hi) return false;
                }
                return true;
            })
            .map(r => r.__rowIndex);
        onBrushFilterChange(passing);
    }

    function buildHistogramRow(thead) {
        if (!_columnFilters.has(containerSelector)) _columnFilters.set(containerSelector, new Map());
        const colFilters = _columnFilters.get(containerSelector);

        const histRow = thead.append("tr").attr("class", "histogram-row");
        const innerW  = HIST_VW - 2 * HIST_M;
        const innerH  = HIST_BAR_H;

        tableColumns.forEach(col => {
            const cell = histRow.append("th").attr("class", "histogram-cell");
            if (col === "Point") return;

            const vals = getColValues(col);
            if (vals.length < 2) return;

            const ext = d3.extent(vals);
            if (ext[0] === ext[1]) return;

            const xScale = d3.scaleLinear().domain(ext).range([0, innerW]).clamp(true);
            const bins   = d3.bin().domain(ext).thresholds(HIST_BINS)(vals);

            // Pre-compute per-frontier values for this column
            const frontierColVals = new Map();
            if (multiFrontier) {
                for (const [fname, rows] of frontierRowsMap) {
                    frontierColVals.set(fname, rows.map(r => isGroupCol[col]
                        ? (groupMembersMap[col] || []).reduce((s, c) => s + (Number(r[c]) || 0), 0)
                        : Number(r[col])).filter(Number.isFinite));
                }
            }

            const yScale = multiFrontier
                ? d3.scaleLinear().domain([0, d3.max(bins, (b, i) => {
                    const isLast = i === bins.length - 1;
                    let max = 0;
                    for (const fname of frontierNames) {
                        const fv = frontierColVals.get(fname) ?? [];
                        const count = fv.filter(v => v >= b.x0 && (isLast ? v <= b.x1 : v < b.x1)).length;
                        if (count > max) max = count;
                    }
                    return max;
                }) || 1]).range([innerH, 0])
                : d3.scaleLinear().domain([0, d3.max(bins, b => b.length)]).range([innerH, 0]);

            const svg = cell.append("svg")
                .attr("class", "col-histogram")
                .attr("viewBox", `0 0 ${HIST_VW} ${HIST_SVG_H}`)
                .attr("preserveAspectRatio", "none")
                .style("width", "100%")
                .style("height", `${HIST_SVG_H}px`);

            const g = svg.append("g").attr("transform", `translate(${HIST_M},${HIST_M})`);

            if (multiFrontier) {
                const nFrontiers = frontierNames.length;
                bins.forEach((bin, binIdx) => {
                    const isLast = binIdx === bins.length - 1;
                    const binW = Math.max(0, xScale(bin.x1) - xScale(bin.x0) - 1);
                    const subW = binW / nFrontiers;
                    frontierNames.forEach((fname, fi) => {
                        const fv = frontierColVals.get(fname) ?? [];
                        const count = fv.filter(v => v >= bin.x0 && (isLast ? v <= bin.x1 : v < bin.x1)).length;
                        if (count > 0) {
                            g.append("rect")
                                .attr("x", xScale(bin.x0) + fi * subW + 0.5)
                                .attr("width", Math.max(0, subW - 0.5))
                                .attr("y", yScale(count))
                                .attr("height", innerH - yScale(count))
                                .attr("fill", frontierColorByName.get(fname) ?? '#aaa');
                        }
                    });
                });
            } else {
                g.selectAll("rect.hist-bar")
                    .data(bins)
                    .enter().append("rect")
                    .attr("class", "hist-bar")
                    .attr("x",      d => xScale(d.x0) + 0.5)
                    .attr("width",  d => Math.max(0, xScale(d.x1) - xScale(d.x0) - 1))
                    .attr("y",      d => yScale(d.length))
                    .attr("height", d => innerH - yScale(d.length));
            }

            const tickVals = [ext[0], (ext[0] + ext[1]) / 2, ext[1]];
            const axisG = g.append("g")
                .attr("class", "hist-axis")
                .attr("transform", `translate(0,${innerH})`)
                .call(
                    d3.axisBottom(xScale)
                        .tickValues(tickVals)
                        .tickSize(3)
                        .tickFormat(v => { const s = d3.format(".3f")(v); return s.endsWith(".000") ? s.slice(0, -4) : s; })
                );
            axisG.select(".domain").remove();
            axisG.selectAll(".tick text")
                .attr("text-anchor", (d, i) => i === 0 ? "start" : i === 2 ? "end" : "middle")
                .attr("dx", 0);

            if (!disableBrush) {
                const brush = d3.brushX()
                    .extent([[0, 0], [innerW, innerH]])
                    .on("end", event => {
                        if (!event.sourceEvent) return; // programmatic brush.move(), ignore
                        const filters = _columnFilters.get(containerSelector);
                        if (!event.selection) {
                            filters.delete(col);
                        } else {
                            const [lo, hi] = event.selection.map(xScale.invert);
                            filters.set(col, [lo, hi]);
                            window.dispatchEvent(new CustomEvent('survey:action', { detail: { type: 'table_histogram_filter', column: col, min: lo, max: hi } }));
                        }
                        applyColumnFilters();
                    });

                const brushG = g.append("g").attr("class", "hist-brush").call(brush);

                if (colFilters.has(col)) {
                    const [fLo, fHi] = colFilters.get(col);
                    brush.move(brushG, [xScale(fLo), xScale(fHi)]);
                }

                svg.on("dblclick", () => {
                    brush.move(brushG, null);
                    _columnFilters.get(containerSelector).delete(col);
                    applyColumnFilters();
                    window.dispatchEvent(new CustomEvent('survey:action', { detail: { type: 'table_histogram_filter_clear', column: col } }));
                });
            }
        });
    }

    function buildHeaders(thead) {
        const headerRow = thead.append("tr").attr("class", "table-label-row");
        headerRow.selectAll("th")
            .data(tableColumns)
            .enter()
            .append("th")
            .each(function (col) {
                const th = d3.select(this);
                const color = headerColors[col];
                if (color) {
                    th.attr('data-col-color', color).style('--col-color', color);
                }
                if (col === sortState.col) th.classed('sort-active', true);
                if (isGroupCol[col]) th.classed('group-header', true);
                if (isVarCol[col]) th.classed('var-sub-header', true);
            })
            .html(col => {
                const measureLabel = measures[col] ? `<span class="col-measure">${measures[col]}</span>` : '';
                const dir = objectiveDirections[col];
                const dirLabel = dir ? `<span class="col-direction col-direction--${dir}">${dir}</span>` : '';
                if (isGroupCol[col]) {
                    const canExpand = (groupMembersMap[col] || []).length > 1;
                    if (!canExpand) {
                        const indicator = col === sortState.col
                            ? `<span class="sort-indicator">${sortState.dir === 1 ? '↑' : '↓'}</span>`
                            : `<span class="sort-indicator">↕</span>`;
                        return `${formatLabel(col)}${indicator}${measureLabel}${dirLabel}`;
                    }
                    const isExpanded = expandedSet.has(col);
                    return `${formatLabel(col)} <span class="expand-indicator">${isExpanded ? '▼' : '▶'}</span>${measureLabel}${dirLabel}`;
                }
                const indicator = col === sortState.col
                    ? `<span class="sort-indicator">${sortState.dir === 1 ? '↑' : '↓'}</span>`
                    : `<span class="sort-indicator">↕</span>`;
                return `${formatLabel(col)}${indicator}${measureLabel}${dirLabel}`;
            })
            .on("click", (event, col) => {
                const rerender = () => {
                    container.selectAll("*").remove();
                    containerNode._sortState = sortState;
                    renderTable(containerSelector, columns, data, options);
                    applyTableHighlight(getActiveRowIndex());
                    applyTableSelection(getEffectiveSelection());
                };
                if (isGroupCol[col] && (groupMembersMap[col] || []).length > 1) {
                    // Toggle group expansion (multi-member groups only)
                    const next = new Set(expandedSet);
                    const expanding = !next.has(col);
                    expanding ? next.add(col) : next.delete(col);
                    _expandedGroups.set(containerSelector, next);
                    window.dispatchEvent(new CustomEvent('survey:action', { detail: { type: 'table_group_expand', group: col, expanded: expanding } }));
                    rerender();
                } else {
                    // Sort (Point, single-member groups, variable columns)
                    cycleSort(col);
                    const dir = sortState.col === col ? (sortState.dir === 1 ? 'asc' : 'desc') : 'none';
                    window.dispatchEvent(new CustomEvent('survey:action', { detail: { type: 'table_sort', column: col, direction: dir } }));
                    rerender();
                }
            });
    }

    // Full redraw
    if (!isUpdate) {
        container.selectAll("*").remove();
        const table = container.append("table");
        const thead = table.append("thead");
        buildHistogramRow(thead);
        buildHeaders(thead);
        const tbody = table.append("tbody");

        const sortedData = getSortedData(data);
        const rowsSel = tbody.selectAll("tr")
            .data(sortedData, row => row.__rowIndex)
            .enter()
            .append("tr")
            .attr("class", row => row.__isBenchmark ? "is-benchmark" : null)
            .attr("data-row-index", row => row.__rowIndex)
            .style("--frontier-color", row => borderColorMap?.get(row.__rowIndex) ?? null);

        attachRowEvents(rowsSel);
        rowsSel.selectAll("td")
            .data(row => [
                row.__isBenchmark ? 'Benchmark' : row.__rowIndex,
                ...effectiveColumns.map(col => getCellValue(row, col, isGroupCol, groupMembersMap)),
            ])
            .enter()
            .append("td")
            .html(formatCell);
        applyTableHighlight(getActiveRowIndex());
        applyTableSelection(getEffectiveSelection());
        return;
    }

    // Incremental update
    const tbody = existingTable.select("tbody");
    const sortedData = getSortedData(data);
    const rowSel = tbody.selectAll("tr").data(sortedData, row => row.__rowIndex);

    rowSel.exit().remove();

    const rowEnter = rowSel.enter()
        .append("tr")
        .attr("class", row => row.__isBenchmark ? "is-benchmark" : null)
        .attr("data-row-index", row => row.__rowIndex)
        .style("--frontier-color", row => borderColorMap?.get(row.__rowIndex) ?? null);

    attachRowEvents(rowEnter);
    rowEnter.selectAll("td")
        .data(row => [
            row.__isBenchmark ? 'Benchmark' : row.__rowIndex,
            ...effectiveColumns.map(col => getCellValue(row, col, isGroupCol, groupMembersMap)),
        ])
        .enter().append("td").html(formatCell);

    rowSel.each(function (row) {
        d3.select(this).style("--frontier-color", borderColorMap?.get(row.__rowIndex) ?? null);
        d3.select(this).selectAll("td")
            .data([
                row.__isBenchmark ? 'Benchmark' : row.__rowIndex,
                ...effectiveColumns.map(col => getCellValue(row, col, isGroupCol, groupMembersMap)),
            ])
            .html(formatCell);
    });

    applyTableHighlight(getActiveRowIndex());
    applyTableSelection(getEffectiveSelection());
}

export function getNumericColumns(data, columns) {
    if (!data || data.length === 0) return [];
    return columns.filter(col => data.some(row => Number.isFinite(Number(row[col]))));
}
