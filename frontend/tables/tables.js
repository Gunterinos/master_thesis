function renderTable(containerSelector, columns, data, options = {}) {
    const { onHoverStart = () => {}, onHoverEnd = () => {} } = options;
    const container = d3.select(containerSelector);
    container.selectAll("*").remove();

    const table = container.append("table");
    const thead = table.append("thead");
    const tbody = table.append("tbody");

    thead
        .append("tr")
        .selectAll("th")
        .data(columns)
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
        .data((row) => columns.map((column) => row[column]))
        .enter()
        .append("td")
        .text((value) => {
            const numericValue = Number(value);
            if (Number.isFinite(numericValue)) {
                return numericValue.toFixed(3);
            }

            return value;
        });
}

function getNumericColumns(data, columns) {
    if (!data || data.length === 0) {
        return [];
    }

    return columns.filter((column) => data.some((row) => Number.isFinite(Number(row[column]))));
}
