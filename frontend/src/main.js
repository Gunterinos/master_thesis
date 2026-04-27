import * as d3 from 'd3';
import './style.css';
import { createChartRegistry } from './panels/chartRegistry.js';
import { initializeObjectivesSpacePanel } from './panels/objectivesSpacePanel.js';
import { initializeDecisionSpacePanel } from './panels/decisionSpacePanel.js';
import { setActiveRowIndex, clearActiveRowIndex, setSelectionState, clearSelectionState,
         getSelectedRowIndexSet, getFilteredRowIndexSet, getIsZoomed } from './state/appState.js';

let fullData = [];
let objectiveDirections = {};
let groups = {};
let chartRegistry = null;
let appInitialized = false;

let _externalFilter = null;       // passing row indices from PCP / lasso / etc.
const _tableFilters = new Map(); // containerSelector → passing row indices (one entry per table)

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
        groups,
    });

    initializeDecisionSpacePanel({
        data: dataToRender,
        chartRegistry,
        renderOptions: { animate },
        groups,
    });
}

function updateSelectionButtons() {
    const hasSelection = getSelectedRowIndexSet() !== null;
    const zoomLabel = getIsZoomed() ? "Zoom Out" : "Zoom In";
    d3.select("#objectives-clear-selection").classed("hidden", !hasSelection);
    d3.select("#objectives-zoom-toggle").classed("hidden", !hasSelection).text(zoomLabel);
    d3.select("#decision-clear-selection").classed("hidden", !hasSelection);
    d3.select("#decision-zoom-toggle").classed("hidden", !hasSelection).text(zoomLabel);
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

function applyIntersectedFilter() {
    clearActiveRowIndex();
    // intersect all active per-table filters into one set
    const activeTables = [..._tableFilters.values()].filter(v => v !== null);
    let tableFilter = null;
    if (activeTables.length > 0) {
        tableFilter = activeTables.reduce((acc, rows) => {
            const s = new Set(rows);
            return acc.filter(i => s.has(i));
        });
    }
    let result = null;
    if (_externalFilter !== null && tableFilter !== null) {
        const tableSet = new Set(tableFilter);
        result = new Set(_externalFilter.filter(i => tableSet.has(i)));
    } else if (_externalFilter !== null) {
        result = new Set(_externalFilter);
    } else if (tableFilter !== null) {
        result = new Set(tableFilter);
    }
    setSelectionState({ selected: result, filtered: null, zoomed: false });
    updateSelectionButtons();
}

function clearSelectionFilter() {
    _externalFilter = null;
    _tableFilters.clear();
    clearActiveRowIndex();
    clearSelectionState();
    renderAllPanels({ animate: true });
    updateSelectionButtons();
}

function initializeApp() {
    if (appInitialized) { return; }
    appInitialized = true;

    const interactionOptions = {
        onHoverStart: setActiveRowIndex,
        onHoverEnd: clearActiveRowIndex,
        onSelectionChange: applySelectionFilter,
        get disableBrush() { return getIsZoomed(); },
        onBrushFilterChange: (passingRowIndices) => {
            _externalFilter = passingRowIndices;
            applyIntersectedFilter();
        },
        onTableBrushFilterChange: (containerSelector, passingRowIndices) => {
            _tableFilters.set(containerSelector, passingRowIndices);
            applyIntersectedFilter();
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
    d3.select("#decision-clear-selection").on("click", clearSelectionFilter);
    d3.select("#decision-zoom-toggle").on("click", toggleZoom);

    d3.select(window)
        .on("keydown.shifthold", (event) => {
            if (event.key === "Shift") { document.body.classList.add("shift-held"); }
        })
        .on("keyup.shifthold", (event) => {
            if (event.key === "Shift") { document.body.classList.remove("shift-held"); }
        });
}

function loadActiveFiles(activeFiles) {
    const errorEl = d3.select("#load-error-msg");
    errorEl.classed("hidden", true).text("");

    if (activeFiles.length === 0) {
        fullData = [];
        objectiveDirections = {};
        groups = {};
        clearSelectionState();
        renderAllPanels({ animate: false });
        updateSelectionButtons();
        return;
    }

    fetch("/api/load-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: activeFiles }),
    })
        .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) {
                errorEl.classed("hidden", false).text(data.error ?? "Failed to load data.");
                return;
            }

            const { rows: rawData, directions, groups: groupsFromAPI } = data;
            if (!rawData || rawData.length === 0) {
                errorEl.classed("hidden", false).text("The selected files contain no data.");
                return;
            }

            objectiveDirections = directions;
            groups = groupsFromAPI ?? {};
            fullData = rawData.map((row, index) => ({
                ...row,
                __rowIndex: index,
                __isBenchmark: index === 0,
            }));

            clearSelectionState();
            initializeApp();
            renderAllPanels({ animate: true });
            updateSelectionButtons();
        })
        .catch(() => {
            errorEl.classed("hidden", false).text("Network error: could not reach the server.");
        });
}

function getActiveFiles() {
    return d3.selectAll("#frontier-buttons button.active").nodes()
        .map((el) => el.dataset.file);
}

d3.json("/api/data-files")
    .then(({ files }) => {
        const container = d3.select("#frontier-buttons");
        files.forEach((fname, i) => {
            container.append("button")
                .attr("type", "button")
                .attr("data-file", fname)
                .classed("active", i === 0)
                .text(fname.replace(/\.csv$/i, ""))
                .on("click", function () {
                    const isActive = d3.select(this).classed("active");
                    // Prevent deselecting the last active button
                    if (isActive && getActiveFiles().length === 1) { return; }
                    d3.select(this).classed("active", !isActive);
                    loadActiveFiles(getActiveFiles());
                });
        });
        if (files.length > 0) { loadActiveFiles([files[0]]); }
    })
    .catch(() => {
        d3.select("#load-error-msg")
            .classed("hidden", false)
            .text("Failed to load file list from server.");
    })
    .finally(() => {
        document.querySelector(".page").style.opacity = "1";
    });
