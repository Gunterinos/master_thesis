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
    const { onHoverStart = () => {}, onHoverEnd = () => {}, animate = false } = options;
    const container = d3.select(containerSelector);
    const tableColumns = ["Point", ...columns];

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

    // Full redraw (first render or non-animated call) 
    if (!isUpdate) {
        container.selectAll("*").remove();

        const table = container.append("table");
        const thead = table.append("thead");
        const tbody = table.append("tbody");

        thead
            .append("tr")
            .selectAll("th")
            .data(tableColumns)
            .enter()
            .append("th")
            .text((column) => column);

        const rows = tbody
            .selectAll("tr")
            .data(data, (row) => row.__rowIndex)
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

    // Incremental update
    const tbody = existingTable.select("tbody");
    const rowSel = tbody
        .selectAll("tr")
        .data(data, (row) => row.__rowIndex);

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
