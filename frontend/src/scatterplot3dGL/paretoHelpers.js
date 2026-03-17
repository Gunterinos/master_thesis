/**
 * paretoHelpers.js
 *
 * Pareto-front calculation and dominated-cloud generation utilities used by
 * the 3D GL scatterplot's optional overlay features
 * (showSurface / showDominated / showIdealPoint options).
 *
 * computeParetoFront – given an array of points with xVal/yVal/zVal,
 *   returns the non-dominated subset (all three objectives maximised).
 *
 * generateDominatedCloud – given the Pareto front and axis domains, generates
 *   a deterministic pseudo-random point cloud that lies inside the dominated
 *   region to convey where dominated solutions sit.
 */

/**
 * Returns the non-dominated (Pareto-optimal) subset of pts.
 * A point p is dominated if there exists another point q where
 * q is <= p on every objective and strictly < on at least one.
 */
export function computeParetoFront(pts) {
    return pts.filter(p => !pts.some(q =>
        q !== p &&
        q.xVal <= p.xVal && q.yVal <= p.yVal && q.zVal <= p.zVal &&
        (q.xVal < p.xVal || q.yVal < p.yVal || q.zVal < p.zVal)
    ));
}

/**
 * Generates a fixed-size cloud of ghost points that fall
 * inside the dominated region below the Pareto front.
 * Uses a seeded LCG so the cloud is stable across re-renders.
 *
 * @param {Array}  front  – Pareto-front points array
 * @param {[number,number]} xDom – [min, max] for x axis
 * @param {[number,number]} yDom – [min, max] for y axis
 * @param {[number,number]} zDom – [min, max] for z axis
 * @param {number} count  – number of cloud points to generate (default 280)
 */
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
