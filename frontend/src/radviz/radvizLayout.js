import * as d3 from 'd3';

const MINI_R = 8;

/**
 * Compute RadViz anchor positions and data-point positions.
 * Each anchor sits at a vertex of a regular N-gon on the unit circle.
 * Each point is the normalised weighted centroid of the anchors.
 */
export function computeRadvizPoints(data, columns) {
    const d = columns.length;
    const anchors = columns.map((col, j) => ({
        col,
        ax: Math.cos((2 * Math.PI * j) / d),
        ay: Math.sin((2 * Math.PI * j) / d),
    }));

    const mins = columns.map((col) => d3.min(data, (row) => +row[col]));
    const maxs = columns.map((col) => d3.max(data, (row) => +row[col]));

    const points = data.map((row) => {
        let wx = 0, wy = 0, wSum = 0;
        anchors.forEach(({ ax, ay }, j) => {
            const range = maxs[j] - mins[j] || 1;
            const v = Math.max(0, Math.min(1, (+row[columns[j]] - mins[j]) / range));
            wx += v * ax;
            wy += v * ay;
            wSum += v;
        });
        return {
            x: wSum > 0 ? wx / wSum : 0,
            y: wSum > 0 ? wy / wSum : 0,
            rowIndex: row.__rowIndex ?? 0,
            row,
        };
    });

    // Zoom to fill: scale so the outermost point sits on the unit-circle boundary.
    const maxDist = Math.max(...points.map(p => Math.hypot(p.x, p.y)));
    if (maxDist > 0.001) {
        points.forEach(p => { p.x /= maxDist; p.y /= maxDist; });
    }

    return { anchors, points };
}

/**
 * Run a D3-force collision simulation to find spread-equilibrium positions.
 * Nodes start at their RadViz positions and settle into a hexagonal packing
 * bounded by the polygon formed by the anchor vertices.
 *
 * Returns { nodes, nodeRadius } where nodes[i] = { rowIndex, x, y } in SVG coords.
 */
export function computeEquilibrium(points, R, vertices) {
    const N = points.length;
    if (N === 0) return { nodes: [], nodeRadius: MINI_R };

    const nodes = points.map(p => ({ rowIndex: p.rowIndex, x: p.x * R, y: p.y * R }));

    // Collision radius derived from polygon area: each node "owns" area/N of space.
    // Factor 0.55 leaves visible gaps between glyphs.
    const area = Math.abs(d3.polygonArea(vertices));
    const nodeRadius = Math.sqrt(area / N) * 0.55;

    const sim = d3.forceSimulation(nodes)
        .force('collide', d3.forceCollide(nodeRadius).iterations(4))
        .force('cx', d3.forceX(0).strength(0.08))
        .force('cy', d3.forceY(0).strength(0.08))
        .stop();

    for (let i = 0; i < 400; i++) {
        sim.tick();
        // Soft polygon wall: push escaped nodes back inside with velocity dampening
        nodes.forEach(n => {
            if (!d3.polygonContains(vertices, [n.x, n.y])) {
                let lo = 0, hi = 1;
                for (let j = 0; j < 15; j++) {
                    const mid = (lo + hi) / 2;
                    d3.polygonContains(vertices, [n.x * mid, n.y * mid]) ? (lo = mid) : (hi = mid);
                }
                n.x *= lo * 0.97; n.y *= lo * 0.97; n.vx *= 0.3; n.vy *= 0.3;
            }
        });
    }
    return { nodes, nodeRadius };
}

/**
 * Interpolate a glyph's SVG transform between its RadViz position (s=0)
 * and its equilibrium position (s=1), including a proportional scale.
 */
export function getTransform(p, s, R, eqMap, maxGlyphR) {
    const rx = p.x * R, ry = p.y * R;
    if (s < 0.001) return `translate(${rx}, ${ry})`;
    const glyphScale = 1 + (Math.max(MINI_R, maxGlyphR) / MINI_R - 1) * s;
    const scalePart = glyphScale > 1.001 ? ` scale(${glyphScale.toFixed(3)})` : '';
    const en = eqMap.get(p.rowIndex);
    if (!en) return `translate(${rx}, ${ry})${scalePart}`;
    return `translate(${rx * (1 - s) + en.x * s}, ${ry * (1 - s) + en.y * s})${scalePart}`;
}
