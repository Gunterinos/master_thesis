import * as d3 from 'd3';
import './style.css';
import { createChartRegistry } from './panels/chartRegistry.js';
import { initializeObjectivesSpacePanel } from './panels/objectivesSpacePanel.js';
import { initializeDecisionSpacePanel } from './panels/decisionSpacePanel.js';
import { setActiveRowIndex, clearActiveRowIndex, setSelectionState, clearSelectionState,
         getSelectedRowIndexSet, getFilteredRowIndexSet, getIsZoomed } from './state/appState.js';
import { loadIntroConfig, loadTutorialConfig, loadQuestionsConfig } from './survey/surveyConfig.js';
import { startTutorial } from './survey/tutorialController.js';
import { startQuestions } from './survey/questionController.js';
import { showPostQuestionnaire } from './survey/postQuestionnaireController.js';
import { initCheatsheet } from './cheatsheet/cheatsheetController.js';
import { showSurveyIntro } from './survey/surveyIntroController.js';
import { formatLabel } from './formatLabel.js';
import { getFrontierColor } from './colors.js';

let fullData = [];
let objectiveDirections = {};
let groups = {};
let measures = {};
let chartRegistry = null;
let appInitialized = false;

let _externalFilter = null;       // passing row indices from PCP / lasso / etc.
const _tableFilters = new Map(); // containerSelector → passing row indices (one entry per table)
let _surveyDisabledCharts = null;
let _surveyDefaultScreen = null;
let _activeBenchmark = null;

function getCurrentData() {
    const filteredRowIndices = getFilteredRowIndexSet();
    return filteredRowIndices
        ? fullData.filter((row) => filteredRowIndices.has(row.__rowIndex))
        : fullData;
}

function renderAllPanels(options = {}) {
    const { animate = false } = options;
    const dataToRender = getCurrentData();
    const forceEmptyState = !!_surveyDefaultScreen;
    const emptyStateText = typeof _surveyDefaultScreen === 'string' ? _surveyDefaultScreen : null;
    _surveyDefaultScreen = null;

    initializeObjectivesSpacePanel({
        data: dataToRender,
        objectiveDirections,
        chartRegistry,
        renderOptions: { animate },
        groups,
        measures,
        frontierOrder: _activeFrontierFiles.map(f => f.replace(/^.*[\\/]/, '').replace(/\.csv$/i, '').replace(/_/g, ' ')),
        disabledCharts: _surveyDisabledCharts,
        onAfterRender: updateSelectionButtons,
        forceEmptyState,
        emptyStateText,
    });

    initializeDecisionSpacePanel({
        data: dataToRender,
        chartRegistry,
        renderOptions: { animate },
        groups,
        frontierOrder: _activeFrontierFiles.map(f => f.replace(/^.*[\\/]/, '').replace(/\.csv$/i, '').replace(/_/g, ' ')),
        disabledCharts: _surveyDisabledCharts,
        forceEmptyState,
        emptyStateText,
    });
}

function setEmptyFilterWarning(visible) {
    d3.select('#objectives-empty-filter-warning').classed('hidden', !visible);
    d3.select('#decision-empty-filter-warning').classed('hidden', !visible);
}

function updateSelectionButtons() {
    const sel = getSelectedRowIndexSet();
    const hasSelection = sel !== null;
    const hasZoomableSelection = hasSelection && sel.size > 0;
    const zoomLabel = getIsZoomed() ? "Zoom Out" : "Zoom In";
    const objChart = d3.select("#objectives-chart-select").property("value");
    const objNoSelection = objChart === "correlationHeatmap";
    d3.select("#objectives-clear-selection").classed("hidden", !hasSelection || objNoSelection);
    d3.select("#objectives-zoom-toggle").classed("hidden", !hasZoomableSelection || objNoSelection).text(zoomLabel);
    d3.select("#decision-clear-selection").classed("hidden", !hasSelection);
    d3.select("#decision-zoom-toggle").classed("hidden", !hasZoomableSelection).text(zoomLabel);
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
    const zoomingIn = !getIsZoomed();
    if (zoomingIn) {
        setSelectionState({ selected: selectedRowIndices, filtered: selectedRowIndices, zoomed: true });
    } else {
        setSelectionState({ selected: selectedRowIndices, filtered: null, zoomed: false });
    }
    renderAllPanels({ animate: true });
    updateSelectionButtons();
    window.dispatchEvent(new CustomEvent('survey:action', { detail: { type: 'zoom_toggle', zoomed: zoomingIn } }));
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
    setEmptyFilterWarning(result !== null && result.size === 0);
    updateSelectionButtons();
}

