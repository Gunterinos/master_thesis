// Builds a Delaunay surface mesh with a Cividis distance-to-ideal gradient
// for the optional Pareto-approximation overlay in the 3D GL scatterplot.

import * as THREE from 'three';
import * as d3 from 'd3';
import { interpolateSurfaceColor, COLOR_SURFACE_EDGE } from '../colors.js';

const surfaceStyle = {
    edgeColor: COLOR_SURFACE_EDGE,
    edgeOpacity: 0.34,
};

// Triangulates normalised points via Delaunay in XY, lifts to 3D, and returns a Three.js Group with the filled mesh and wireframe contours.
// xDir/yDir/zDir: 'max' means higher normalised value is better (ideal = 1), 'min' means lower is better (ideal = 0).
export function buildSurfaceMesh(points, xDir = 'min', yDir = 'min', zDir = 'min') {
    const delaunay = d3.Delaunay.from(points, d => d.nx, d => d.ny);
    const tris = delaunay.triangles;
    const positions = [];
    const colors = [];

    // Ideal corner in normalised [0,1] space: 1 for max axes, 0 for min axes
    const xIdeal = xDir === 'max' ? 1 : 0;
    const yIdeal = yDir === 'max' ? 1 : 0;
    const zIdeal = zDir === 'max' ? 1 : 0;

    const triDists = [];
    for (let i = 0; i < tris.length; i += 3) {
        const p0 = points[tris[i]], p1 = points[tris[i + 1]], p2 = points[tris[i + 2]];
        const cx = (p0.nx + p1.nx + p2.nx) / 3;
        const cy = (p0.ny + p1.ny + p2.ny) / 3;
        const cz = (p0.nz + p1.nz + p2.nz) / 3;
        triDists.push(Math.sqrt((xIdeal - cx) ** 2 + (yIdeal - cy) ** 2 + (zIdeal - cz) ** 2));
    }
    const distMin = Math.min(...triDists);
    const distMax = Math.max(...triDists);
    const distRange = distMax - distMin || 1;

    for (let i = 0; i < tris.length; i += 3) {
        const p0 = points[tris[i]], p1 = points[tris[i + 1]], p2 = points[tris[i + 2]];
        positions.push(p0.nx, p0.ny, p0.nz, p1.nx, p1.ny, p1.nz, p2.nx, p2.ny, p2.nz);

        const ao = (triDists[i / 3] - distMin) / distRange;
        const { r, g, b } = interpolateSurfaceColor(ao);
        for (let v = 0; v < 3; v++) colors.push(r, g, b);
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
