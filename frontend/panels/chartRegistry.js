function createChartRegistry(interactionOptions) {
    return {
        table: {
            key: "table",
            label: "Table",
            needsAxes: false,
            canRender: () => true,
            render: ({ containerSelector, columns, data, animate = false }) => {
                renderTable(containerSelector, columns, data, {
                    ...interactionOptions,
                    animate,
                });
            },
        },
        scatter: {
            key: "scatter",
            label: "2D Scatterplot",
            needsAxes: true,
            canRender: ({ numericColumns }) => numericColumns.length >= 2,
            render: ({ containerSelector, data, xAxis, yAxis, animate = false }) => {
                renderScatterplot(containerSelector, data, xAxis, yAxis, {
                    ...interactionOptions,
                    animate,
                });
            },
        },
        barChart: {
            key: "barChart",
            label: "Column Chart",
            needsAxes: false,
            canRender: ({ numericColumns }) => numericColumns.length >= 1,
            render: ({ containerSelector, columns, data, animate = false }) => {
                renderBarChart(containerSelector, columns, data, {
                    ...interactionOptions,
                    animate,
                });
            },
        },
    };
}
