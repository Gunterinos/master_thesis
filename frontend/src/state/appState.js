let activeRowIndex = null;
let selectedRowIndexSet = null;
let filteredRowIndexSet = null;
let isZoomed = false;
const subscribers = new Map();

export function subscribe(event, fn) {
    if (!subscribers.has(event)) subscribers.set(event, []);
    subscribers.get(event).push(fn);
}

function emit(event, data) {
    subscribers.get(event)?.forEach(fn => fn(data));
}

export function getActiveRowIndex() {
    return activeRowIndex;
}

export function setActiveRowIndex(rowIndex) {
    if (activeRowIndex === rowIndex) return;
    activeRowIndex = rowIndex;
    emit('hover-change', rowIndex);
}

export function clearActiveRowIndex() {
    if (activeRowIndex === null) return;
    activeRowIndex = null;
    emit('hover-change', null);
}

// ── Selection / filter state ─────────────────────────────────────────────────
export function getSelectedRowIndexSet() { return selectedRowIndexSet; }
export function getFilteredRowIndexSet()  { return filteredRowIndexSet;  }
export function getIsZoomed()             { return isZoomed;             }

export function getEffectiveSelection() {
    return (selectedRowIndexSet !== null && !isZoomed) ? selectedRowIndexSet : null;
}

export function setSelectionState({ selected, filtered, zoomed }) {
    const prevZoomed = isZoomed;
    selectedRowIndexSet = selected;
    filteredRowIndexSet = filtered;
    isZoomed = zoomed;
    if (!prevZoomed && zoomed) emit('zoom-enter', null);
    else if (prevZoomed && !zoomed) emit('zoom-exit', null);
    emit('selection-change', getEffectiveSelection());
}

export function clearSelectionState() {
    selectedRowIndexSet = null;
    filteredRowIndexSet = null;
    isZoomed = false;
    emit('filters-clear', null);
    emit('selection-change', null);
}
