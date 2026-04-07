import { renderTable } from '../tables/tables.js';
import { renderScatterplot } from '../scatterplot/scatterplot.js';
import { renderScatterplot3dGL } from '../scatterplot3dGL/scatterplot3dGL.js';
import { renderBarChart } from '../barChart/barChart.js';
import { renderParallelCoords } from '../parallelCoords/parallelCoords.js';
import { renderRadviz } from '../radviz/radviz.js';

export function createChartRegistry(interactionOptions) {
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
            render: ({ containerSelector, data, xAxis, yAxis, animate = false, showLabels = false, pcaLabels = null }) => {
                renderScatterplot(containerSelector, data, xAxis, yAxis, {
                    ...interactionOptions,
                    animate,
                    showLabels,
                    pcaLabels,
                });
            },
        },
        scatter3dGL: {
            key: "scatter3dGL",
            label: "3D Scatterplot",
            needsAxes: true,
            needsZAxis: true,
            canRender: ({ numericColumns }) => numericColumns.length >= 3,
            render: ({ containerSelector, data, objectiveDirections = {}, xAxis, yAxis, zAxis, animate = false, showLabels = false, showSurface = false, showDominated = false, showIdealPoint = false }) => {
                renderScatterplot3dGL(containerSelector, data, xAxis, yAxis, zAxis, {
                    ...interactionOptions,
                    objectiveDirections,
                    animate,
                    showLabels,
                    showSurface,
                    showDominated,
                    showIdealPoint,
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
        pcp: {
            key: "pcp",
            label: "Parallel Coordinates",
            needsAxes: false,
            canRender: ({ numericColumns }) => numericColumns.length >= 2,
            render: ({ containerSelector, columns, data, objectiveDirections = {}, animate = false }) => {
                renderParallelCoords(containerSelector, columns, data, {
                    ...interactionOptions,
                    objectiveDirections,
                    animate,
                });
            },
        },
        radviz: {
            key: "radviz",
            label: "RadViz",
            needsAxes: false,
            isFullScreen: true,
            canRender: ({ numericColumns }) => numericColumns.length >= 3,
            render: ({ containerSelector, columns, data, animate = false }) => {
                renderRadviz(containerSelector, data, columns, {
                    ...interactionOptions,
                    animate,
                });
            },
        },
    };
}
