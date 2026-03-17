/**
 * globalState.js
 *
 * Maintains the global registry of all active 3D GL scatterplot instances
 * and wires up the cross-instance hover and selection pub-sub events.
 *
 * Each instance registers itself as:
 *   { setSelection, applyHighlight, dispose, refreshVisuals }
 *
 * Exports:
 *   _instances              – Map<containerSelector, instanceAPI>
 *   setScatter3dGLSelection – broadcast a selection set to every instance
 *
 * Responds to:
 *   'hover-change'     → highlight the hovered row in all instances
 *   'selection-change' → pass the new selection set to all instances
 *   'zoom-enter'       → hide brush filters and redraw (via filterState)
 *   'zoom-exit'        → restore brush filters and redraw (via filterState)
 */

import { subscribe } from '../state/appState.js';
import { onZoomEnter, onZoomExit } from './filterState.js';

export const _instances = new Map();

function globalHighlight(rowIndex) {
    _instances.forEach(inst => inst.applyHighlight(rowIndex));
}
subscribe('hover-change', globalHighlight);

export function setScatter3dGLSelection(rowIndexSet) {
    _instances.forEach(inst => inst.setSelection(rowIndexSet));
}
subscribe('selection-change', setScatter3dGLSelection);

subscribe('zoom-enter', () => onZoomEnter(_instances));
subscribe('zoom-exit',  () => onZoomExit(_instances));
