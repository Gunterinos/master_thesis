import * as d3 from 'd3';
import './style.css';
import { createChartRegistry } from './panels/chartRegistry.js';
import { initializeObjectivesSpacePanel } from './panels/objectivesSpacePanel.js';
import { initializeDecisionSpacePanel } from './panels/decisionSpacePanel.js';
import { setActiveRowIndex, clearActiveRowIndex, setSelectionState, clearSelectionState,
         getSelectedRowIndexSet, getFilteredRowIndexSet, getIsZoomed } from './state/appState.js';

let fullData = [];
let objectiveDirections = {};
let chartRegistry = null;

function getCurrentData() {
    const filteredRowIndices = getFilteredRowIndexSet();
    return filteredRowIndices
        ? fullData.filter((row) => filteredRowIndices.has(row.__rowIndex))
        : fullData;
}

function renderAllPanels(options = {}) {
    const { animate = false } = options;
    const dataToRender = getCurrentData();

    initializeObjectivesSpacePanel({
        data: dataToRender,
        objectiveDirections,
        chartRegistry,
        renderOptions: { animate },
    });

    initializeDecisionSpacePanel({
        data: dataToRender,
        chartRegistry,
        renderOptions: { animate },
    });
}

function updateSelectionButtons() {
    const hasSelection = getSelectedRowIndexSet() !== null;
    d3.select("#objectives-clear-selection").classed("hidden", !hasSelection);
    d3.select("#objectives-zoom-toggle")
        .classed("hidden", !hasSelection)
        .text(getIsZoomed() ? "Zoom Out" : "Zoom In");
}

function applySelectionFilter(rowIndices) {
    if (!rowIndices || rowIndices.length === 0) {
        return;
    }

    clearActiveRowIndex();
    setSelectionState({ selected: new Set(rowIndices), filtered: null, zoomed: false });
    updateSelectionButtons();
}

function toggleZoom() {
    const selectedRowIndices = getSelectedRowIndexSet();
    if (!selectedRowIndices) { return; }

    clearActiveRowIndex();
    if (getIsZoomed()) {
        setSelectionState({ selected: selectedRowIndices, filtered: null, zoomed: false });
    } else {
        setSelectionState({ selected: selectedRowIndices, filtered: selectedRowIndices, zoomed: true });
    }
    renderAllPanels({ animate: true });
    updateSelectionButtons();
}

function clearSelectionFilter() {
    clearActiveRowIndex();
    clearSelectionState();
    renderAllPanels({ animate: true });
    updateSelectionButtons();
}

d3.json("/api/portfolio-data")
    .then(({ rows: rawData, directions }) => {
        if (!rawData || rawData.length === 0) {
            d3.select("#objectives-container").append("p").text("No data available.");
            d3.select("#decision-container").append("p").text("No data available.");
            return;
        }

        objectiveDirections = directions;
        fullData = rawData.map((row, index) => ({
            ...row,
            __rowIndex: index,
            __isBenchmark: index === 0,
        }));

        const interactionOptions = {
            onHoverStart: setActiveRowIndex,
            onHoverEnd: clearActiveRowIndex,
            onSelectionChange: applySelectionFilter,
            get disableBrush() { return getIsZoomed(); },
            onBrushFilterChange: (passingRowIndices) => {
                clearActiveRowIndex();
                if (passingRowIndices === null) {
                    setSelectionState({ selected: null, filtered: null, zoomed: false });
                } else {
                    setSelectionState({ selected: new Set(passingRowIndices), filtered: null, zoomed: false });
                }
                updateSelectionButtons();
            },
            onShiftClick: (rowIndex) => {
                const current = getSelectedRowIndexSet();
                const newSet = current ? new Set(current) : new Set();
                if (newSet.has(rowIndex)) {
                    newSet.delete(rowIndex);
                } else {
                    newSet.add(rowIndex);
                }
                if (newSet.size === 0) {
                    setSelectionState({ selected: null, filtered: null, zoomed: false });
                } else {
                    setSelectionState({ selected: newSet, filtered: getFilteredRowIndexSet(), zoomed: getIsZoomed() });
                }
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
        document.querySelector('.page').style.opacity = '1';
    })
    .catch((error) => {
        d3.select("#objectives-container").append("p").text("Failed to load data.");
        d3.select("#decision-container").append("p").text("Failed to load data.");
        document.querySelector('.page').style.opacity = '1';
        console.error(error);
    });
