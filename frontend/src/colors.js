// xgfs_normal12 — high-contrast, colour-blind-friendly palette.
// Source: https://gist.github.com/xgfs/37436865b6616eebd09146007fea6c09 (xgfs colour maps)

export const CB_PALETTE = [
    '#EBAC23', // amber
    '#B80058', // deep pink
    '#008CF9', // bright blue
    '#006E00', // dark green
    '#00BBAD', // teal
    '#D163E6', // violet
    '#B24502', // burnt orange
    '#FF9287', // salmon
    '#5954D6', // indigo
    '#00C6F8', // sky blue
    '#878500', // olive
    '#00A76C', // emerald
    '#BDBDBD', // grey
];

export const POINT_COLOR_REGULAR   = '#008CF9'; // bright blue  (index 2)
export const POINT_COLOR_BENCHMARK = '#B80058'; // deep pink    (index 1)
export const POINT_COLOR_FILTERED  = '#aaaaaa'; // unchanged

export const COLOR_INK            = '#1d1d1f'; // primary text, axes, labels
export const COLOR_TEXT_SECONDARY = '#5f6673'; // secondary text / muted labels
export const COLOR_TEXT_MUTED     = '#a0a8b4'; // tertiary / faint labels
export const COLOR_TEXT_SOFT      = '#8f98a8'; // softest label tone

export const COLOR_SELECTION           = '#4f8cff'; // brush / active highlight
export const COLOR_SELECTION_TINT      = '#4f8cff29'; // brush fill
export const COLOR_SELECTION_TINT_SOFT = '#4f8cff14'; // very light tint
export const COLOR_SELECTION_SHADOW    = '#4f8cff59'; // focus ring shadow

export const COLOR_SURFACE         = '#fffffff5'; // panel / tooltip bg
export const COLOR_OVERLAY         = '#ffffffd1'; // lighter panel overlay
export const COLOR_OVERLAY_LIGHT   = '#ffffffb8'; // lightest overlay
export const COLOR_TOOLTIP_BG      = '#11161feb'; // dark tooltip bg
export const COLOR_TOOLTIP_BG_DARK = '#11161ff0'; // slightly darker variant
export const COLOR_BORDER          = '#adb7c5f2'; // default border
export const COLOR_SCROLLBAR_TRACK = '#78808c59'; // scrollbar track

export const COLOR_AXIS_LINE    = '#e0e4ec'; // axis tick / separator lines
export const COLOR_AXIS_DARK    = '#243047'; // bar chart axis stroke
export const COLOR_BOUNDING_BOX = '#d1d5db'; // 3-D scene bounding box dashes

export const COLOR_PAGE_BG_START = '#f5f7fb';
export const COLOR_PAGE_BG_END   = '#eef2f7';

export const COLOR_WHITE = '#ffffff';
export const COLOR_BLACK = '#000000';

export const COLOR_DOMINATED    = '#8a9ab0'; // dominated-cloud point colour
export const COLOR_IDEAL_FILL   = '#eab308'; // ideal-point fill
export const COLOR_IDEAL_STROKE = '#ca8a04'; // ideal-point ring / label
export const COLOR_SURFACE_EDGE = '#1e293b'; // 3-D surface mesh edge

export const COLOR_BAR_MUTED = '#4c566a'; // de-emphasised bar fill

export const COLOR_TABLE_BORDER      = '#e5e8ee';
export const COLOR_TABLE_HEADER_BG   = '#f6f8fb';
export const COLOR_TABLE_HEADER_TEXT = '#525866';
export const COLOR_TABLE_ROW_ALT     = '#edf1f7';
export const COLOR_TABLE_POSITIVE_BG = '#ecfff2';

export function getColumnColor(index) {
    return CB_PALETTE[index % CB_PALETTE.length];
}

// ── Frontier colours ──────────────────────────────────────────────────────────

// Paul Tol's "bright" qualitative scheme — CB-friendly, distinct from CB_PALETTE.
// Source: https://personal.sron.nl/~pault/
export const FRONTIER_PALETTE = [
    '#4477AA', // blue
    '#EE6677', // red
    '#228833', // green
    '#CCBB44', // yellow
    '#66CCEE', // cyan
    '#AA3377', // purple
    '#BBBBBB', // grey
];

export function getFrontierColor(index) {
    return FRONTIER_PALETTE[index % FRONTIER_PALETTE.length];
}

/**
 * For each non-benchmark row maps rowIndex → frontier colour.
 * Returns { colorMap: Map<rowIndex, colorString>, items: [{ label, color }] }.
 * Benchmark rows are excluded — they always render with POINT_COLOR_BENCHMARK.
 */
export function computeFrontierColors(data, globalOrder = null) {
    const colorMap = new Map();
    const seen = new Map(); // name → color index
    const items = [];
    let nextIdx = 0;

    for (const row of data) {
        if (row.__isBenchmark) continue;
        const name = row.__frontier ?? 'Unknown';
        if (!seen.has(name)) {
            const idx = globalOrder ? globalOrder.indexOf(name) : -1;
            const colorIdx = idx >= 0 ? idx : nextIdx++;
            seen.set(name, colorIdx);
            items.push({ label: name, color: getFrontierColor(colorIdx) });
        }
        colorMap.set(row.__rowIndex, getFrontierColor(seen.get(name)));
    }
    return { colorMap, items };
}

