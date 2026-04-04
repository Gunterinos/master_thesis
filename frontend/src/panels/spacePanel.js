import * as d3 from 'd3';
import { getNumericColumns } from '../tables/tables.js';
import { populateAxisSelect } from '../scatterplot/scatterplot.js';
import { populateAxisSelect3dGL } from '../scatterplot3dGL/scatterplot3dGL.js';

export function initializeSpacePanel(config) {
    const {
        containerSelector,
        chartSelectSelector,
        xAxisSelector,
        yAxisSelector,
        zAxisSelector = null,
        xLabelSelector,
        yLabelSelector,
        zLabelSelector = null,
        labelsToggleSelector = null,
        surfaceToggleSelector = null,
        dominatedToggleSelector = null,
        idealToggleSelector = null,
        pcaToggleSelector = null,
        columns,
        data,
        objectiveDirections = {},
        defaultChart,
        chartKeys,
        chartRegistry,
        renderOptions = {},
        onAfterRender = () => {},
    } = config;

    const chartSelect = d3.select(chartSelectSelector);
    const chartSelectId = chartSelectSelector.startsWith("#")
        ? chartSelectSelector.slice(1)
        : chartSelectSelector;
    const chartLabel = d3.select(`label[for="${chartSelectId}"]`);
    const xAxisSelect = d3.select(xAxisSelector);
    const yAxisSelect = d3.select(yAxisSelector);
    const zAxisSelect = zAxisSelector ? d3.select(zAxisSelector) : null;
    const xLabel = d3.select(xLabelSelector);
    const yLabel = d3.select(yLabelSelector);
    const zLabel = zLabelSelector ? d3.select(zLabelSelector) : null;
    const labelsToggle = labelsToggleSelector ? d3.select(labelsToggleSelector) : null;
    const surfaceToggle = surfaceToggleSelector ? d3.select(surfaceToggleSelector) : null;
    const dominatedToggle = dominatedToggleSelector ? d3.select(dominatedToggleSelector) : null;
    const idealToggle = idealToggleSelector ? d3.select(idealToggleSelector) : null;
    const pcaToggle = pcaToggleSelector ? d3.select(pcaToggleSelector) : null;
    // Persist toggle state across re-renders via button's active class
    let showLabels = labelsToggle ? labelsToggle.classed("active") : false;
    let showPCA = pcaToggle ? pcaToggle.classed("active") : false;
    let showSurface = surfaceToggle ? surfaceToggle.classed("active") : false;
    let showDominated = dominatedToggle ? dominatedToggle.classed("active") : false;
    let showIdealPoint = idealToggle ? idealToggle.classed("active") : false;

    const previousChart = chartSelect.property("value");
    const previousXAxis = xAxisSelect.property("value");
    const previousYAxis = yAxisSelect.property("value");
    const previousZAxis = zAxisSelect ? zAxisSelect.property("value") : null;

    const numericColumns = getNumericColumns(data, columns);
    const charts = chartKeys
        .map((chartKey) => chartRegistry[chartKey])
        .filter((chart) => chart && chart.canRender({ numericColumns }));

    chartSelect.selectAll("*").remove();
    chartSelect
        .selectAll("option")
        .data(charts)
        .enter()
        .append("option")
        .attr("value", (chart) => chart.key)
        .text((chart) => chart.label);

    const fallbackChart = charts[0]?.key ?? "table";
    const selectedChart = [previousChart, defaultChart, fallbackChart].find((chartKey) =>
        charts.some((chart) => chart.key === chartKey),
    );
    chartSelect.property("value", selectedChart);

    const hasChartChoice = charts.length > 1;
    chartSelect.classed("hidden", !hasChartChoice);
    chartLabel.classed("hidden", !hasChartChoice);

    const scatterEnabled = charts.some((chart) => chart.key === "scatter" || chart.key === "scatter3dGL");
    if (scatterEnabled) {
        populateAxisSelect(xAxisSelect, numericColumns);
        populateAxisSelect(yAxisSelect, numericColumns);

        const defaultYAxis = numericColumns[1] || numericColumns[0];
        const selectedXAxis = numericColumns.includes(previousXAxis) ? previousXAxis : numericColumns[0];
        const selectedYAxis = numericColumns.includes(previousYAxis) ? previousYAxis : defaultYAxis;

        xAxisSelect.property("value", selectedXAxis);
        yAxisSelect.property("value", selectedYAxis);

        if (zAxisSelect) {
            populateAxisSelect3dGL(zAxisSelect, numericColumns);
            const defaultZAxis = numericColumns[2] || numericColumns[0];
            const selectedZAxis = numericColumns.includes(previousZAxis) ? previousZAxis : defaultZAxis;
            zAxisSelect.property("value", selectedZAxis);
        }
    }

    const updatePanel = () => {
        const chartType = chartSelect.property("value");
        const chartConfig = chartRegistry[chartType];
        const isScatter = chartConfig?.needsAxes === true;
        const needsZ = chartConfig?.needsZAxis === true;
        const isPCA = showPCA && isScatter && !needsZ;

        xAxisSelect.classed("hidden", !isScatter || isPCA);
        yAxisSelect.classed("hidden", !isScatter || isPCA);
        xLabel.classed("hidden", !isScatter || isPCA);
        yLabel.classed("hidden", !isScatter || isPCA);
        if (zAxisSelect) zAxisSelect.classed("hidden", !needsZ);
        if (zLabel)      zLabel.classed("hidden", !needsZ);
        if (labelsToggle) {
            labelsToggle.classed("hidden", !isScatter);
        }
        if (pcaToggle) {
            pcaToggle.classed("hidden", !isScatter || needsZ);
        }
        if (surfaceToggle) {
            surfaceToggle.classed("hidden", !needsZ);
        }
        if (dominatedToggle) {
            dominatedToggle.classed("hidden", !needsZ);
        }
        if (idealToggle) {
            idealToggle.classed("hidden", !needsZ);
        }

        if (!chartConfig) {
            return;
        }

        const renderWith = (renderData, pcaLabels = null) => {
            chartConfig.render({
                containerSelector,
                columns,
                data: renderData,
                objectiveDirections,
                xAxis: pcaLabels ? '__pc1' : xAxisSelect.property("value"),
                yAxis: pcaLabels ? '__pc2' : yAxisSelect.property("value"),
                zAxis: zAxisSelect ? zAxisSelect.property("value") : undefined,
                animate: renderOptions.animate === true,
                showLabels,
                showSurface,
                showDominated,
                showIdealPoint,
                pcaLabels,
            });
            onAfterRender();
        };

        if (isPCA) {
            fetch('/api/pca', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rows: data, columns: numericColumns }),
            })
                .then(r => r.json())
                .then(({ rows, pc1Label, pc2Label }) => {
                    renderWith(rows, { x: pc1Label, y: pc2Label });
                });
        } else {
            renderWith(data);
        }
    };

    if (labelsToggle) {
        labelsToggle.on("click", () => {
            showLabels = !showLabels;
            labelsToggle.classed("active", showLabels);
            updatePanel();
        });
    }

    if (surfaceToggle) {
        surfaceToggle.on("click", () => {
            showSurface = !showSurface;
            surfaceToggle.classed("active", showSurface);
            updatePanel();
        });
    }

    if (dominatedToggle) {
        dominatedToggle.on("click", () => {
            showDominated = !showDominated;
            dominatedToggle.classed("active", showDominated);
            updatePanel();
        });
    }

    if (idealToggle) {
        idealToggle.on("click", () => {
            showIdealPoint = !showIdealPoint;
            idealToggle.classed("active", showIdealPoint);
            updatePanel();
        });
    }

    if (pcaToggle) {
        pcaToggle.on("click", () => {
            showPCA = !showPCA;
            pcaToggle.classed("active", showPCA);
            updatePanel();
        });
    }

    chartSelect.on("change", updatePanel);
    xAxisSelect.on("change", updatePanel);
    yAxisSelect.on("change", updatePanel);
    if (zAxisSelect) zAxisSelect.on("change", updatePanel);

    updatePanel();
}
