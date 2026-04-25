import * as d3 from 'd3';
import { getNumericColumns } from '../tables/tables.js';
import { populateAxisSelect } from '../scatterplot/scatterplot.js';
import { populateAxisSelect3dGL } from '../scatterplot3dGL/scatterplot3dGL.js';
import { setRadvizSpread } from '../radviz/radviz.js';
import { computeDominantGroups, computeFrontierColors } from '../colors.js';

const _observers = new Map(); // containerSelector → ResizeObserver

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
        decGroupsToggleSelector = null,
        decGroupsBtnSelector = null,
        frontierColorsToggleSelector = null,
        optionsDropdownSelector = null,
        spreadSliderSelector = null,
        decisionColumns = [],
        groups = {},
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
    const decGroupsToggle = decGroupsToggleSelector ? d3.select(decGroupsToggleSelector) : null;
    const decGroupsBtn = decGroupsBtnSelector ? d3.select(decGroupsBtnSelector) : null;
    const frontierColorsToggle = frontierColorsToggleSelector ? d3.select(frontierColorsToggleSelector) : null;
    const optionsDropdown = optionsDropdownSelector ? d3.select(optionsDropdownSelector) : null;
    const optionsMenu = optionsDropdown ? optionsDropdown.select('.options-dropdown-menu') : null;
    const optionsBtn = optionsDropdown ? optionsDropdown.select('.options-dropdown-btn') : null;
    const spreadSlider = spreadSliderSelector ? d3.select(spreadSliderSelector) : null;
    // Persist toggle state across re-renders via button's active class
    let showLabels = labelsToggle ? labelsToggle.classed("active") : false;
    let showPCA = pcaToggle ? pcaToggle.classed("active") : false;
    let showDecGroups = (decGroupsToggle ? decGroupsToggle.classed("active") : false)
        || (decGroupsBtn ? decGroupsBtn.classed("active") : false);
    let showSurface = surfaceToggle ? surfaceToggle.classed("active") : false;
    let showDominated = dominatedToggle ? dominatedToggle.classed("active") : false;
    let showIdealPoint = idealToggle ? idealToggle.classed("active") : false;
    let showFrontierColors = frontierColorsToggle ? frontierColorsToggle.classed("active") : false;

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
        const hasColorOptions = isScatter || chartType === 'pcp' || chartType === 'radar';

        xAxisSelect.classed("hidden", !isScatter || isPCA);
        yAxisSelect.classed("hidden", !isScatter || isPCA);
        xLabel.classed("hidden", !isScatter || isPCA);
        yLabel.classed("hidden", !isScatter || isPCA);
        if (zAxisSelect) zAxisSelect.classed("hidden", !needsZ);
        if (zLabel)      zLabel.classed("hidden", !needsZ);
        if (optionsDropdown) {
            optionsDropdown.classed("hidden", !hasColorOptions);
        }
        if (labelsToggle) {
            labelsToggle.classed("hidden", !isScatter);
        }
        if (pcaToggle) {
            pcaToggle.classed("hidden", !isScatter || needsZ);
        }
        if (decGroupsToggle) {
            decGroupsToggle.classed("hidden", false);
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
        if (spreadSlider) {
            const isRadviz = chartType === 'radviz';
            spreadSlider.classed("hidden", !isRadviz);
        }

        if (!chartConfig) {
            return;
        }

        const renderWith = (renderData, pcaLabels = null) => {
            const groupColorOverrides = showDecGroups && decisionColumns.length > 0
                ? computeDominantGroups(renderData, decisionColumns, groups)
                : null;
            const { colorMap: frontierColorOverrides, items: frontierLegendItems } = showFrontierColors
                ? computeFrontierColors(renderData)
                : { colorMap: null, items: [] };
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
                groupColorOverrides,
                decisionColumns,
                groups,
                frontierColorOverrides,
                frontierLegendItems,
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

    const toggleDecGroups = () => {
        showDecGroups = !showDecGroups;
        if (decGroupsToggle) decGroupsToggle.classed("active", showDecGroups);
        if (decGroupsBtn) decGroupsBtn.classed("active", showDecGroups);
        if (showDecGroups && showFrontierColors) {
            showFrontierColors = false;
            if (frontierColorsToggle) frontierColorsToggle.classed("active", false);
        }
        updatePanel();
    };
    if (decGroupsToggle) decGroupsToggle.on("click", toggleDecGroups);
    if (decGroupsBtn) decGroupsBtn.on("click", toggleDecGroups);

    if (frontierColorsToggle) {
        frontierColorsToggle.on("click", () => {
            showFrontierColors = !showFrontierColors;
            frontierColorsToggle.classed("active", showFrontierColors);
            if (showFrontierColors && showDecGroups) {
                showDecGroups = false;
                if (decGroupsToggle) decGroupsToggle.classed("active", false);
                if (decGroupsBtn) decGroupsBtn.classed("active", false);
            }
            updatePanel();
        });
    }

    if (optionsBtn) {
        optionsBtn.on("click", (event) => {
            event.stopPropagation();
            optionsMenu.classed("open", !optionsMenu.classed("open"));
        });
        optionsDropdown.on("click", (event) => {
            event.stopPropagation();
        });
        d3.select(document).on(`click.options-dropdown-${containerSelector}`, () => {
            optionsMenu.classed("open", false);
        });
    }

    if (spreadSlider) {
        spreadSlider.on("click", function () {
            const isActive = spreadSlider.classed("active");
            spreadSlider.classed("active", !isActive);
            setRadvizSpread(containerSelector, isActive ? 0 : 1);
        });
    }

    chartSelect.on("change", updatePanel);
    xAxisSelect.on("change", updatePanel);
    yAxisSelect.on("change", updatePanel);
    if (zAxisSelect) zAxisSelect.on("change", updatePanel);

    // Re-render when the panel changes size (window resize, etc.)
    if (_observers.has(containerSelector)) {
        _observers.get(containerSelector).disconnect();
    }
    const panelNode = d3.select(containerSelector).node()?.closest('.table-panel');
    if (panelNode) {
        const rect = panelNode.getBoundingClientRect();
        let lastW = rect.width, lastH = rect.height;
        const observer = new ResizeObserver((entries) => {
            const { width: w, height: h } = entries[0].contentRect;
            if (Math.abs(w - lastW) > 1 || Math.abs(h - lastH) > 1) {
                lastW = w; lastH = h;
                updatePanel();
            }
        });
        observer.observe(panelNode);
        _observers.set(containerSelector, observer);
    }

    updatePanel();
}
