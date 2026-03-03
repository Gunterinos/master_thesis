function renderTable(containerSelector, columns, data, options = {}) {
    const { onHoverStart = () => {}, onHoverEnd = () => {}, animate = false } = options;
    const container = d3.select(containerSelector);
    container.selectAll("*").remove();
    const tableColumns = ["Point", ...columns];

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
        .data(data)
        .enter()
        .append("tr")
        .attr("data-row-index", (row, index) => row.__rowIndex ?? index)
        .on("mouseenter", (event, row) => {
            onHoverStart(row.__rowIndex);
        })
        .on("mouseleave", () => {
            onHoverEnd();
        });

    rows
        .selectAll("td")
        .data((row) => [row.__rowIndex + 1, ...columns.map((column) => row[column])])
        .enter()
        .append("td")
        .text((value, cellIndex) => {
            if (cellIndex === 0) {
                return String(Math.trunc(Number(value)));
            }

            const numericValue = Number(value);
            if (Number.isFinite(numericValue)) {
                return numericValue.toFixed(3);
            }

            return value;
        });

    if (animate) {
        rows
            .style("opacity", 0)
            .style("transform", "translateY(4px)")
            .transition()
            .duration(350)
            .style("opacity", 1)
            .style("transform", "translateY(0)");
    }
}

function getNumericColumns(data, columns) {
    if (!data || data.length === 0) {
        return [];
    }

    return columns.filter((column) => data.some((row) => Number.isFinite(Number(row[column]))));
}
