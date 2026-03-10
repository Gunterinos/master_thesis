let activeRowIndex = null;
let selectedRowIndexSet = null;
let filteredRowIndexSet = null;
let isZoomed = false;
const subscribers = new Map();

// registers a listener for the given event
export function subscribe(event, fn) {
    if (!subscribers.has(event)) subscribers.set(event, []);
    subscribers.get(event).push(fn);
}

// fires all listeners registered for the given event
function emit(event, data) {
    subscribers.get(event)?.forEach(fn => fn(data));
}

// returns the row index currently being hovered, or null
export function getActiveRowIndex() {
    return activeRowIndex;
}

// sets the hovered row and emits 'hover-change'
export function setActiveRowIndex(rowIndex) {
    if (activeRowIndex === rowIndex) return;
    activeRowIndex = rowIndex;
    emit('hover-change', rowIndex);
}

// clears the hovered row and emits 'hover-change' with null
export function clearActiveRowIndex() {
    if (activeRowIndex === null) return;
    activeRowIndex = null;
    emit('hover-change', null);
}

// returns the raw selected set regardless of zoom state
export function getSelectedRowIndexSet() { return selectedRowIndexSet; }
// returns the set of rows visible after a zoom filter, or null
export function getFilteredRowIndexSet()  { return filteredRowIndexSet;  }
// returns whether the view is currently zoomed into a selection
export function getIsZoomed()             { return isZoomed;             }

// returns the selection exposed to charts: the selected set when not zoomed, null when zoomed
export function getEffectiveSelection() {
    return (selectedRowIndexSet !== null && !isZoomed) ? selectedRowIndexSet : null;
}

// updates selection/filter/zoom state and emits the appropriate events
export function setSelectionState({ selected, filtered, zoomed }) {
    const prevZoomed = isZoomed;
    selectedRowIndexSet = selected;
    filteredRowIndexSet = filtered;
    isZoomed = zoomed;
    if (!prevZoomed && zoomed) emit('zoom-enter', null);
    else if (prevZoomed && !zoomed) emit('zoom-exit', null);
    emit('selection-change', getEffectiveSelection());
}

// resets all selection state and emits 'filters-clear' then 'selection-change'
export function clearSelectionState() {
    selectedRowIndexSet = null;
    filteredRowIndexSet = null;
    isZoomed = false;
    emit('filters-clear', null);
    emit('selection-change', null);
}
