import * as d3 from 'd3';
import './tables.css';
import { subscribe, getActiveRowIndex, getEffectiveSelection } from '../state/appState.js';

function applyTableHighlight(rowIndex) {
    d3.selectAll('tr[data-row-index]')
        .classed('is-linked-highlight', function () { return rowIndex !== null && Number(this.dataset.rowIndex) === rowIndex; })
        .classed('is-linked-dim', function () { return rowIndex !== null && Number(this.dataset.rowIndex) !== rowIndex; })

    if (rowIndex !== null) {
        document.querySelectorAll(`tr[data-row-index="${rowIndex}"]`).forEach((rowElement) => {
            rowElement.scrollIntoView({ block: 'nearest', behavior: 'smooth', inline: 'nearest' });
        });
    }
}

function applyTableSelection(rowIndexSet) {
    d3.selectAll('tr[data-row-index]').classed('is-selection-dim', function () {
        return rowIndexSet !== null && !rowIndexSet.has(Number(this.dataset.rowIndex));
    });
}

subscribe('hover-change', applyTableHighlight);
subscribe('selection-change', applyTableSelection);

export function renderTable(containerSelector, columns, data, options = {}) {
    const { onHoverStart = () => {}, onHoverEnd = () => {}, animate = false, columnColors = {} } = options;
    const container = d3.select(containerSelector);
    const containerNode = container.node();
    const tableColumns = ["Point", ...columns];

    // Sort state stored on the container DOM node to survive re-renders.
    if (!containerNode._sortState) {
        containerNode._sortState = { col: null, dir: 1 };
    }
    const sortState = containerNode._sortState;

    function getColValue(row, col) {
        if (col === 'Point') return row.__isBenchmark ? 'Benchmark' : row.__rowIndex;
        return row[col];
    }

    function getSortedData(rawData) {
        if (!sortState.col) return rawData;
        return [...rawData].sort((a, b) => {
            if (a.__isBenchmark && !b.__isBenchmark) return -1;
            if (!a.__isBenchmark && b.__isBenchmark) return 1;
            const av = getColValue(a, sortState.col);
            const bv = getColValue(b, sortState.col);
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
        const numericValue = Number(value);
        if (Number.isFinite(numericValue)) {
            return numericValue.toFixed(3);
        }
        return value;
    };

    const attachRowEvents = (rowSelection) => {
        rowSelection
            .on("mouseenter", (event, row) => {
                onHoverStart(row.__rowIndex);
            })
            .on("mouseleave", () => {
                onHoverEnd();
            });
    };

    function buildHeaders(thead) {
        const headerRow = thead.append("tr");
        headerRow
            .selectAll("th")
            .data(tableColumns)
            .enter()
            .append("th")
            .each(function (col) {
                const th = d3.select(this);
                const color = columnColors[col];
                if (color) {
                    th.attr('data-col-color', color)
                      .style('--col-color', color);
                }
                if (col === sortState.col) th.classed('sort-active', true);
            })
            .html((col) => {
                const indicator = col === sortState.col
                    ? `<span class="sort-indicator">${sortState.dir === 1 ? '↑' : '↓'}</span>`
                    : `<span class="sort-indicator">↕</span>`;
                return `${col}${indicator}`;
            })
            .on("click", (event, col) => {
                if (sortState.col === col) {
                    sortState.dir *= -1;
                } else {
                    sortState.col = col;
                    sortState.dir = 1;
                }
                // Full redraw to apply sort
                container.selectAll("*").remove();
                containerNode._sortState = sortState;
                renderTable(containerSelector, columns, data, options);
                applyTableHighlight(getActiveRowIndex());
                applyTableSelection(getEffectiveSelection());
            });
    }

    // Full redraw (first render or non-animated call)
    if (!isUpdate) {
        container.selectAll("*").remove();

        const table = container.append("table");
        const thead = table.append("thead");
        const tbody = table.append("tbody");

        buildHeaders(thead);

        const sortedData = getSortedData(data);
        const rows = tbody
            .selectAll("tr")
            .data(sortedData, (row) => row.__rowIndex)
            .enter()
            .append("tr")
            .attr("class", (row) => row.__isBenchmark ? "is-benchmark" : null)
            .attr("data-row-index", (row) => row.__rowIndex);

        attachRowEvents(rows);

        rows
            .selectAll("td")
            .data((row) => [row.__isBenchmark ? 'Benchmark' : row.__rowIndex, ...columns.map((column) => row[column])])
            .enter()
            .append("td")
            .text(formatCell);

        return;
    }

    // Incremental update — re-sort and update rows.
    const tbody = existingTable.select("tbody");
    const sortedData = getSortedData(data);
    const rowSel = tbody
        .selectAll("tr")
        .data(sortedData, (row) => row.__rowIndex);

    // EXIT: remove rows no longer in the dataset
    rowSel.exit().remove();

    // ENTER: add rows for new data points
    const rowEnter = rowSel
        .enter()
        .append("tr")
        .attr("class", (row) => row.__isBenchmark ? "is-benchmark" : null)
        .attr("data-row-index", (row) => row.__rowIndex);

    attachRowEvents(rowEnter);

    rowEnter
        .selectAll("td")
        .data((row) => [row.__isBenchmark ? 'Benchmark' : row.__rowIndex, ...columns.map((column) => row[column])])
        .enter()
        .append("td")
        .text(formatCell);

    // UPDATE: refresh cell text for rows that stayed
    rowSel.each(function (row) {
        d3.select(this)
            .selectAll("td")
            .data([row.__isBenchmark ? 'Benchmark' : row.__rowIndex, ...columns.map((column) => row[column])])
            .text(formatCell);
    });

    // Subscribers don't fire on re-render, so reapply state manually.
    applyTableHighlight(getActiveRowIndex());
    applyTableSelection(getEffectiveSelection());
}

export function getNumericColumns(data, columns) {
    if (!data || data.length === 0) {
        return [];
    }

    return columns.filter((column) => data.some((row) => Number.isFinite(Number(row[column]))));
}
