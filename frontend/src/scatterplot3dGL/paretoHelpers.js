// Pareto-front calculation and deterministic dominated-cloud generation
// for the 3D GL scatterplot overlay features.

// Returns the non-dominated (Pareto-optimal) subset of the given points.
export function computeParetoFront(pts) {
    return pts.filter(p => !pts.some(q =>
        q !== p &&
        q.xVal <= p.xVal && q.yVal <= p.yVal && q.zVal <= p.zVal &&
        (q.xVal < p.xVal || q.yVal < p.yVal || q.zVal < p.zVal)
    ));
}

// Generates a seeded pseudo-random cloud of points inside the dominated region below the Pareto front.
export function generateDominatedCloud(front, xDom, yDom, zDom, count = 280) {
    if (!front.length) return [];
    const xR = (xDom[1] - xDom[0]) || 1;
    const yR = (yDom[1] - yDom[0]) || 1;
    const zR = (zDom[1] - zDom[0]) || 1;
    let seed = front.reduce((s, p) => (s + p.xVal * 7 + p.yVal * 13 + p.zVal * 17) | 0, 0);
    const rand = () => { seed = (seed * 1664525 + 1013904223) | 0; return (seed >>> 0) / 0xFFFFFFFF; };
    const res = [], per = Math.ceil(count / front.length);
    for (const p of front) {
        for (let i = 0; i < per && res.length < count; i++) {
            res.push({
                xVal: p.xVal - rand() * xR * 0.4,
                yVal: p.yVal - rand() * yR * 0.4,
                zVal: p.zVal - rand() * zR * 0.4,
            });
        }
    }
    return res;
}
