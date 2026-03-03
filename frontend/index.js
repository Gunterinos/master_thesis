let activeRowIndex = null;
let fullData = [];
let filteredRowIndexSet = null;
let chartRegistry = null;

function applyLinkedHighlight() {
    const hasActive = activeRowIndex !== null;
    const isActiveElement = (element) => hasActive && Number(element.dataset.rowIndex) === activeRowIndex;

    d3.selectAll("tr[data-row-index]")
        .classed("is-linked-highlight", function classRowHighlight() {
            return isActiveElement(this);
        })
        .classed("is-linked-dim", function classRowDim() {
            return hasActive && !isActiveElement(this);
        });

    d3.selectAll("circle[data-row-index]")
        .classed("is-linked-highlight", function classPointHighlight() {
            return isActiveElement(this);
        })
        .classed("is-linked-dim", function classPointDim() {
            return hasActive && !isActiveElement(this);
        })
        .attr("r", function sizePoint() {
            if (!hasActive) {
                return 4;
            }

            return isActiveElement(this) ? 7 : 3;
        });

    d3.selectAll(".bar-chart-segment[data-row-index]")
        .classed("is-linked-highlight", function classBarChartHighlight() {
            return isActiveElement(this);
        })
        .classed("is-linked-dim", function classBarChartDim() {
            return hasActive && !isActiveElement(this);
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

function getCurrentData() {
    return filteredRowIndexSet
        ? fullData.filter((row) => filteredRowIndexSet.has(row.__rowIndex))
        : fullData;
}

function renderAllPanels(options = {}) {
    const { animate = false } = options;
    const dataToRender = getCurrentData();

    initializeObjectivesSpacePanel({
        data: dataToRender,
        chartRegistry,
        renderOptions: { animate },
        onAfterRender: applyLinkedHighlight,
    });

    initializeDecisionSpacePanel({
        data: dataToRender,
        chartRegistry,
        renderOptions: { animate },
        onAfterRender: applyLinkedHighlight,
    });
}

function updateClearSelectionButton() {
    d3.select("#objectives-clear-selection").classed("hidden", !filteredRowIndexSet);
}

function applySelectionFilter(rowIndices) {
    if (!rowIndices || rowIndices.length === 0) {
        return;
    }

    filteredRowIndexSet = new Set(rowIndices);
    activeRowIndex = null;
    renderAllPanels({ animate: true });
    updateClearSelectionButton();
}

function clearSelectionFilter() {
    filteredRowIndexSet = null;
    activeRowIndex = null;
    renderAllPanels({ animate: true });
    updateClearSelectionButton();
}

d3.json("/api/portfolio-data")
    .then((rawData) => {
        if (!rawData || rawData.length === 0) {
            d3.select("#objectives-container").append("p").text("No data available.");
            d3.select("#decision-container").append("p").text("No data available.");
            return;
        }

        fullData = rawData.map((row, index) => ({
            ...row,
            __rowIndex: index,
        }));

        const interactionOptions = {
            onHoverStart: setActiveRowIndex,
            onHoverEnd: clearActiveRowIndex,
            onSelectionChange: applySelectionFilter,
        };

        chartRegistry = createChartRegistry(interactionOptions);

        d3.select("#objectives-clear-selection").on("click", clearSelectionFilter);

        renderAllPanels({ animate: false });
        updateClearSelectionButton();
    })
    .catch((error) => {
        d3.select("#objectives-container").append("p").text("Failed to load data.");
        d3.select("#decision-container").append("p").text("Failed to load data.");
        console.error(error);
    });
