import { getNumericColumns } from '../tables/tables.js';
import { populateAxisSelect } from '../scatterplot/scatterplot.js';

export function initializeSpacePanel(config) {
    const {
        containerSelector,
        chartSelectSelector,
        xAxisSelector,
        yAxisSelector,
        xLabelSelector,
        yLabelSelector,
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
    const xLabel = d3.select(xLabelSelector);
    const yLabel = d3.select(yLabelSelector);
    const labelsToggle = labelsToggleSelector ? d3.select(labelsToggleSelector) : null;
    // Persist showLabels state across re-renders via button's active class
    let showLabels = labelsToggle ? labelsToggle.classed("active") : false;

    const previousChart = chartSelect.property("value");
    const previousXAxis = xAxisSelect.property("value");
    const previousYAxis = yAxisSelect.property("value");

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

    const scatterEnabled = charts.some((chart) => chart.key === "scatter");
    if (scatterEnabled) {
        populateAxisSelect(xAxisSelect, numericColumns);
        populateAxisSelect(yAxisSelect, numericColumns);

        const defaultYAxis = numericColumns[1] || numericColumns[0];
        const selectedXAxis = numericColumns.includes(previousXAxis) ? previousXAxis : numericColumns[0];
        const selectedYAxis = numericColumns.includes(previousYAxis) ? previousYAxis : defaultYAxis;

        xAxisSelect.property("value", selectedXAxis);
        yAxisSelect.property("value", selectedYAxis);
    }

    const updatePanel = () => {
        const chartType = chartSelect.property("value");
        const chartConfig = chartRegistry[chartType];
        const isScatter = chartConfig?.needsAxes === true;

        xAxisSelect.classed("hidden", !isScatter);
        yAxisSelect.classed("hidden", !isScatter);
        xLabel.classed("hidden", !isScatter);
        yLabel.classed("hidden", !isScatter);
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

    updatePanel();
}
