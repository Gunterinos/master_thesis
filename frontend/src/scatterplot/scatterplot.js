import * as d3 from 'd3';
import './scatterplot.css';
import { subscribe, getActiveRowIndex, getEffectiveSelection } from '../state/appState.js';
import { POINT_COLOR_REGULAR, POINT_COLOR_BENCHMARK, getColumnColor, getGroupBaseColor, getGroupOrder } from '../colors.js';
import { formatLabel } from '../formatLabel.js';

function applyScatterHighlight(rowIndex) {
    d3.selectAll('circle[data-row-index]')
        .classed('is-linked-highlight', function () { return rowIndex !== null && Number(this.dataset.rowIndex) === rowIndex; })
        .classed('is-linked-dim', function () { return rowIndex !== null && Number(this.dataset.rowIndex) !== rowIndex; })
        .attr('r', function () {
            const isBenchmark = this.dataset.isBenchmark === 'true';
            const baseR = isBenchmark ? 5.5 : 4;
            if (rowIndex === null) return baseR;
            return Number(this.dataset.rowIndex) === rowIndex ? 7 : (isBenchmark ? 4 : 3);
        });

    d3.selectAll('.scatter-point-label[data-row-index]')
        .classed('is-linked-highlight', function () { return rowIndex !== null && Number(this.dataset.rowIndex) === rowIndex; })
        .classed('is-linked-dim', function () { return rowIndex !== null && Number(this.dataset.rowIndex) !== rowIndex; });
}

subscribe('hover-change', applyScatterHighlight);

const _scatterInstances = new Map();

export function setScatterSelection(rowIndexSet) {
    _scatterInstances.forEach((setSelection) => setSelection(rowIndexSet));
}

subscribe('selection-change', setScatterSelection);

