import * as d3 from 'd3';
import { getNumericColumns } from '../tables/tables.js';
import { populateAxisSelect } from '../scatterplot/scatterplot.js';
import { populateAxisSelect3d } from '../scatterplot3d/scatterplot3d.js';

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
        columns,
        data,
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
    // Persist showLabels state across re-renders via button's active class
    let showLabels = labelsToggle ? labelsToggle.classed("active") : false;

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

    const scatterEnabled = charts.some((chart) => chart.key === "scatter" || chart.key === "scatter3d");
    if (scatterEnabled) {
        populateAxisSelect(xAxisSelect, numericColumns);
        populateAxisSelect(yAxisSelect, numericColumns);

        const defaultYAxis = numericColumns[1] || numericColumns[0];
        const selectedXAxis = numericColumns.includes(previousXAxis) ? previousXAxis : numericColumns[0];
        const selectedYAxis = numericColumns.includes(previousYAxis) ? previousYAxis : defaultYAxis;

        xAxisSelect.property("value", selectedXAxis);
        yAxisSelect.property("value", selectedYAxis);

        if (zAxisSelect) {
            populateAxisSelect3d(zAxisSelect, numericColumns);
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

        xAxisSelect.classed("hidden", !isScatter);
        yAxisSelect.classed("hidden", !isScatter);
        xLabel.classed("hidden", !isScatter);
        yLabel.classed("hidden", !isScatter);
        if (zAxisSelect) zAxisSelect.classed("hidden", !needsZ);
        if (zLabel)      zLabel.classed("hidden", !needsZ);
        if (labelsToggle) {
            labelsToggle.classed("hidden", !isScatter);
        }

        if (!chartConfig) {
            return;
        }

        chartConfig.render({
            containerSelector,
            columns,
            data,
            xAxis: xAxisSelect.property("value"),
            yAxis: yAxisSelect.property("value"),
            zAxis: zAxisSelect ? zAxisSelect.property("value") : undefined,
            animate: renderOptions.animate === true,
            showLabels,
        });

        onAfterRender();
    };

    if (labelsToggle) {
        labelsToggle.on("click", () => {
            showLabels = !showLabels;
            labelsToggle.classed("active", showLabels);
            updatePanel();
        });
    }

    chartSelect.on("change", updatePanel);
    xAxisSelect.on("change", updatePanel);
    yAxisSelect.on("change", updatePanel);
    if (zAxisSelect) zAxisSelect.on("change", updatePanel);

    updatePanel();
}
