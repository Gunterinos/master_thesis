export function formatLabel(name) {
    return name.replace(/^(obj|dec)_/i, '').replaceAll('_', ' ');
}
