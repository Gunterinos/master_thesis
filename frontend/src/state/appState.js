let activeRowIndex = null;
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
