import { subscribe } from '../state/appState.js';

export const _instances = new Map();

function globalHighlight(rowIndex) {
    _instances.forEach(inst => inst.applyHighlight(rowIndex));
}
subscribe('hover-change', globalHighlight);

export function setScatter3dGLSelection(rowIndexSet) {
    _instances.forEach(inst => inst.setSelection(rowIndexSet));
}
subscribe('selection-change', setScatter3dGLSelection);
