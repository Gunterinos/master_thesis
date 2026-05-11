import { renderTable } from '../tables/tables.js';
import { renderScatterplot } from '../scatterplot/scatterplot.js';
import { renderScatterplot3dGL } from '../scatterplot3dGL/scatterplot3dGL.js';
import { renderBarChart } from '../barChart/barChart.js';
import { renderParallelCoords } from '../parallelCoords/parallelCoords.js';
import { renderRadviz } from '../radviz/radviz.js';
import { renderRadarChart } from '../radarChart/radarChart.js';
import { renderCorrelationHeatmap } from '../correlationHeatmap/correlationHeatmap.js';
import { getColumnColor } from '../colors.js';

export const chartIconMap = {
    table:              '/icons/Table.svg',
    scatter:            '/icons/2D_Scatter.svg',
    scatter3dGL:        '/icons/3D_ScatterPlot.svg',
    pcp:                '/icons/PCP.svg',
    radar:              '/icons/radarChart.svg',
    radviz:             '/icons/RadViz.svg',
    correlationHeatmap: '/icons/Heatmap.svg',
    barChart:           '/icons/BarChart.svg',
};

export function createChartRegistry(interactionOptions) {
    return {
        table: {
            key: "table",
            label: "Table",
            description: "View raw data in sortable, filterable rows",
            needsAxes: false,
            canRender: () => true,
            render: ({ containerSelector, columns, data, animate = false, groups = {}, measures = {}, frontierOrder = null }) => {
                const columnColors = Object.fromEntries(
                    columns.map((col, i) => [col, getColumnColor(i)])
                );
                renderTable(containerSelector, columns, data, {
                    ...interactionOptions,
                    onBrushFilterChange: (passingRowIndices) =>
                        interactionOptions.onTableBrushFilterChange(containerSelector, passingRowIndices),
                    animate,
                    columnColors,
                    groups,
                    measures,
                    frontierOrder,
                });
            },
        },
        scatter: {
            key: "scatter",
            label: "2D Scatterplot",
            description: "Plot two objectives on X and Y axes",
            needsAxes: true,
            canRender: ({ numericColumns }) => numericColumns.length >= 2,
            render: ({ containerSelector, data, xAxis, yAxis, animate = false, showLabels = false, pcaLabels = null, groupColorOverrides = null, decisionColumns = [], groups = {}, measures = {}, frontierColorOverrides = null, frontierLegendItems = [] }) => {
                renderScatterplot(containerSelector, data, xAxis, yAxis, {
                    ...interactionOptions,
                    animate,
                    showLabels,
                    pcaLabels,
                    groupColorOverrides,
                    decisionColumns,
                    groups,
                    measures,
                    frontierColorOverrides,
                    frontierLegendItems,
                });
            },
        },
        scatter3dGL: {
            key: "scatter3dGL",
            label: "3D Scatterplot",
            description: "Plot three objectives in 3D space",
            needsAxes: true,
            needsZAxis: true,
            canRender: ({ numericColumns }) => numericColumns.length >= 3,
            render: ({ containerSelector, data, objectiveDirections = {}, xAxis, yAxis, zAxis, animate = false, showLabels = false, showSurface = false, showDominated = false, showIdealPoint = false, groupColorOverrides = null, decisionColumns = [], groups = {}, measures = {}, frontierColorOverrides = null, frontierLegendItems = [] }) => {
                renderScatterplot3dGL(containerSelector, data, xAxis, yAxis, zAxis, {
                    ...interactionOptions,
                    objectiveDirections,
                    animate,
                    showLabels,
                    showSurface,
                    showDominated,
                    showIdealPoint,
                    groupColorOverrides,
                    decisionColumns,
                    measures,
                    groups,
                    frontierColorOverrides,
                    frontierLegendItems,
                });
            },
        },
        barChart: {
            key: "barChart",
            label: "Column Chart",
            description: "Compare allocations as grouped bars",
            needsAxes: false,
            canRender: ({ numericColumns }) => numericColumns.length >= 1,
            render: ({ containerSelector, columns, data, groups = {} }) => {
                renderBarChart(containerSelector, columns, data, {
                    ...interactionOptions,
                    groups,
                });
            },
        },
        pcp: {
            key: "pcp",
            label: "Parallel Coordinates",
            description: "Compare all objectives as parallel vertical axes",
            needsAxes: false,
            canRender: ({ numericColumns }) => numericColumns.length >= 2,
            render: ({ containerSelector, columns, data, objectiveDirections = {}, animate = false, groupColorOverrides = null, decisionColumns = [], groups = {}, measures = {}, frontierColorOverrides = null, frontierLegendItems = [] }) => {
                renderParallelCoords(containerSelector, columns, data, {
                    ...interactionOptions,
                    objectiveDirections,
                    animate,
                    groupColorOverrides,
                    decisionColumns,
                    groups,
                    measures,
                    frontierColorOverrides,
                    frontierLegendItems,
                });
            },
        },
        radar: {
            key: "radar",
            label: "Radar Chart",
            description: "Compare objectives on radial axes from center",
            needsAxes: false,
            canRender: ({ numericColumns }) => numericColumns.length >= 3,
            render: ({ containerSelector, columns, data, objectiveDirections = {}, animate = false, groupColorOverrides = null, decisionColumns = [], groups = {}, measures = {}, frontierColorOverrides = null, frontierLegendItems = [] }) => {
                renderRadarChart(containerSelector, columns, data, {
                    ...interactionOptions,
                    objectiveDirections,
                    animate,
                    groupColorOverrides,
                    decisionColumns,
                    groups,
                    measures,
                    frontierColorOverrides,
                    frontierLegendItems,
                });
            },
        },
        radviz: {
            key: "radviz",
            label: "RadViz",
            description: "Position points by attraction to objective anchors",
            needsAxes: false,
            canRender: ({ numericColumns }) => numericColumns.length >= 3,
            render: ({ containerSelector, columns, data, animate = false, groups = {}, measures = {}, frontierColorOverrides = null, frontierLegendItems = [] }) => {
                renderRadviz(containerSelector, data, columns, {
                    ...interactionOptions,
                    animate,
                    groups,
                    measures,
                    frontierColorOverrides,
                    frontierLegendItems,
                });
            },
        },
        correlationHeatmap: {
            key: "correlationHeatmap",
            label: "Correlation Heatmap",
            description: "Show pairwise correlations between objectives",
            needsAxes: false,
            canRender: ({ numericColumns }) => numericColumns.length >= 2,
            render: ({ containerSelector, columns, data, decisionColumns = [], animate = false }) => {
                renderCorrelationHeatmap(containerSelector, columns, data, {
                    decisionColumns,
                    animate,
                });
            },
        },
    };
}