export function renderScatterplot(containerSelector, data, xKey, yKey, options = {}) {
    const {
        onHoverStart = () => {},
        onHoverEnd = () => {},
        onSelectionChange = () => {},
        onShiftClick = () => {},
        animate = false,
        showLabels = false,
        pcaLabels = null,
        groupColorOverrides = null,
        decisionColumns = [],
        groups = {},
        frontierColorOverrides = null,
        frontierLegendItems = [],
        measures = {},
    } = options;

    const xAxisLabel = pcaLabels ? formatLabel(pcaLabels.x) : formatLabel(xKey);
    const yAxisLabel = pcaLabels ? formatLabel(pcaLabels.y) : formatLabel(yKey);
    const xTooltipLabel = pcaLabels ? 'PC1' : formatLabel(xKey);
    const yTooltipLabel = pcaLabels ? 'PC2' : formatLabel(yKey);
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
    container.style("position", "relative");

    const totalObj = Object.keys(data[0] || {}).filter(k => k.startsWith('obj')).length;

    const tooltip = d3
        .select("body")
        .selectAll(".scatter-tooltip")
        .data([null])
        .join("div")
        .attr("class", "scatter-tooltip");

    if (totalObj > 2 && !pcaLabels) {
        const warnTooltip = d3.select("body")
            .selectAll(".scatter-warn-tooltip")
            .data([null]).join("div")
            .attr("class", "scatter-warn-tooltip");

        container.append("div")
            .attr("class", "scatter-dim-warning")
            .text("!")
            .on("mouseenter", (event) => {
                warnTooltip
                    .classed("visible", true)
                    .html(`Only 2 of ${totalObj} objectives shown<br>results may be misleading.`)
                    .style("left", `${event.pageX + 12}px`)
                    .style("top",  `${event.pageY - 36}px`);
            })
            .on("mousemove", (event) => {
                warnTooltip
                    .style("left", `${event.pageX + 12}px`)
                    .style("top",  `${event.pageY - 36}px`);
            })
            .on("mouseleave", () => warnTooltip.classed("visible", false));
    }

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
            isBenchmark: row.__isBenchmark === true,
        }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

    const frontierByIndex = new Map(data.map(row => [row.__rowIndex, row.__frontier ?? null]));

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

    const xMeasure = !pcaLabels && measures[xKey] ? measures[xKey] : null;
    const yMeasure = !pcaLabels && measures[yKey] ? measures[yKey] : null;

    const xLabelEl = svg.append("text")
        .attr("x", width / 2)
        .attr("y", height + margin.bottom - 8)
        .attr("text-anchor", "middle");
    xLabelEl.append("tspan").text(xAxisLabel);
    if (xMeasure) xLabelEl.append("tspan")
        .attr("dx", "0.5em")
        .attr("class", "axis-measure-label")
        .text(xMeasure);

    const yLabelEl = svg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -40)
        .attr("text-anchor", "middle");
    yLabelEl.append("tspan").text(yAxisLabel);
    if (yMeasure) yLabelEl.append("tspan")
        .attr("dx", "0.5em")
        .attr("class", "axis-measure-label")
        .text(yMeasure);

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
            .text((point) => point.isBenchmark ? "Benchmark" : `op${point.rowIndex}`);

        if (animate) {
            labelSelection
                .transition()
                .duration(420)
                .attr("x", (point) => xScale(point.x) + 6)
                .attr("y", (point) => yScale(point.y) - 6);
        }
    }

    const pointGroup = svg.append("g");

    // Render regular points first, benchmark on top
    const regularPoints = points.filter((p) => !p.isBenchmark);
    const benchmarkPoints = points.filter((p) => p.isBenchmark);

    const pointSelection = pointGroup
        .selectAll("circle.scatter-point")
        .data([...regularPoints, ...benchmarkPoints])
        .enter()
        .append("circle")
        .attr("class", (point) => point.isBenchmark ? "scatter-point is-benchmark" : "scatter-point")
        .attr("data-row-index", (point) => point.rowIndex)
        .attr("data-is-benchmark", (point) => point.isBenchmark)
        .attr("cx", (point) => startXScale(point.x))
        .attr("cy", (point) => startYScale(point.y))
        .attr("r", (point) => point.isBenchmark ? 5.5 : 4)
        .attr("fill", (point) =>
            point.isBenchmark ? POINT_COLOR_BENCHMARK
            : (frontierColorOverrides?.get(point.rowIndex) ?? groupColorOverrides?.get(point.rowIndex) ?? POINT_COLOR_REGULAR)
        )
        .attr("opacity", 0.9)
        .on("click", (event, point) => {
            if (event.shiftKey) {
                event.stopPropagation();
                onShiftClick(point.rowIndex);
            }
        })
        .on("mouseenter", (event, point) => {
            onHoverStart(point.rowIndex);
            const frontier = frontierByIndex.get(point.rowIndex);
            const header = point.isBenchmark ? 'Benchmark' : `Point: ${point.rowIndex}${frontier ? `<br>${frontier}` : ''}`;
            tooltip
                .classed("visible", true)
                .html(
                    `${header}<br>${xTooltipLabel}: ${Number(point.rawX).toFixed(3)}<br>${yTooltipLabel}: ${Number(point.rawY).toFixed(3)}`,
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

    const _renderScatterLegend = (legendItems, title) => {
        const LEGEND_W = 130;
        const LEGEND_H = 20 + legendItems.length * 18;
        const PAD = 12;

        const corners = [
            { x: 0,                y: 0 },
            { x: width - LEGEND_W, y: 0 },
            { x: 0,                y: height - LEGEND_H },
            { x: width - LEGEND_W, y: height - LEGEND_H },
        ].map(c => ({
            ...c,
            count: points.filter(p => {
                const px = xScale(p.x), py = yScale(p.y);
                return px >= c.x - PAD && px <= c.x + LEGEND_W + PAD
                    && py >= c.y - PAD && py <= c.y + LEGEND_H + PAD;
            }).length,
        }));

        const best = corners.reduce((a, b) => a.count <= b.count ? a : b);

        const legend = svg.append("g")
            .attr("class", "scatter-dec-legend")
            .attr("transform", `translate(${best.x + 4}, ${best.y + 6})`);
        legend.append("text")
            .attr("x", 0).attr("y", 0)
            .attr("text-anchor", "start")
            .attr("class", "scatter-legend-label")
            .style("font-weight", "600")
            .text(title);
        legendItems.forEach(({ label, color }, i) => {
            const row = legend.append("g").attr("transform", `translate(0, ${16 + i * 18})`);
            row.append("circle").attr("r", 5).attr("cx", 5).attr("cy", 0).attr("fill", color);
            row.append("text").attr("x", 14).attr("y", 4).attr("text-anchor", "start")
                .attr("class", "scatter-legend-label").text(label);
        });
    };

    if (frontierColorOverrides && frontierLegendItems.length > 0) {
        _renderScatterLegend(frontierLegendItems, "Frontier");
    } else if (groupColorOverrides && decisionColumns.length > 0) {
        const hasGroups = groups && Object.keys(groups).length > 0;
        const legendItems = hasGroups
            ? getGroupOrder(decisionColumns, groups).map((grp, gi) => ({ label: grp, color: getGroupBaseColor(gi) }))
            : decisionColumns.map((col, i) => ({ label: col, color: getColumnColor(i) }));
        _renderScatterLegend(legendItems, "Dominant Allocation");
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
            window.dispatchEvent(new CustomEvent('survey:action', { detail: { type: 'lasso_selection', count: selectedRows.length } }));
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
        const hasSelection = rowIndexSet !== null;
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
    setSelection(getEffectiveSelection());

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

    // Subscribers don't fire on re-render, so reapply state manually.
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
        .text((column) => formatLabel(column));
}
