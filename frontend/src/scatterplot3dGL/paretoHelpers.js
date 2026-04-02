// Pareto-front calculation and deterministic dominated-cloud generation
// for the 3D GL scatterplot overlay features.

// Returns the non-dominated (Pareto-optimal) subset of the given points,
// respecting per-axis min/max directions.
export function computeParetoFront(pts, xDir = 'min', yDir = 'min', zDir = 'min') {
    return pts.filter(p => !pts.some(q => {
        if (q === p) return false;
        // q is at least as good as p on every axis
        const xOk = xDir === 'max' ? q.xVal >= p.xVal : q.xVal <= p.xVal;
        const yOk = yDir === 'max' ? q.yVal >= p.yVal : q.yVal <= p.yVal;
        const zOk = zDir === 'max' ? q.zVal >= p.zVal : q.zVal <= p.zVal;
        // q is strictly better than p on at least one axis
        const xBetter = xDir === 'max' ? q.xVal > p.xVal : q.xVal < p.xVal;
        const yBetter = yDir === 'max' ? q.yVal > p.yVal : q.yVal < p.yVal;
        const zBetter = zDir === 'max' ? q.zVal > p.zVal : q.zVal < p.zVal;
        return xOk && yOk && zOk && (xBetter || yBetter || zBetter);
    }));
}

// Generates a random cloud of points in the dominated region, perturbing each
// Pareto-front point toward worse values (direction-aware).
export function generateDominatedCloud(front, xDom, yDom, zDom, xDir = 'min', yDir = 'min', zDir = 'min', count = 280) {
    if (!front.length) return [];
    const xR = (xDom[1] - xDom[0]) || 1;
    const yR = (yDom[1] - yDom[0]) || 1;
    const zR = (zDom[1] - zDom[0]) || 1;
    const res = [], per = Math.ceil(count / front.length);
    for (const p of front) {
        for (let i = 0; i < per && res.length < count; i++) {
            const dx = Math.random() * xR * 0.4;
            const dy = Math.random() * yR * 0.4;
            const dz = Math.random() * zR * 0.4;
            // Perturb toward worse values: lower for 'max', higher for 'min'
            res.push({
                xVal: p.xVal + (xDir === 'max' ? -dx : dx),
                yVal: p.yVal + (yDir === 'max' ? -dy : dy),
                zVal: p.zVal + (zDir === 'max' ? -dz : dz),
            });
        }
    }
    return res;
}
