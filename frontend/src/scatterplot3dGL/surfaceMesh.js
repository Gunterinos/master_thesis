/**
 * surfaceMesh.js
 *
 * Builds the optional Pareto-approximation surface mesh shown in the 3D GL
 * scatterplot when the `showSurface` option is enabled.
 *
 * buildSurfaceMesh – given an array of normalised points (each with nx/ny/nz
 *   in [0,1]), performs a 2D Delaunay triangulation in the XY plane and
 *   lifts it to 3D.  Returns a Three.js Group containing:
 *     • a filled MeshBasicMaterial mesh with a stretched HSL gradient
 *       (near-ideal → light, far-ideal → dark)
 *     • a translucent WireframeGeometry line overlay for contour edges
 *
 * The gradient is normalised over the actual centroid-distance range in the
 * data rather than the theoretical [0, √3] maximum, so it always makes good
 * use of the full colour ramp.
 */

import * as THREE from 'three';
import * as d3 from 'd3';

const surfaceStyle = {
    fillHue: 216 / 360,
    fillSaturation: 0.42,
    lightnessNear: 0.92,
    lightnessFar: 0.28,
    edgeColor: 0x1e293b,
    edgeOpacity: 0.34,
};

/**
 * @param {Array<{nx:number, ny:number, nz:number}>} points  normalised data points
 * @returns {THREE.Group}
 */
export function buildSurfaceMesh(points) {
    const delaunay = d3.Delaunay.from(points, d => d.nx, d => d.ny);
    const tris = delaunay.triangles;
    const positions = [];
    const colors = [];

    // First pass: collect centroid distances so the gradient spans the actual range
    const triDists = [];
    for (let i = 0; i < tris.length; i += 3) {
        const p0 = points[tris[i]], p1 = points[tris[i + 1]], p2 = points[tris[i + 2]];
        const cx = (p0.nx + p1.nx + p2.nx) / 3;
        const cy = (p0.ny + p1.ny + p2.ny) / 3;
        const cz = (p0.nz + p1.nz + p2.nz) / 3;
        triDists.push(Math.sqrt((1 - cx) ** 2 + (1 - cy) ** 2 + (1 - cz) ** 2));
    }
    const distMin = Math.min(...triDists);
    const distMax = Math.max(...triDists);
    const distRange = distMax - distMin || 1;

    // Second pass: geometry with stretched gradient
    for (let i = 0; i < tris.length; i += 3) {
        const p0 = points[tris[i]], p1 = points[tris[i + 1]], p2 = points[tris[i + 2]];
        positions.push(p0.nx, p0.ny, p0.nz, p1.nx, p1.ny, p1.nz, p2.nx, p2.ny, p2.nz);

        const ao = (triDists[i / 3] - distMin) / distRange;
        const lightness = surfaceStyle.lightnessNear - ao * (surfaceStyle.lightnessNear - surfaceStyle.lightnessFar);
        const c = new THREE.Color();
        c.setHSL(surfaceStyle.fillHue, surfaceStyle.fillSaturation, lightness);
        for (let v = 0; v < 3; v++) colors.push(c.r, c.g, c.b);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 0;

    const contourGeom = new THREE.WireframeGeometry(geom);
    const contourMat = new THREE.LineBasicMaterial({
        color: surfaceStyle.edgeColor,
        transparent: true,
        opacity: surfaceStyle.edgeOpacity,
        depthTest: true,
        depthWrite: false,
    });
    const contours = new THREE.LineSegments(contourGeom, contourMat);
    contours.renderOrder = 2;

    const group = new THREE.Group();
    group.add(mesh);
    group.add(contours);
    return group;
}
