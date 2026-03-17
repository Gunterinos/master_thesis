/**
 * brushFilter.js
 *
 * Axis-brush filter system for the 3D GL scatterplot.
 *
 * Users drag along any of the three axis spines to define a min/max range
 * filter.  The filter is drawn as:
 *   • Semi-transparent coloured plane slices in 3D space (Three.js meshes)
 *   • A thick highlight segment + endpoint handle sprites on the axis spine
 *
 * Interaction model:
 *   • Pointerdown near an axis spine starts a brush drag (capture phase,
 *     before the orbit handler sees it).
 *   • Pointermove updates the range live; pointermove/pointerup commit it.
 *   • A drag shorter than 0.5 % of the axis → treated as a click → removes
 *     the filter for that axis.
 *   • Double-clicking on a brushed axis also removes its filter.
 *
 * Exports:
 *   buildBrushFilter(ctx) – wires up all event listeners and returns
 *     { rebuildFilterPlanes, rebuildBrushHighlights, teardown }
 *
 * ctx shape:
 *   { canvas, scene, camera, filterState, axisScaleMeta, filterPlaneGroup,
 *     brushHighlightGroup, disableBrush, renderFrame,
 *     updateFilteredPoints, makeCircleSprite }
 */

import * as THREE from 'three';
import { makeCircleSprite } from './textureHelpers.js';

/**
 * @param {object} ctx
 * @param {HTMLCanvasElement}  ctx.canvas
 * @param {THREE.Scene}        ctx.scene
 * @param {THREE.Camera}       ctx.camera
 * @param {object}             ctx.filterState       – from filterState.js
 * @param {Array}              ctx.axisScaleMeta     – [{key, scale, from, to, color, colorHex}]
 * @param {THREE.Group}        ctx.filterPlaneGroup
 * @param {THREE.Group}        ctx.brushHighlightGroup
 * @param {boolean}            ctx.disableBrush
 * @param {Function}           ctx.renderFrame
 * @param {Function}           ctx.updateFilteredPoints
 */