// ── Group colours ─────────────────────────────────────────────────────────────

// One distinct base colour per group (up to 8 groups), colour-blind-friendly.
export const GROUP_COLOR_BASES = [
    '#008CF9', // blue
    '#EBAC23', // amber
    '#00A76C', // emerald
    '#D163E6', // violet
    '#B80058', // deep pink
    '#00BBAD', // teal
    '#B24502', // burnt orange
    '#5954D6', // indigo
];

export function getGroupBaseColor(groupIndex) {
    return GROUP_COLOR_BASES[groupIndex % GROUP_COLOR_BASES.length];
}

/**
 * Lightness variant of a group's base colour for individual variables.
 * varIndexInGroup=0 → base colour; higher indices → progressively lighter.
 */
export function getVariableColor(groupIndex, varIndexInGroup, groupSize) {
    const base = getGroupBaseColor(groupIndex);
    if (groupSize <= 1) return base;
    const factor = (varIndexInGroup / (groupSize - 1)) * 0.30;
    return _lightenHex(base, factor);
}

function _lightenHex(hex, factor) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
    return `#${[r, g, b].map(c => clamp(c + factor * (255 - c)).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Returns ordered unique group names from { colName: groupName } mapping,
 * preserving the order they first appear across the columns array.
 */
export function getGroupOrder(columns, groups) {
    const seen = new Set();
    const order = [];
    for (const col of columns) {
        const grp = groups[col];
        if (grp && !seen.has(grp)) { seen.add(grp); order.push(grp); }
    }
    return order;
}

/**
 * Returns { groupName: [col, …] } preserving column order within each group.
 */
export function getGroupMembers(columns, groups) {
    const map = {};
    for (const col of columns) {
        const grp = groups[col];
        if (grp) {
            if (!map[grp]) map[grp] = [];
            map[grp].push(col);
        }
    }
    return map;
}

/**
 * For each data row, finds the dominant decision group (or column) by summed value
 * and returns a Map<rowIndex, colorString>.
 */
export function computeDominantGroups(data, decisionColumns, groups = {}) {
    const result = new Map();
    const hasGroups = groups && Object.keys(groups).length > 0;
    if (hasGroups) {
        const groupOrder = getGroupOrder(decisionColumns, groups);
        const groupMembersMap = getGroupMembers(decisionColumns, groups);
        for (const row of data) {
            let maxVal = -Infinity, dominantGi = 0;
            groupOrder.forEach((grp, gi) => {
                const total = (groupMembersMap[grp] || []).reduce((s, col) => s + (Number(row[col]) || 0), 0);
                if (total > maxVal) { maxVal = total; dominantGi = gi; }
            });
            result.set(row.__rowIndex, getGroupBaseColor(dominantGi));
        }
    } else {
        const ranges = {};
        for (const col of decisionColumns) {
            const vals = data.map(r => Number(r[col])).filter(Number.isFinite);
            ranges[col] = { min: Math.min(...vals), max: Math.max(...vals) };
        }
        for (const row of data) {
            let maxNorm = -Infinity, dominantIdx = 0;
            decisionColumns.forEach((col, idx) => {
                const { min, max } = ranges[col];
                const norm = max > min ? (Number(row[col]) - min) / (max - min) : 0;
                if (norm > maxNorm) { maxNorm = norm; dominantIdx = idx; }
            });
            result.set(row.__rowIndex, getColumnColor(dominantIdx));
        }
    }
    return result;
}

// Cividis gradient stops — CB-friendly, perceptually uniform sequential scale.
// ao=0 → near ideal (bright yellow), ao=1 → far from ideal (dark navy).
const _CIVIDIS = [
    { t: 0.00, r: 253, g: 231, b:  37 }, // bright yellow
    { t: 0.25, r: 173, g: 168, b:  87 }, // olive
    { t: 0.50, r: 103, g: 130, b: 122 }, // muted teal
    { t: 0.75, r:  52, g:  87, b: 127 }, // slate blue
    { t: 1.00, r:   0, g:  32, b:  76 }, // dark navy
];

// Returns { r, g, b } in [0,1] range and a hex string for a given ao in [0,1].
export function interpolateSurfaceColor(ao) {
    const t = Math.max(0, Math.min(1, ao));
    let lo = _CIVIDIS[0], hi = _CIVIDIS[_CIVIDIS.length - 1];
    for (let i = 0; i < _CIVIDIS.length - 1; i++) {
        if (t >= _CIVIDIS[i].t && t <= _CIVIDIS[i + 1].t) {
            lo = _CIVIDIS[i]; hi = _CIVIDIS[i + 1]; break;
        }
    }
    const span = hi.t - lo.t || 1;
    const frac = (t - lo.t) / span;
    const r = Math.round(lo.r + frac * (hi.r - lo.r));
    const g = Math.round(lo.g + frac * (hi.g - lo.g));
    const b = Math.round(lo.b + frac * (hi.b - lo.b));
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    return { r: r / 255, g: g / 255, b: b / 255, hex };
}
