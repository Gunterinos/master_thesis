/**
 * filterState.js
 *
 * Manages per-instance brush filter state for the 3D GL scatterplot.
 * Each chart instance (identified by its container selector string) keeps
 * its own filter bag:
 *   - axisFilters  : { [axisKey]: { min, max } }  – active range filters
 *   - hiddenFilters: Set<axisKey>                  – filters suppressed during zoom
 *   - hadActiveBrushFilters: boolean               – tracks transition from active→idle
 *
 * Responds to the 'zoom-enter', 'zoom-exit', and 'filters-clear' pub-sub
 * events to synchronise filter visibility across the application.
 */

import { subscribe } from '../state/appState.js';

const _filterStates = new Map();

export function getFilterState(sel) {
    if (!_filterStates.has(sel)) {
        _filterStates.set(sel, { axisFilters: {}, hiddenFilters: new Set(), hadActiveBrushFilters: false });
    }
    return _filterStates.get(sel);
}

// Called by globalState when zoom events fire (instances registered there)
export function onZoomEnter(instances) {
    _filterStates.forEach(s => Object.keys(s.axisFilters).forEach(k => s.hiddenFilters.add(k)));
    instances.forEach(inst => inst.refreshVisuals());
}

export function onZoomExit(instances) {
    _filterStates.forEach(s => s.hiddenFilters.clear());
    instances.forEach(inst => inst.refreshVisuals());
}

subscribe('filters-clear', () => {
    _filterStates.forEach(s => { s.axisFilters = {}; s.hiddenFilters.clear(); s.hadActiveBrushFilters = false; });
});

export { _filterStates };