export function buildBrushFilter(ctx) {
    const {
        canvas, scene, camera, filterState,
        axisScaleMeta, filterPlaneGroup, brushHighlightGroup,
        disableBrush, renderFrame, updateFilteredPoints,
    } = ctx;

    /* ---- project 3D → canvas 2D ---- */
    function toScreenV2(v3) {
        const cW = canvas.clientWidth, cH = canvas.clientHeight;
        const v = v3.clone().project(camera);
        return new THREE.Vector2((v.x * 0.5 + 0.5) * cW, (-v.y * 0.5 + 0.5) * cH);
    }

    /* ---- hit-test: find closest axis spine to a 2D screen point ---- */
    const AXIS_HIT_DIST = 18; // px
    function hitTestAxis(sx, sy) {
        const sp = new THREE.Vector2(sx, sy);
        let best = null, bestDist = AXIS_HIT_DIST;
        axisScaleMeta.forEach(axis => {
            if (filterState.hiddenFilters.has(axis.key)) return;
            const a = toScreenV2(axis.from), b = toScreenV2(axis.to);
            const ab = b.clone().sub(a);
            const abLen = ab.length();
            if (abLen < 10) return;
            const ap = sp.clone().sub(a);
            let t = ap.dot(ab) / (abLen * abLen);
            t = Math.max(0, Math.min(1, t));
            const dist = sp.distanceTo(a.clone().add(ab.clone().multiplyScalar(t)));
            if (dist < bestDist) { bestDist = dist; best = { axis, t }; }
        });
        return best;
    }

    /* ---- rebuild filter plane meshes ---- */
    function rebuildFilterPlanes() {
        while (filterPlaneGroup.children.length) {
            const c = filterPlaneGroup.children[0];
            filterPlaneGroup.remove(c);
            c.geometry?.dispose();
            c.material?.dispose();
        }
        axisScaleMeta.forEach(({ key, scale, colorHex: color, from, to }) => {
            const f = filterState.axisFilters[key];
            if (!f || filterState.hiddenFilters.has(key)) return;
            const normal = to.clone().sub(from);
            [f.min, f.max].forEach(dataVal => {
                const t = scale(dataVal);
                const planeGeom = new THREE.PlaneGeometry(1, 1);
                const planeMat  = new THREE.MeshBasicMaterial({
                    color, transparent: true, opacity: 0.22,
                    side: THREE.DoubleSide, depthWrite: false,
                });
                const mesh = new THREE.Mesh(planeGeom, planeMat);
                mesh.renderOrder = 1;
                if (normal.x === 1) { mesh.rotation.y = Math.PI / 2; mesh.position.set(t, 0.5, 0.5); }
                else if (normal.y === 1) { mesh.rotation.x = Math.PI / 2; mesh.position.set(0.5, t, 0.5); }
                else { mesh.position.set(0.5, 0.5, t); }
                filterPlaneGroup.add(mesh);

                const edgesGeom = new THREE.EdgesGeometry(planeGeom);
                const edgeMat   = new THREE.LineDashedMaterial({
                    color, transparent: true, opacity: 0.8,
                    dashSize: 0.06, gapSize: 0.04, depthWrite: false,
                });
                const edges = new THREE.LineSegments(edgesGeom, edgeMat);
                edges.computeLineDistances();
                edges.rotation.copy(mesh.rotation);
                edges.position.copy(mesh.position);
                filterPlaneGroup.add(edges);
            });
        });
    }

    /* ---- rebuild brush highlight segments on each axis ---- */
    function rebuildBrushHighlights() {
        while (brushHighlightGroup.children.length) {
            const c = brushHighlightGroup.children[0];
            brushHighlightGroup.remove(c);
            c.geometry?.dispose();
            c.material?.dispose();
        }
        axisScaleMeta.forEach(({ key, scale, colorHex, from, to }) => {
            const f = filterState.axisFilters[key];
            if (!f || filterState.hiddenFilters.has(key)) return;
            const tMin = scale(f.min), tMax = scale(f.max);
            const dir  = to.clone().sub(from);
            const p0   = from.clone().add(dir.clone().multiplyScalar(tMin));
            const p1   = from.clone().add(dir.clone().multiplyScalar(tMax));
            const geom = new THREE.BufferGeometry().setFromPoints([p0, p1]);
            const mat  = new THREE.LineBasicMaterial({ color: colorHex, linewidth: 3, transparent: true, opacity: 0.8 });
            brushHighlightGroup.add(new THREE.Line(geom, mat));
            [p0, p1].forEach(pt => {
                const s = makeCircleSprite(colorHex, 0.06);
                s.position.copy(pt);
                brushHighlightGroup.add(s);
            });
        });
    }

    /* ---- brush drag state ---- */
    let brushDrag = null;

    function onBrushDown(e) {
        if (disableBrush || e.shiftKey || e.button !== 0) return;
        const rect = canvas.getBoundingClientRect();
        const hit  = hitTestAxis(e.clientX - rect.left, e.clientY - rect.top);
        if (!hit) return;
        e.preventDefault();
        e.stopPropagation();
        brushDrag = { axis: hit.axis, anchorT: hit.t, startT: hit.t, endT: hit.t };
    }

    function onBrushMove(e) {
        if (!brushDrag) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const { axis, anchorT } = brushDrag;
        const a = toScreenV2(axis.from), b = toScreenV2(axis.to);
        const ab = b.clone().sub(a);
        if (ab.length() < 1) return;
        const sp = new THREE.Vector2(e.clientX - rect.left, e.clientY - rect.top);
        let t = sp.clone().sub(a).dot(ab) / ab.lengthSq();
        t = Math.max(0, Math.min(1, t));
        brushDrag.startT = Math.min(anchorT, t);
        brushDrag.endT   = Math.max(anchorT, t);
        const dMin = axis.scale.invert(brushDrag.startT);
        const dMax = axis.scale.invert(brushDrag.endT);
        filterState.axisFilters[axis.key] = { min: Math.min(dMin, dMax), max: Math.max(dMin, dMax) };
        updateFilteredPoints();
        rebuildFilterPlanes();
        rebuildBrushHighlights();
        renderFrame();
    }

    function onBrushUp() {
        if (!brushDrag) return;
        if (brushDrag.endT - brushDrag.startT < 0.005) {
            delete filterState.axisFilters[brushDrag.axis.key];
            updateFilteredPoints();
            rebuildFilterPlanes();
            rebuildBrushHighlights();
            renderFrame();
        }
        brushDrag = null;
    }

    function onBrushDblClick(e) {
        if (disableBrush) return;
        const rect = canvas.getBoundingClientRect();
        const hit  = hitTestAxis(e.clientX - rect.left, e.clientY - rect.top);
        if (!hit || !filterState.axisFilters[hit.axis.key]) return;
        e.preventDefault();
        e.stopPropagation();
        delete filterState.axisFilters[hit.axis.key];
        filterState.hiddenFilters.delete(hit.axis.key);
        updateFilteredPoints();
        rebuildFilterPlanes();
        rebuildBrushHighlights();
        renderFrame();
    }

    canvas.addEventListener('pointerdown', onBrushDown, true);
    window.addEventListener('pointermove', onBrushMove);
    window.addEventListener('pointerup',   onBrushUp);
    canvas.addEventListener('dblclick',    onBrushDblClick);

    function teardown() {
        canvas.removeEventListener('pointerdown', onBrushDown, true);
        window.removeEventListener('pointermove', onBrushMove);
        window.removeEventListener('pointerup',   onBrushUp);
        canvas.removeEventListener('dblclick',    onBrushDblClick);
    }

    return { rebuildFilterPlanes, rebuildBrushHighlights, teardown };
}
