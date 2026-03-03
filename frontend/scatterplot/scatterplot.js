function renderScatterplot(containerSelector, data, xKey, yKey, options = {}) {
    const { onHoverStart = () => {}, onHoverEnd = () => {} } = options;
    const container = d3.select(containerSelector);
    container.selectAll("*").remove();

    const tooltip = d3
        .select("body")
        .selectAll(".scatter-tooltip")
        .data([null])
        .join("div")
        .attr("class", "scatter-tooltip");

    const containerNode = container.node();
    if (!containerNode) {
        return;
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

    const svg = container
        .append("svg")
        .attr("viewBox", `0 0 ${containerWidth} ${containerHeight}`)
        .attr("preserveAspectRatio", "none")
        .append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);

    svg
        .append("g")
        .attr("transform", `translate(0, ${height})`)
        .call(d3.axisBottom(xScale));

    svg.append("g").call(d3.axisLeft(yScale));

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

    svg
        .append("g")
        .selectAll("circle")
        .data(points)
        .enter()
        .append("circle")
        .attr("class", "scatter-point")
        .attr("data-row-index", (point) => point.rowIndex)
        .attr("cx", (point) => xScale(point.x))
        .attr("cy", (point) => yScale(point.y))
        .attr("r", 4)
        .attr("fill", "#34c759")
        .attr("opacity", 0.9)
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
}

function populateAxisSelect(select, columns) {
    select.selectAll("*").remove();

    select
        .selectAll("option")
        .data(columns)
        .enter()
        .append("option")
        .attr("value", (column) => column)
        .text((column) => column);
}
