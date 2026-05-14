import { initializeSpacePanel } from './spacePanel.js';

export function initializeDecisionSpacePanel(config) {
    const { data, chartRegistry, renderOptions = {}, onAfterRender, groups = {}, frontierOrder = null, disabledCharts = null, forceEmptyState = false, emptyStateText = null } = config;
    const allColumns = Object.keys(data[0]);
    const decisionColumns = allColumns.filter((column) => column.startsWith("dec"));

    const allChartKeys = ["table", "barChart"];
    const chartKeys = disabledCharts ? allChartKeys.filter(k => !disabledCharts.includes(k)) : allChartKeys;

    initializeSpacePanel({
        containerSelector: "#decision-container",
        chartSelectSelector: "#decision-chart-select",
        chartButtonsSelector: "#decision-chart-buttons",
        xAxisSelector: "#decision-x-axis",
        yAxisSelector: "#decision-y-axis",
        xLabelSelector: 'label[for="decision-x-axis"]',
        yLabelSelector: 'label[for="decision-y-axis"]',
        columns: decisionColumns,
        data,
        defaultChart: "barChart",
        chartKeys,
        chartRegistry,
        renderOptions,
        onAfterRender,
        groups,
        frontierOrder,
        forceEmptyState,
        emptyStateText,
    });
}