function clearSelectionFilter() {
    _externalFilter = null;
    _tableFilters.clear();
    clearActiveRowIndex();
    clearSelectionState();
    setEmptyFilterWarning(false);
    renderAllPanels({ animate: true });
    updateSelectionButtons();
    window.dispatchEvent(new CustomEvent('survey:action', { detail: { type: 'clear_selection' } }));
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
            const adding = !newSet.has(rowIndex);
            if (adding) {
                newSet.add(rowIndex);
            } else {
                newSet.delete(rowIndex);
            }
            if (newSet.size === 0) {
                setSelectionState({ selected: null, filtered: null, zoomed: false });
            } else {
                setSelectionState({ selected: newSet, filtered: getFilteredRowIndexSet(), zoomed: getIsZoomed() });
            }
            updateSelectionButtons();
            window.dispatchEvent(new CustomEvent('survey:action', { detail: { type: 'shift_click', rowIndex, action: adding ? 'add' : 'remove' } }));
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

    initCheatsheet();
}

function loadActiveFiles(activeFiles, { onDone, benchmark } = {}) {
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

    const body = { files: activeFiles };
    if (benchmark) body.benchmark = benchmark;

    fetch("/api/load-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    })
        .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) {
                errorEl.classed("hidden", false).text(data.error ?? "Failed to load data.");
                return;
            }

            const { rows: rawData, directions, groups: groupsFromAPI, measures: measuresFromAPI } = data;
            if (!rawData || rawData.length === 0) {
                errorEl.classed("hidden", false).text("The selected files contain no data.");
                return;
            }

            objectiveDirections = directions;
            groups = groupsFromAPI ?? {};
            measures = measuresFromAPI ?? {};
            fullData = rawData.map((row, index) => ({
                ...row,
                __rowIndex: index,
                __isBenchmark: index === 0,
            }));

            clearSelectionState();
            initializeApp();
            renderAllPanels({ animate: true });
            updateSelectionButtons();
            onDone?.();
        })
        .catch(() => {
            errorEl.classed("hidden", false).text("Network error: could not reach the server.");
        });
}

function getActiveFiles() {
    return d3.selectAll("#frontier-buttons button.active").nodes()
        .map((el) => el.dataset.file);
}

// ── Survey event bridge ──────────────────────────────────────────────────
window.addEventListener('survey:load-data', ({ detail }) => {
    _surveyDisabledCharts = detail.disabledCharts ?? null;
    _surveyDefaultScreen = detail.defaultScreen ?? null;
    _activeBenchmark = detail.benchmark ?? null;
    _activeFrontierFiles = detail.files;
    populateFrontierButtons(detail.files, {}, detail.files);
    loadActiveFiles(detail.files, {
        benchmark: _activeBenchmark,
        onDone: () => {
            const objCols = Object.keys(objectiveDirections);
            const decCols = fullData.length > 0
                ? Object.keys(fullData[0]).filter(k => k.startsWith('dec_'))
                : [];
            window.dispatchEvent(new CustomEvent('survey:data-ready', {
                detail: { objectiveColumns: objCols, decisionColumns: decCols },
            }));
        },
    });
});

// ── Survey flow ──────────────────────────────────────────────────────────
document.getElementById('start-tutorial-btn').addEventListener('click', async () => {
    const [intro, { steps, dataset }] = await Promise.all([loadIntroConfig(), loadTutorialConfig()]);
    const launchTutorial = () => startTutorial(steps, { onComplete: showQuestionsIntroScreen });
    const launch = () => {
        if (intro) {
            showSurveyIntro(intro, launchTutorial);
        } else {
            launchTutorial();
        }
    };
    if (dataset) {
        window.addEventListener('survey:data-ready', () => launch(), { once: true });
        window.dispatchEvent(new CustomEvent('survey:load-data', {
            detail: { files: dataset.frontiers, benchmark: dataset.benchmark ?? null, disabledCharts: null, defaultScreen: null },
        }));
    } else {
        launch();
    }
});

