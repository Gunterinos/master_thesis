import { initializeSpacePanel } from './spacePanel.js';

export function initializeObjectivesSpacePanel(config) {
    const { data, objectiveDirections = {}, chartRegistry, renderOptions = {}, onAfterRender, groups = {} } = config;
    const allColumns = Object.keys(data[0]);
    const objectiveColumns = allColumns.filter((column) => column.startsWith("obj"));
    const decisionColumns = allColumns.filter((column) => column.startsWith("dec"));

    initializeSpacePanel({
        containerSelector: "#objectives-container",
        chartSelectSelector: "#objectives-chart-select",
        xAxisSelector: "#objectives-x-axis",
        yAxisSelector: "#objectives-y-axis",
        zAxisSelector: "#objectives-z-axis",
        xLabelSelector: 'label[for="objectives-x-axis"]',
        yLabelSelector: 'label[for="objectives-y-axis"]',
        zLabelSelector: 'label[for="objectives-z-axis"]',
        labelsToggleSelector: "#objectives-labels-toggle",
        pcaToggleSelector: "#objectives-pca-toggle",
        decGroupsToggleSelector: "#objectives-dec-groups-toggle",
        decGroupsBtnSelector: "#objectives-dec-groups-btn",
        frontierColorsToggleSelector: "#objectives-frontier-colors-toggle",
        optionsDropdownSelector: "#objectives-options-dropdown",
        spreadSliderSelector: "#objectives-spread",
        surfaceToggleSelector: "#objectives-surface-toggle",
        dominatedToggleSelector: "#objectives-dominated-toggle",
        idealToggleSelector: "#objectives-ideal-toggle",
        columns: objectiveColumns,
        decisionColumns,
        data,
        objectiveDirections,
        defaultChart: "scatter",
        groups,
        chartKeys: ["scatter", "scatter3dGL", "pcp", "radar", "radviz", "correlationHeatmap"],
        chartRegistry,
        renderOptions,
        onAfterRender,
    });
}
