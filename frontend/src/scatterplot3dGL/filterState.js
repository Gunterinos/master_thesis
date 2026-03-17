// Per-instance brush filter state (axisFilters, hiddenFilters) for each 3D GL scatterplot.
// Responds to zoom-enter, zoom-exit and filters-clear pub-sub events.

import { subscribe } from '../state/appState.js';

const _filterStates = new Map();

// Returns (or creates) the filter bag for a given container selector.
export function getFilterState(sel) {
    if (!_filterStates.has(sel)) {
        _filterStates.set(sel, { axisFilters: {}, hiddenFilters: new Set(), hadActiveBrushFilters: false });
    }
    return _filterStates.get(sel);
}

// Hides all active axis filters and refreshes every instance.
export function onZoomEnter(instances) {
    _filterStates.forEach(s => Object.keys(s.axisFilters).forEach(k => s.hiddenFilters.add(k)));
    instances.forEach(inst => inst.refreshVisuals());
}

// Restores hidden axis filters and refreshes every instance.
export function onZoomExit(instances) {
    _filterStates.forEach(s => s.hiddenFilters.clear());
    instances.forEach(inst => inst.refreshVisuals());
}

subscribe('filters-clear', () => {
    _filterStates.forEach(s => { s.axisFilters = {}; s.hiddenFilters.clear(); s.hadActiveBrushFilters = false; });
});

export { _filterStates };
