function initializeDecisionSpacePanel(config) {
    const { data, chartRegistry, renderOptions = {}, onAfterRender } = config;
    const allColumns = Object.keys(data[0]);
    const decisionColumns = allColumns.filter((column) => column.startsWith("dec"));

    initializeSpacePanel({
        containerSelector: "#decision-container",
        chartSelectSelector: "#decision-chart-select",
        xAxisSelector: "#decision-x-axis",
        yAxisSelector: "#decision-y-axis",
        xLabelSelector: 'label[for="decision-x-axis"]',
        yLabelSelector: 'label[for="decision-y-axis"]',
        labelsToggleSelector: "#decision-labels-toggle",
        columns: decisionColumns,
        data,
        defaultChart: "barChart",
        chartKeys: ["table", "barChart"],
        chartRegistry,
        renderOptions,
        onAfterRender,
    });
}
