import * as d3 from 'd3';
import './scatterplot.css';
import { subscribe, getActiveRowIndex } from '../state/appState.js';

function applyScatterHighlight(rowIndex) {
    const hasActive = rowIndex !== null;
    const isActive = (el) => hasActive && Number(el.dataset.rowIndex) === rowIndex;

    d3.selectAll('circle[data-row-index]')
        .classed('is-linked-highlight', function () { return isActive(this); })
        .classed('is-linked-dim', function () { return hasActive && !isActive(this); })
        .attr('r', function () {
            if (!hasActive) return 4;
            return isActive(this) ? 7 : 3;
        });

    d3.selectAll('.scatter-point-label[data-row-index]')
        .classed('is-linked-highlight', function () { return isActive(this); })
        .classed('is-linked-dim', function () { return hasActive && !isActive(this); });
}

subscribe('hover-change', applyScatterHighlight);

const _scatterInstances = new Map();

export function setScatterSelection(rowIndexSet) {
    _scatterInstances.forEach((setSelection) => setSelection(rowIndexSet));
}

export function renderScatterplot(containerSelector, data, xKey, yKey, options = {}) {
    const {
        onHoverStart = () => {},
        onHoverEnd = () => {},
        onSelectionChange = () => {},
        onShiftClick = () => {},
        animate = false,
        showLabels = false,
    } = options;
    const container = d3.select(containerSelector);
    const containerNode = container.node();
    if (!containerNode) {
        return;
    }

    const prevXMin = Number(containerNode.dataset.prevXMin);
    const prevXMax = Number(containerNode.dataset.prevXMax);
    const prevYMin = Number(containerNode.dataset.prevYMin);
    const prevYMax = Number(containerNode.dataset.prevYMax);
    const hasPrevDomain = [prevXMin, prevXMax, prevYMin, prevYMax].every(Number.isFinite);

    container.selectAll("*").remove();

    const tooltip = d3
        .select("body")
        .selectAll(".scatter-tooltip")
        .data([null])
        .join("div")
        .attr("class", "scatter-tooltip");

    const containerWidth = Math.max(400, containerNode.clientWidth || 0);
    const containerHeight = Math.max(300, containerNode.clientHeight || 0);

    const margin = { top: 20, right: 20, bottom: 45, left: 55 };
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    const points = data
        .map((row, index) => ({
            x: Number(row[xKey]),
            y: Number(row[yKey]),
            rawX: row[xKey],
            rawY: row[yKey],
            rowIndex: row.__rowIndex ?? index,
        }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

    if (points.length === 0) {
        container.append("p").text("No numeric data available for selected axes.");
        return;
    }

    const xExtent = d3.extent(points, (point) => point.x);
    const yExtent = d3.extent(points, (point) => point.y);

    const xPadding = (xExtent[1] - xExtent[0] || 1) * 0.05;
    const yPadding = (yExtent[1] - yExtent[0] || 1) * 0.05;

    const xScale = d3
        .scaleLinear()
        .domain([xExtent[0] - xPadding, xExtent[1] + xPadding])
        .range([0, width]);

    const yScale = d3
        .scaleLinear()
        .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
        .range([height, 0]);

    const startXScale = animate && hasPrevDomain
        ? d3.scaleLinear().domain([prevXMin, prevXMax]).range([0, width])
        : xScale;
    const startYScale = animate && hasPrevDomain
        ? d3.scaleLinear().domain([prevYMin, prevYMax]).range([height, 0])
        : yScale;

    containerNode.dataset.prevXMin = String(xScale.domain()[0]);
    containerNode.dataset.prevXMax = String(xScale.domain()[1]);
    containerNode.dataset.prevYMin = String(yScale.domain()[0]);
    containerNode.dataset.prevYMax = String(yScale.domain()[1]);

    const svg = container
        .append("svg")
        .attr("viewBox", `0 0 ${containerWidth} ${containerHeight}`)
        .attr("preserveAspectRatio", "none")
        .append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);

    const plotArea = svg
        .append("rect")
        .attr("class", "scatter-lasso-layer")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", width)
        .attr("height", height);

    const xGridGroup = svg.append("g").attr("class", "scatter-grid scatter-grid-x").attr("transform", `translate(0, ${height})`);
    const yGridGroup = svg.append("g").attr("class", "scatter-grid scatter-grid-y");
    const xAxisGroup = svg.append("g").attr("transform", `translate(0, ${height})`);
    const yAxisGroup = svg.append("g");

    if (animate) {
        xGridGroup.call(d3.axisBottom(startXScale).tickSize(-height).tickFormat(""));
        yGridGroup.call(d3.axisLeft(startYScale).tickSize(-width).tickFormat(""));
        xAxisGroup.call(d3.axisBottom(startXScale));
        yAxisGroup.call(d3.axisLeft(startYScale));
        xGridGroup.transition().duration(420).call(d3.axisBottom(xScale).tickSize(-height).tickFormat(""));
        yGridGroup.transition().duration(420).call(d3.axisLeft(yScale).tickSize(-width).tickFormat(""));
        xAxisGroup.transition().duration(420).call(d3.axisBottom(xScale));
        yAxisGroup.transition().duration(420).call(d3.axisLeft(yScale));
    } else {
        xGridGroup.call(d3.axisBottom(xScale).tickSize(-height).tickFormat(""));
        yGridGroup.call(d3.axisLeft(yScale).tickSize(-width).tickFormat(""));
        xAxisGroup.call(d3.axisBottom(xScale));
        yAxisGroup.call(d3.axisLeft(yScale));
    }

    svg
        .append("text")
        .attr("x", width / 2)
        .attr("y", height + margin.bottom - 8)
        .attr("text-anchor", "middle")
        .text(xKey);

    svg
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -40)
        .attr("text-anchor", "middle")
        .text(yKey);

    if (showLabels) {
        const labelGroup = svg.append("g").attr("class", "scatter-point-labels");
        const labelSelection = labelGroup
            .selectAll("text")
            .data(points)
            .enter()
            .append("text")
            .attr("class", "scatter-point-label")
            .attr("data-row-index", (point) => point.rowIndex)
            .attr("x", (point) => (animate ? startXScale(point.x) : xScale(point.x)) + 6)
            .attr("y", (point) => (animate ? startYScale(point.y) : yScale(point.y)) - 6)
            .text((point) => `op${point.rowIndex + 1}`);

        if (animate) {
            labelSelection
                .transition()
                .duration(420)
                .attr("x", (point) => xScale(point.x) + 6)
                .attr("y", (point) => yScale(point.y) - 6);
        }
    }

    const pointSelection = svg
        .append("g")
        .selectAll("circle")
        .data(points)
        .enter()
        .append("circle")
        .attr("class", "scatter-point")
        .attr("data-row-index", (point) => point.rowIndex)
        .attr("cx", (point) => startXScale(point.x))
        .attr("cy", (point) => startYScale(point.y))
        .attr("r", 4)
        .attr("fill", "#34c759")
        .attr("opacity", 0.9)
        .on("click", (event, point) => {
            if (event.shiftKey) {
                event.stopPropagation();
                onShiftClick(point.rowIndex);
            }
        })
        .on("mouseenter", (event, point) => {
            onHoverStart(point.rowIndex);
            tooltip
                .classed("visible", true)
                .html(
                    `Point: ${point.rowIndex + 1}<br>${xKey}: ${Number(point.rawX).toFixed(3)}<br>${yKey}: ${Number(point.rawY).toFixed(3)}`,
                )
                .style("left", `${event.pageX + 12}px`)
                .style("top", `${event.pageY - 36}px`);
        })
        .on("mousemove", (event) => {
            tooltip
                .style("left", `${event.pageX + 12}px`)
                .style("top", `${event.pageY - 36}px`);
        })
        .on("mouseleave", () => {
            onHoverEnd();
            tooltip.classed("visible", false);
        });

    if (animate) {
        pointSelection
            .transition()
            .duration(420)
            .attr("cx", (point) => xScale(point.x))
            .attr("cy", (point) => yScale(point.y));
    }

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const lassoPath = svg.append("path").attr("class", "scatter-lasso-path hidden");
    let lassoPoints = [];

    const updateLassoPath = () => {
        if (lassoPoints.length < 2) {
            return;
        }

        lassoPath
            .classed("hidden", false)
            .attr("d", `M${lassoPoints.map((point) => `${point[0]},${point[1]}`).join("L")}Z`);
    };

    const pointerToPlot = (event) => {
        const [rawX, rawY] = d3.pointer(event, svg.node());
        return [clamp(rawX, 0, width), clamp(rawY, 0, height)];
    };

    const finalizeLasso = () => {
        if (lassoPoints.length < 3) {
            lassoPath.classed("hidden", true);
            lassoPoints = [];
            return;
        }

        const selectedRows = points
            .filter((point) => d3.polygonContains(lassoPoints, [xScale(point.x), yScale(point.y)]))
            .map((point) => point.rowIndex);

        lassoPath.classed("hidden", true);
        lassoPoints = [];

        if (selectedRows.length > 0) {
            onSelectionChange(selectedRows);
        }
    };

    svg
        .append("text")
        .attr("class", "scatter-hint")
        .attr("x", width)
        .attr("y", height + margin.bottom - 8)
        .attr("text-anchor", "end")
        .text("Shift+click to select points");

    function setSelection(rowIndexSet) {
        const hasSelection = rowIndexSet !== null && rowIndexSet.size > 0;
        container.selectAll("circle[data-row-index]")
            .classed("is-selection-dim", function () {
                return hasSelection && !rowIndexSet.has(Number(this.dataset.rowIndex));
            })
            .classed("is-point-selected", function () {
                return hasSelection && rowIndexSet.has(Number(this.dataset.rowIndex));
            });
        container.selectAll(".scatter-point-label[data-row-index]")
            .classed("is-selection-dim", function () {
                return hasSelection && !rowIndexSet.has(Number(this.dataset.rowIndex));
            })
            .classed("is-point-selected", function () {
                return hasSelection && rowIndexSet.has(Number(this.dataset.rowIndex));
            });
    }

    _scatterInstances.set(containerSelector, setSelection);

    plotArea.on("mousedown", (event) => {
        if (event.button !== 0 || event.shiftKey) {
            return;
        }

        event.preventDefault();
        lassoPoints = [pointerToPlot(event)];
        lassoPath.classed("hidden", false);
        updateLassoPath();

        d3.select(window)
            .on("mousemove.scatter-lasso", (moveEvent) => {
                lassoPoints.push(pointerToPlot(moveEvent));
                updateLassoPath();
            })
            .on("mouseup.scatter-lasso", () => {
                d3.select(window).on("mousemove.scatter-lasso", null).on("mouseup.scatter-lasso", null);
                finalizeLasso();
            });
    });

    applyScatterHighlight(getActiveRowIndex());
}

export function populateAxisSelect(select, columns) {
    select.selectAll("*").remove();

    select
        .selectAll("option")
        .data(columns)
        .enter()
        .append("option")
        .attr("value", (column) => column)
        .text((column) => column);
}
