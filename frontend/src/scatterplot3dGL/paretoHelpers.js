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

// Generates a random cloud of points inside the dominated region below the Pareto front.
export function generateDominatedCloud(front, xDom, yDom, zDom, count = 280) {
    if (!front.length) return [];
    const xR = (xDom[1] - xDom[0]) || 1;
    const yR = (yDom[1] - yDom[0]) || 1;
    const zR = (zDom[1] - zDom[0]) || 1;
    const res = [], per = Math.ceil(count / front.length);
    for (const p of front) {
        for (let i = 0; i < per && res.length < count; i++) {
            res.push({
                xVal: p.xVal - Math.random() * xR * 0.4,
                yVal: p.yVal - Math.random() * yR * 0.4,
                zVal: p.zVal - Math.random() * zR * 0.4,
            });
        }
    }
    return res;
}
