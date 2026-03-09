let activeRowIndex = null;
let fullData = [];
let filteredRowIndexSet = null;
let selectedRowIndexSet = null;
let isZoomed = false;
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

    d3.selectAll(".scatter-point-label[data-row-index]")
        .classed("is-linked-highlight", function classLabelHighlight() {
            return isActiveElement(this);
        })
        .classed("is-linked-dim", function classLabelDim() {
            return hasActive && !isActiveElement(this);
        });

    d3.selectAll(".bar-chart-segment[data-row-index]")
        .classed("is-linked-highlight", function classBarChartHighlight() {
            return isActiveElement(this);
        })
        .classed("is-linked-dim", function classBarChartDim() {
            return hasActive && !isActiveElement(this);
        });

    d3.selectAll(".pcp-line[data-row-index]")
        .classed("is-linked-highlight", function classPcpHighlight() {
            return isActiveElement(this);
        })
        .classed("is-linked-dim", function classPcpDim() {
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
        onAfterRender: () => { applyLinkedHighlight(); applySelectionDimming(); },
    });

    initializeDecisionSpacePanel({
        data: dataToRender,
        chartRegistry,
        renderOptions: { animate },
        onAfterRender: () => { applyLinkedHighlight(); applySelectionDimming(); },
    });
}

function applySelectionDimming() {
    const rowIndexSet = (selectedRowIndexSet !== null && !isZoomed) ? selectedRowIndexSet : null;

    setScatterSelection(rowIndexSet);
    setParallelCoordsSelection(rowIndexSet);

    const hasSelection = rowIndexSet !== null;
    const isSelected = (element) => rowIndexSet && rowIndexSet.has(Number(element.dataset.rowIndex));

    d3.selectAll("tr[data-row-index]").classed("is-selection-dim", function () {
        return hasSelection && !isSelected(this);
    });
    d3.selectAll(".bar-chart-segment[data-row-index]").classed("is-selection-dim", function () {
        return hasSelection && !isSelected(this);
    });
}

function updateSelectionButtons() {
    const hasSelection = selectedRowIndexSet !== null;
    d3.select("#objectives-clear-selection").classed("hidden", !hasSelection);
    d3.select("#objectives-zoom-toggle")
        .classed("hidden", !hasSelection)
        .text(isZoomed ? "Zoom Out" : "Zoom In");
}

function applySelectionFilter(rowIndices) {
    if (!rowIndices || rowIndices.length === 0) {
        return;
    }

    selectedRowIndexSet = new Set(rowIndices);
    isZoomed = false;
    filteredRowIndexSet = null;
    activeRowIndex = null;
    applySelectionDimming();
    updateSelectionButtons();
}

function toggleZoom() {
    if (!selectedRowIndexSet) { return; }

    if (isZoomed) {
        isZoomed = false;
        filteredRowIndexSet = null;
        activeRowIndex = null;
        pcpExitZoomAll();            // reveal all pre-zoom brush filters
        renderAllPanels({ animate: true });
    } else {
        isZoomed = true;
        filteredRowIndexSet = selectedRowIndexSet;
        activeRowIndex = null;
        pcpEnterZoomAll();           // hide all currently applied brush filters
        renderAllPanels({ animate: true });
    }
    updateSelectionButtons();
}

function clearSelectionFilter() {
    pcpClearFiltersAll();          // remove any brush filters before rerender
    selectedRowIndexSet = null;
    filteredRowIndexSet = null;
    isZoomed = false;
    activeRowIndex = null;
    applySelectionDimming();
    renderAllPanels({ animate: true });
    updateSelectionButtons();
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
            get disableBrush() { return isZoomed; },
            onBrushFilterChange: (passingRowIndices) => {
                if (passingRowIndices === null) {
                    // All brush filters removed — clear the selection they were driving
                    selectedRowIndexSet = null;
                    activeRowIndex = null;
                    applySelectionDimming();
                    updateSelectionButtons();
                } else {
                    // Active brush filter — treat passing rows as the current selection
                    selectedRowIndexSet = new Set(passingRowIndices);
                    activeRowIndex = null;
                    applySelectionDimming();
                    updateSelectionButtons();
                }
            },
            onShiftClick: (rowIndex) => {
                if (!selectedRowIndexSet) {
                    selectedRowIndexSet = new Set();
                }
                if (selectedRowIndexSet.has(rowIndex)) {
                    selectedRowIndexSet.delete(rowIndex);
                } else {
                    selectedRowIndexSet.add(rowIndex);
                }
                if (selectedRowIndexSet.size === 0) {
                    selectedRowIndexSet = null;
                    isZoomed = false;
                    filteredRowIndexSet = null;
                }
                applySelectionDimming();
                updateSelectionButtons();
            },
        };

        chartRegistry = createChartRegistry(interactionOptions);

        d3.select("#objectives-clear-selection").on("click", clearSelectionFilter);
        d3.select("#objectives-zoom-toggle").on("click", toggleZoom);

        d3.select(window)
            .on("keydown.shifthold", (event) => {
                if (event.key === "Shift") { document.body.classList.add("shift-held"); }
            })
            .on("keyup.shifthold", (event) => {
                if (event.key === "Shift") { document.body.classList.remove("shift-held"); }
            });

        renderAllPanels({ animate: false });
        updateSelectionButtons();
    })
    .catch((error) => {
        d3.select("#objectives-container").append("p").text("Failed to load data.");
        d3.select("#decision-container").append("p").text("Failed to load data.");
        console.error(error);
    });
