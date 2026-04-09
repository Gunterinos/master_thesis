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

export function getColumnColor(index) {
    return CB_PALETTE[index % CB_PALETTE.length];
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