function showQuestionsIntroScreen() {
    const zone = document.getElementById('tutorial-zone');
    zone.innerHTML = `
        <p id="question-intro-text">Tutorial complete. You will now complete a short set of tasks using the visualization.</p>
        <div id="question-controls-wrapper">
            <button id="start-questions-btn" type="button">Start Tasks →</button>
            <button id="tutorial-chart-guide-btn" type="button">Chart Guide</button>
        </div>
    `;
    document.getElementById('start-questions-btn').addEventListener('click', async () => {
        const config = await loadQuestionsConfig();
        const allQuestions = config.questionnaires.flatMap(q => q.questions);
        startQuestions(allQuestions, { onComplete: finishSurvey });
    });
}

async function finishSurvey(responses, sessionId) {
    const config = await loadQuestionsConfig().catch(() => null);
    const pqConfig = config?.postQuestionnaire ?? null;

    showPostQuestionnaire(pqConfig, {
        onComplete: async (postQuestionnaire) => {
            try {
                await fetch('/api/save-responses', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, responses, postQuestionnaire }),
                });
            } catch { /* non-critical */ }

            document.getElementById('tutorial-zone').innerHTML = '';
            document.body.classList.remove('survey-active');
            document.getElementById('start-tutorial-btn').style.display = '';
            document.getElementById('chart-guide-btn').style.display = '';
            _surveyDisabledCharts = null;
            _activeBenchmark = null;
            _activeFrontierFiles = _defaultFrontierFiles;
            populateFrontierButtons(_defaultFrontierFiles, _defaultFileConstraints);
            loadActiveFiles(getActiveFiles());
        },
    });
}

let _defaultFrontierFiles = [];
let _defaultFileConstraints = {};
let _activeFrontierFiles = [];

function formatConstraintVal(val) {
    return val.replace(/([<>]=?)(\d+(?:\.\d+)?)/g, (_, op, num) => {
        const pct = parseFloat((parseFloat(num) * 100).toPrecision(4));
        return `${op}${pct}%`;
    });
}

function populateFrontierButtons(files, fileConstraints = {}, activeFiles = null) {
    const container = d3.select("#frontier-buttons");
    container.selectAll("*").remove();

    const initialActive = activeFiles ?? (files.length > 0 ? [files[0]] : []);

    files.forEach((fname, i) => {
        const constraints = fileConstraints[fname] ?? {};
        const constraintEntries = Object.entries(constraints);
        const label = fname.replace(/^.*[\\/]/, '').replace(/\.csv$/i, '').replace(/_/g, ' ');

        const tooltipText = constraintEntries.length > 0
            ? constraintEntries.map(([col, val]) => `${formatLabel(col)} ${formatConstraintVal(val)}`).join(' · ')
            : null;

        const group = container.append("div")
            .attr("class", "frontier-btn-group");

        const btn = group.append("button")
            .attr("type", "button")
            .attr("data-file", fname)
            .style("--fc", files.length > 1 ? getFrontierColor(i) : null)
            .classed("active", initialActive.includes(fname))
            .text(label)
            .on("click", function () {
                const isActive = d3.select(this).classed("active");
                if (isActive && getActiveFiles().length === 1) { return; }
                d3.select(this).classed("active", !isActive);
                loadActiveFiles(getActiveFiles(), { benchmark: _activeBenchmark });
            });

        if (tooltipText) {
            btn.attr("data-tooltip", tooltipText);
        }
    });
}

d3.json("/api/data-files")
    .then(({ files, fileConstraints = {} }) => {
        _defaultFrontierFiles = files;
        _defaultFileConstraints = fileConstraints;
        _activeFrontierFiles = files;
        populateFrontierButtons(files, fileConstraints);
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
