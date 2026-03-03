function createChartRegistry(interactionOptions) {
    return {
        table: {
            key: "table",
            label: "Table",
            needsAxes: false,
            canRender: () => true,
            render: ({ containerSelector, columns, data }) => {
                renderTable(containerSelector, columns, data, interactionOptions);
            },
        },
        scatter: {
            key: "scatter",
            label: "2D Scatterplot",
            needsAxes: true,
            canRender: ({ numericColumns }) => numericColumns.length >= 2,
            render: ({ containerSelector, data, xAxis, yAxis }) => {
                renderScatterplot(containerSelector, data, xAxis, yAxis, interactionOptions);
            },
        },
    };
}
