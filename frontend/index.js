let activeRowIndex = null;

function applyLinkedHighlight() {
    const hasActive = activeRowIndex !== null;

    d3.selectAll("tr[data-row-index]")
        .classed("is-linked-highlight", function classRowHighlight() {
            return hasActive && Number(this.dataset.rowIndex) === activeRowIndex;
        })
        .classed("is-linked-dim", function classRowDim() {
            return hasActive && Number(this.dataset.rowIndex) !== activeRowIndex;
        });

    d3.selectAll("circle[data-row-index]")
        .classed("is-linked-highlight", function classPointHighlight() {
            return hasActive && Number(this.dataset.rowIndex) === activeRowIndex;
        })
        .classed("is-linked-dim", function classPointDim() {
            return hasActive && Number(this.dataset.rowIndex) !== activeRowIndex;
        })
        .attr("r", function sizePoint() {
            if (!hasActive) {
                return 4;
            }

            return Number(this.dataset.rowIndex) === activeRowIndex ? 7 : 3;
        });
}

function setActiveRowIndex(rowIndex) {
    activeRowIndex = rowIndex;
    applyLinkedHighlight();

    const linkedRows = document.querySelectorAll(`tr[data-row-index="${rowIndex}"]`);
    linkedRows.forEach((rowElement) => {
        rowElement.scrollIntoView({
            block: "nearest",
            behavior: "smooth",
            inline: "nearest",
        });
    });
}

function clearActiveRowIndex() {
    activeRowIndex = null;
    applyLinkedHighlight();
}

function setupPanel(config) {
    const {
        containerSelector,
        chartSelectSelector,
        xAxisSelector,
        yAxisSelector,
        xLabelSelector,
        yLabelSelector,
        columns,
        data,
    } = config;

    const chartSelect = d3.select(chartSelectSelector);
    const xAxisSelect = d3.select(xAxisSelector);
    const yAxisSelect = d3.select(yAxisSelector);
    const xLabel = d3.select(xLabelSelector);
    const yLabel = d3.select(yLabelSelector);

    const numericColumns = getNumericColumns(data, columns);
    const hasScatter = numericColumns.length >= 2;

    const interactionOptions = {
        onHoverStart: setActiveRowIndex,
        onHoverEnd: clearActiveRowIndex,
    };

    if (!hasScatter) {
        chartSelect.selectAll('option[value="scatter"]').attr("disabled", true);
        return;
    }

    populateAxisSelect(xAxisSelect, numericColumns);
    populateAxisSelect(yAxisSelect, numericColumns);

    xAxisSelect.property("value", numericColumns[0]);
    yAxisSelect.property("value", numericColumns[1] || numericColumns[0]);

    const updatePanel = () => {
        const chartType = chartSelect.property("value");
        const isScatter = chartType === "scatter";

        xAxisSelect.classed("hidden", !isScatter);
        yAxisSelect.classed("hidden", !isScatter);
        xLabel.classed("hidden", !isScatter);
        yLabel.classed("hidden", !isScatter);

        if (isScatter) {
            renderScatterplot(
                containerSelector,
                data,
                xAxisSelect.property("value"),
                yAxisSelect.property("value"),
                interactionOptions,
            );
            applyLinkedHighlight();
            return;
        }

        renderTable(containerSelector, columns, data, interactionOptions);
        applyLinkedHighlight();
    };

    chartSelect.on("change", updatePanel);
    xAxisSelect.on("change", updatePanel);
    yAxisSelect.on("change", updatePanel);

    updatePanel();
}

d3.json("/api/portfolio-data")
    .then((rawData) => {
        if (!rawData || rawData.length === 0) {
            d3.select("#objectives-container").append("p").text("No data available.");
            d3.select("#decision-container").append("p").text("No data available.");
            return;
        }

        const data = rawData.map((row, index) => ({
            ...row,
            __rowIndex: index,
        }));

        const allColumns = Object.keys(data[0]);
        const objectiveColumns = allColumns.filter((column) => column.startsWith("obj"));
        const decisionColumns = allColumns.filter((column) => column.startsWith("dec"));

        setupPanel({
            containerSelector: "#objectives-container",
            chartSelectSelector: "#objectives-chart-select",
            xAxisSelector: "#objectives-x-axis",
            yAxisSelector: "#objectives-y-axis",
            xLabelSelector: 'label[for="objectives-x-axis"]',
            yLabelSelector: 'label[for="objectives-y-axis"]',
            columns: objectiveColumns,
            data,
        });

        setupPanel({
            containerSelector: "#decision-container",
            chartSelectSelector: "#decision-chart-select",
            xAxisSelector: "#decision-x-axis",
            yAxisSelector: "#decision-y-axis",
            xLabelSelector: 'label[for="decision-x-axis"]',
            yLabelSelector: 'label[for="decision-y-axis"]',
            columns: decisionColumns,
            data,
        });
    })
    .catch((error) => {
        d3.select("#objectives-container").append("p").text("Failed to load data.");
        d3.select("#decision-container").append("p").text("Failed to load data.");
        console.error(error);
    });
