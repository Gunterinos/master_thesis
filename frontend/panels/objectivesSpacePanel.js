function initializeObjectivesSpacePanel(config) {
    const { data, chartRegistry, renderOptions = {}, onAfterRender } = config;
    const allColumns = Object.keys(data[0]);
    const objectiveColumns = allColumns.filter((column) => column.startsWith("obj"));

    initializeSpacePanel({
        containerSelector: "#objectives-container",
        chartSelectSelector: "#objectives-chart-select",
        xAxisSelector: "#objectives-x-axis",
        yAxisSelector: "#objectives-y-axis",
        xLabelSelector: 'label[for="objectives-x-axis"]',
        yLabelSelector: 'label[for="objectives-y-axis"]',
        labelsToggleSelector: "#objectives-labels-toggle",
        columns: objectiveColumns,
        data,
        defaultChart: "scatter",
        chartKeys: ["scatter"],
        chartRegistry,
        renderOptions,
        onAfterRender,
    });
}
