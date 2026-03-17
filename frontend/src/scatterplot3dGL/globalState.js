// Global registry of active 3D GL scatterplot instances.
// Wires hover, selection, zoom-enter and zoom-exit pub-sub events across all instances.

import { subscribe } from '../state/appState.js';
import { onZoomEnter, onZoomExit } from './filterState.js';

export const _instances = new Map();

function globalHighlight(rowIndex) {
    _instances.forEach(inst => inst.applyHighlight(rowIndex));
}
subscribe('hover-change', globalHighlight);

// Broadcasts a selection set to every active 3D GL scatterplot instance.
export function setScatter3dGLSelection(rowIndexSet) {
    _instances.forEach(inst => inst.setSelection(rowIndexSet));
}
subscribe('selection-change', setScatter3dGLSelection);

subscribe('zoom-enter', () => onZoomEnter(_instances));
subscribe('zoom-exit',  () => onZoomExit(_instances));
