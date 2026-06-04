let _active = false;
let _questionStartTime = 0;
let _panelChartState = {};
let _timePerChart = {};
let _actions = [];
let _isPaused = false;
let _pauseStartTime = 0;
let _totalPausedMs = 0;

export function startTracking() {
    _active = true;
    _questionStartTime = performance.now();
    _panelChartState = {};
    _timePerChart = {};
    _actions = [];
    _isPaused = false;
    _pauseStartTime = 0;
    _totalPausedMs = 0;

    // Capture whichever chart is currently shown in each panel
    const objChart = document.querySelector('#objectives-chart-select')?.value;
    const decChart = document.querySelector('#decision-chart-select')?.value;
    if (objChart) _initPanel('objectives', objChart);
    if (decChart) _initPanel('decisions', decChart);
}

export function stopTracking() {
    if (!_active) return;
    const now = performance.now();
    if (!_isPaused) {
        for (const [panel, state] of Object.entries(_panelChartState)) {
            if (state.chartKey) _accumulate(panel, state.chartKey, now - state.startTime);
        }
    }
    _active = false;
}

export function pauseTracking() {
    if (!_active || _isPaused) return;
    const now = performance.now();
    for (const [panel, state] of Object.entries(_panelChartState)) {
        if (state.chartKey) {
            _accumulate(panel, state.chartKey, now - state.startTime);
            _panelChartState[panel] = { ...state, startTime: now };
        }
    }
    _isPaused = true;
    _pauseStartTime = now;
}

export function resumeTracking() {
    if (!_active || !_isPaused) return;
    const now = performance.now();
    _totalPausedMs += now - _pauseStartTime;
    for (const panel of Object.keys(_panelChartState)) {
        if (_panelChartState[panel].chartKey) {
            _panelChartState[panel] = { ..._panelChartState[panel], startTime: now };
        }
    }
    _isPaused = false;
}

export function getResult() {
    return {
        timePerChart: JSON.parse(JSON.stringify(_timePerChart)),
        actions: _actions.slice(),
    };
}

function _initPanel(panel, chartKey) {
    _panelChartState[panel] = { chartKey, startTime: performance.now() };
}

function _accumulate(panel, chartKey, ms) {
    if (!_timePerChart[panel]) _timePerChart[panel] = {};
    _timePerChart[panel][chartKey] = (_timePerChart[panel][chartKey] ?? 0) + Math.round(ms);
}

window.addEventListener('survey:action', (event) => {
    if (!_active || _isPaused) return;
    const detail = event.detail ?? {};
    const tMs = Math.round(performance.now() - _questionStartTime - _totalPausedMs);

    if (detail.type === 'chart_active') {
        const { panel, chartKey } = detail;
        const prev = _panelChartState[panel];
        const now = performance.now();
        if (!prev) {
            _panelChartState[panel] = { chartKey, startTime: now };
        } else if (prev.chartKey !== chartKey) {
            _accumulate(panel, prev.chartKey, now - prev.startTime);
            _panelChartState[panel] = { chartKey, startTime: now };
            _actions.push({ t: tMs, type: 'chart_switch', panel, to: chartKey });
        }
        return;
    }

    _actions.push({ t: tMs, ...detail });
});
