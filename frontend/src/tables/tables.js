import * as d3 from 'd3';
import './tables.css';
import { subscribe, getActiveRowIndex, getEffectiveSelection } from '../state/appState.js';
import { getGroupBaseColor, getVariableColor, getGroupOrder, getGroupMembers } from '../colors.js';

// ── Per-container persistent state ───────────────────────────────────────────

const _expandedGroups = new Map(); // containerSelector → Set<groupName>

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
    const hasSelection = rowIndexSet !== null && rowIndexSet.size > 0;
    d3.selectAll('tr[data-row-index]')
        .classed('is-selection-dim', function () {
            return hasSelection && !rowIndexSet.has(Number(this.dataset.rowIndex));
        })
        .classed('is-point-selected', function () {
            return hasSelection && rowIndexSet.has(Number(this.dataset.rowIndex));
        });
}

subscribe('hover-change', applyTableHighlight);
subscribe('selection-change', applyTableSelection);

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
    const { onHoverStart = () => {}, onHoverEnd = () => {}, onShiftClick = () => {}, animate = false, groups = {} } = options;

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
    const isUpdate = animate && !existingTable.empty();

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

    function buildHeaders(thead) {
        const headerRow = thead.append("tr");
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
                if (isGroupCol[col]) {
                    const canExpand = (groupMembersMap[col] || []).length > 1;
                    if (!canExpand) {
                        const indicator = col === sortState.col
                            ? `<span class="sort-indicator">${sortState.dir === 1 ? '↑' : '↓'}</span>`
                            : `<span class="sort-indicator">↕</span>`;
                        return `${col}${indicator}`;
                    }
                    const isExpanded = expandedSet.has(col);
                    return `${col} <span class="expand-indicator">${isExpanded ? '▼' : '▶'}</span>`;
                }
                const indicator = col === sortState.col
                    ? `<span class="sort-indicator">${sortState.dir === 1 ? '↑' : '↓'}</span>`
                    : `<span class="sort-indicator">↕</span>`;
                return `${col}${indicator}`;
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
                    next.has(col) ? next.delete(col) : next.add(col);
                    _expandedGroups.set(containerSelector, next);
                    rerender();
                } else {
                    // Sort (Point, single-member groups, variable columns)
                    cycleSort(col);
                    rerender();
                }
            });
    }

    // Full redraw
    if (!isUpdate) {
        container.selectAll("*").remove();
        const table = container.append("table");
        buildHeaders(table.append("thead"));
        const tbody = table.append("tbody");

        const sortedData = getSortedData(data);
        const rowsSel = tbody.selectAll("tr")
            .data(sortedData, row => row.__rowIndex)
            .enter()
            .append("tr")
            .attr("class", row => row.__isBenchmark ? "is-benchmark" : null)
            .attr("data-row-index", row => row.__rowIndex);

        attachRowEvents(rowsSel);
        rowsSel.selectAll("td")
            .data(row => [
                row.__isBenchmark ? 'Benchmark' : (row.__frontier ? `${row.__rowIndex}<br>${row.__frontier}` : row.__rowIndex),
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
        .attr("data-row-index", row => row.__rowIndex);

    attachRowEvents(rowEnter);
    rowEnter.selectAll("td")
        .data(row => [
            row.__isBenchmark ? 'Benchmark' : (row.__frontier ? `${row.__rowIndex}<br>${row.__frontier}` : row.__rowIndex),
            ...effectiveColumns.map(col => getCellValue(row, col, isGroupCol, groupMembersMap)),
        ])
        .enter().append("td").html(formatCell);

    rowSel.each(function (row) {
        d3.select(this).selectAll("td")
            .data([
                row.__isBenchmark ? 'Benchmark' : (row.__frontier ? `${row.__rowIndex}<br>${row.__frontier}` : row.__rowIndex),
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
