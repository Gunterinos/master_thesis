import * as d3 from 'd3';
import './barChart.css';
import { subscribe, getActiveRowIndex } from '../state/appState.js';

function applyBarChartHighlight(rowIndex) {
    const hasActive = rowIndex !== null;
    const isActive = (el) => hasActive && Number(el.dataset.rowIndex) === rowIndex;

    d3.selectAll('.bar-chart-segment[data-row-index]')
        .classed('is-linked-highlight', function () { return isActive(this); })
        .classed('is-linked-dim', function () { return hasActive && !isActive(this); });
}

subscribe('hover-change', applyBarChartHighlight);

export function renderBarChart(containerSelector, columns, data, options = {}) {
    const { onHoverStart = () => {}, onHoverEnd = () => {}, animate = false } = options;
    const container = d3.select(containerSelector);

    const tooltip = d3
        .select("body")
        .selectAll(".bar-chart-tooltip")
        .data([null])
        .join("div")
        .attr("class", "bar-chart-tooltip");

    const containerNode = container.node();
    if (!containerNode) {
        return;
    }

    const containerWidth = Math.max(440, containerNode.clientWidth || 0);
    const containerHeight = Math.max(300, containerNode.clientHeight || 0);

    const baseMargin = { top: 24, right: 24, bottom: 56, left: 56 };
    const estimatedWidth = containerWidth - baseMargin.left - baseMargin.right;
    const legendItemWidth = 140;
    const legendRowHeight = 20;
    const legendItemsPerRow = Math.max(1, Math.floor(estimatedWidth / legendItemWidth));
    const legendRows = Math.ceil(columns.length / legendItemsPerRow);
    const legendHeight = legendRows * legendRowHeight + 8;

    const margin = {
        top: baseMargin.top,
        right: baseMargin.right,
        bottom: baseMargin.bottom + legendHeight,
        left: baseMargin.left,
    };
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    const positionTooltip = (event) => {
        const tooltipNode = tooltip.node();
        if (!tooltipNode) {
            return;
        }

        const gap = 12;
        const tooltipWidth = tooltipNode.offsetWidth;
        const tooltipHeight = tooltipNode.offsetHeight;

        let left = event.pageX + gap;
        if (left + tooltipWidth > window.innerWidth - 12) {
            left = event.pageX - tooltipWidth - gap;
        }
        left = Math.max(12, left);

        let top = event.pageY - tooltipHeight / 2;
        if (top + tooltipHeight > window.innerHeight - 12) {
            top = window.innerHeight - tooltipHeight - 12;
        }
        top = Math.max(12, top);

        tooltip.style("left", `${left}px`).style("top", `${top}px`);
    };

    const rows = data
        .map((row, index) => {
            const rowIndex = row.__rowIndex ?? index;
            const values = columns
                .map((column) => ({
                    key: column,
                    value: Number(row[column]),
                    rawValue: row[column],
                }))
                .filter((entry) => Number.isFinite(entry.value) && entry.value >= 0);

            const total = d3.sum(values, (entry) => entry.value);
            if (values.length === 0 || total <= 0) {
                return null;
            }

            let cumulative = 0;
            const segments = values.map((entry) => {
                const share = entry.value / total;
                const start = cumulative;
                cumulative += share;
                return {
                    ...entry,
                    share,
                    y0: start,
                    y1: cumulative,
                };
            });

            return {
                rowIndex,
                pointLabel: String(rowIndex + 1),
                segments,
            };
        })
        .filter((row) => row !== null);

    // Use incremental update when animate=true and an SVG already exists.
    const existingSvg = container.select("svg");
    const isUpdate = animate && !existingSvg.empty();

    if (rows.length === 0) {
        container.selectAll("*").remove();
        container.append("p").text("No valid non-negative numeric bar chart data.");
        return;
    }

    const xScale = d3
        .scaleBand()
        .domain(rows.map((row) => row.pointLabel))
        .range([0, width])
        .paddingInner(0.2)
        .paddingOuter(0.1);

    const yScale = d3.scaleLinear().domain([0, 1]).range([height, 0]);

    const colorScale = d3.scaleOrdinal(d3.schemeTableau10).domain(columns);

    const xAxis = d3.axisBottom(xScale);
    if (rows.length > 20) {
        const step = Math.ceil(rows.length / 10);
        xAxis.tickValues(rows.filter((row, idx) => idx % step === 0).map((row) => row.pointLabel));
    }

    const transition = d3.transition().duration(420);

    // Full redraw (first render or non-animated call)
    if (!isUpdate) {
        container.selectAll("*").remove();

        const svgRoot = container
            .append("svg")
            .attr("viewBox", `0 0 ${containerWidth} ${containerHeight}`)
            .attr("preserveAspectRatio", "none");

        const svg = svgRoot
            .append("g")
            .attr("class", "chart-root")
            .attr("transform", `translate(${margin.left}, ${margin.top})`);

        svg.append("g").attr("class", "x-axis").attr("transform", `translate(0, ${height})`).call(xAxis);

        svg.append("g").attr("class", "y-axis").call(
            d3
                .axisLeft(yScale)
                .ticks(5)
                .tickFormat((value) => `${Math.round(value * 100)}%`),
        );

        svg
            .append("text")
            .attr("class", "x-label")
            .attr("x", width / 2)
            .attr("y", height + 44)
            .attr("text-anchor", "middle")
            .text("Point");

        svg
            .append("text")
            .attr("class", "y-label")
            .attr("transform", "rotate(-90)")
            .attr("x", -height / 2)
            .attr("y", -40)
            .attr("text-anchor", "middle")
            .text("Percentage");

        const legendGroup = svg
            .append("g")
            .attr("class", "bar-chart-legend")
            .attr("transform", `translate(0, ${height + 64})`);

        const legendItems = legendGroup
            .selectAll("g")
            .data(columns)
            .enter()
            .append("g")
            .attr("transform", (column, index) => {
                const rowIndex = Math.floor(index / legendItemsPerRow);
                const columnIndex = index % legendItemsPerRow;
                return `translate(${columnIndex * legendItemWidth}, ${rowIndex * legendRowHeight})`;
            });

        legendItems
            .append("rect")
            .attr("x", 0)
            .attr("y", 1)
            .attr("width", 12)
            .attr("height", 12)
            .attr("rx", 3)
            .attr("fill", (column) => colorScale(column));

        legendItems
            .append("text")
            .attr("x", 18)
            .attr("y", 11)
            .text((column) => column);

        const barsRoot = svg.append("g").attr("class", "bars-root");

        const barGroup = barsRoot
            .selectAll("g.bar-chart-bar")
            .data(rows, (row) => row.rowIndex)
            .enter()
            .append("g")
            .attr("class", "bar-chart-bar")
            .attr("data-row-index", (row) => row.rowIndex)
            .attr("transform", (row) => `translate(${xScale(row.pointLabel)}, 0)`);

        barGroup
            .selectAll("rect")
            .data((row) =>
                row.segments.map((segment) => ({
                    ...segment,
                    rowIndex: row.rowIndex,
                    pointLabel: row.pointLabel,
                    allSegments: row.segments,
                })),
                (segment) => segment.key,
            )
            .enter()
            .append("rect")
            .attr("class", "bar-chart-segment")
            .attr("data-row-index", (segment) => segment.rowIndex)
            .attr("x", 0)
            .attr("y", (segment) => (animate ? yScale(0) : yScale(segment.y1)))
            .attr("width", xScale.bandwidth())
            .attr("height", (segment) => (animate ? 0 : yScale(segment.y0) - yScale(segment.y1)))
            .attr("fill", (segment) => colorScale(segment.key))
            .on("mouseenter", (event, segment) => {
                onHoverStart(segment.rowIndex);
                const compositionDetails = segment.allSegments
                    .map((entry) => `${entry.key}: ${(entry.share * 100).toFixed(2)}%`)
                    .join("<br>");
                tooltip
                    .classed("visible", true)
                    .html(`Point: ${segment.pointLabel}<br>${compositionDetails}`);
                positionTooltip(event);
            })
            .on("mousemove", (event) => {
                positionTooltip(event);
            })
            .on("mouseleave", () => {
                onHoverEnd();
                tooltip.classed("visible", false);
            });

        if (animate) {
            barGroup
                .selectAll("rect")
                .transition(transition)
                .attr("y", (segment) => yScale(segment.y1))
                .attr("height", (segment) => yScale(segment.y0) - yScale(segment.y1));
        }

        return;
    }

    // Incremental animated update
    const svg = existingSvg.select("g.chart-root");

    // Update axes with transition
    svg.select(".x-axis").transition(transition).call(xAxis);

    // Update bar groups keyed by rowIndex
    const barsRoot = svg.select(".bars-root");
    const barGroupSel = barsRoot
        .selectAll("g.bar-chart-bar")
        .data(rows, (row) => row.rowIndex);

    // EXIT: shrink segments to zero, then remove
    barGroupSel
        .exit()
        .selectAll("rect.bar-chart-segment")
        .transition(transition)
        .attr("y", yScale(0))
        .attr("height", 0);

    barGroupSel.exit().transition(transition).remove();

    // ENTER: start at zero height so they grow in
    const barGroupEnter = barGroupSel
        .enter()
        .append("g")
        .attr("class", "bar-chart-bar")
        .attr("data-row-index", (row) => row.rowIndex)
        .attr("transform", (row) => `translate(${xScale(row.pointLabel)}, 0)`);

    // ENTER + UPDATE
    const barGroupMerge = barGroupEnter.merge(barGroupSel);

    // Slide existing bars to their new x positions
    barGroupMerge.transition(transition).attr("transform", (row) => `translate(${xScale(row.pointLabel)}, 0)`);

    // Update segment rects per bar
    barGroupMerge.each(function (row) {
        const g = d3.select(this);
        const segmentData = row.segments.map((segment) => ({
            ...segment,
            rowIndex: row.rowIndex,
            pointLabel: row.pointLabel,
            allSegments: row.segments,
        }));

        const segSel = g
            .selectAll("rect.bar-chart-segment")
            .data(segmentData, (segment) => segment.key);

        // EXIT segments: shrink to zero and remove
        segSel
            .exit()
            .transition(transition)
            .attr("y", yScale(0))
            .attr("height", 0)
            .remove();

        // ENTER segments: start at zero height
        const segEnter = segSel
            .enter()
            .append("rect")
            .attr("class", "bar-chart-segment")
            .attr("data-row-index", (segment) => segment.rowIndex)
            .attr("x", 0)
            .attr("y", yScale(0))
            .attr("width", xScale.bandwidth())
            .attr("height", 0)
            .attr("fill", (segment) => colorScale(segment.key))
            .on("mouseenter", (event, segment) => {
                onHoverStart(segment.rowIndex);
                const compositionDetails = segment.allSegments
                    .map((entry) => `${entry.key}: ${(entry.share * 100).toFixed(2)}%`)
                    .join("<br>");
                tooltip
                    .classed("visible", true)
                    .html(`Point: ${segment.pointLabel}<br>${compositionDetails}`);
                positionTooltip(event);
            })
            .on("mousemove", (event) => {
                positionTooltip(event);
            })
            .on("mouseleave", () => {
                onHoverEnd();
                tooltip.classed("visible", false);
            });

        // ENTER + UPDATE: transition to target position
        segEnter
            .merge(segSel)
            .transition(transition)
            .attr("y", (segment) => yScale(segment.y1))
            .attr("height", (segment) => yScale(segment.y0) - yScale(segment.y1))
            .attr("width", xScale.bandwidth());
    });

    applyBarChartHighlight(getActiveRowIndex());
}
