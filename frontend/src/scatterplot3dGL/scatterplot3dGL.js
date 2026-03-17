// Entry point for the WebGL 3D scatterplot. Orchestrates scene setup, data sprites,
// optional overlays (surface, dominated cloud, ideal point), axis-brush filters,
// orbit controls and animated transitions across the sub-modules.

import * as THREE from 'three';
import * as d3 from 'd3';
import './scatterplot3dGL.css';
import { getActiveRowIndex, getEffectiveSelection } from '../state/appState.js';
import { getFilterState } from './filterState.js';
import { _instances, setScatter3dGLSelection } from './globalState.js';
import { computeParetoFront, generateDominatedCloud } from './paretoHelpers.js';
import { buildSurfaceMesh } from './surfaceMesh.js';
import { createCircleTexture, createRingTexture, makeTextSprite } from './textureHelpers.js';
import { buildScene } from './sceneSetup.js';
import { buildBrushFilter } from './brushFilter.js';
import { buildOrbitControls } from './orbitControls.js';
import { buildPointVisuals } from './pointVisuals.js';

export { setScatter3dGLSelection };

// Builds or re-builds a complete Three.js 3D scatterplot inside the given container with all interactive features.
export function renderScatterplot3dGL(containerSelector, data, xKey, yKey, zKey, options = {}) {
    const {
        onHoverStart        = () => {},
        onHoverEnd          = () => {},
        onSelectionChange   = () => {},
        onShiftClick        = () => {},
        onBrushFilterChange = () => {},
        disableBrush        = false,
        animate             = false,
        showLabels          = false,
        showSurface         = false,
        showDominated       = false,
        showIdealPoint      = false,
    } = options;

    const filterState   = getFilterState(containerSelector);
    const container     = d3.select(containerSelector);
    const containerNode = container.node();
    if (!containerNode) return;

    const prevXMin = Number(containerNode.dataset.prevGl3dXMin);
    const prevXMax = Number(containerNode.dataset.prevGl3dXMax);
    const prevYMin = Number(containerNode.dataset.prevGl3dYMin);
    const prevYMax = Number(containerNode.dataset.prevGl3dYMax);
    const prevZMin = Number(containerNode.dataset.prevGl3dZMin);
    const prevZMax = Number(containerNode.dataset.prevGl3dZMax);
    const hasPrevDomain = [prevXMin, prevXMax, prevYMin, prevYMax, prevZMin, prevZMax].every(Number.isFinite);

    if (_instances.has(containerSelector)) _instances.get(containerSelector).dispose();
    container.selectAll('*').remove();

    const rect = containerNode.getBoundingClientRect();
    const W = Math.max(400, rect.width || containerNode.clientWidth || 400);
    const H = Math.max(300, rect.height || containerNode.clientHeight || 300);

    const wrapper = container.append('div').attr('class', 'scatter3dgl-wrapper');

    const points = data
        .map((row, i) => ({
            xVal: Number(row[xKey]), yVal: Number(row[yKey]), zVal: Number(row[zKey]),
            rawX: row[xKey], rawY: row[yKey], rawZ: row[zKey],
            rowIndex: row.__rowIndex ?? i,
        }))
        .filter(p => Number.isFinite(p.xVal) && Number.isFinite(p.yVal) && Number.isFinite(p.zVal));

    if (points.length === 0) {
        container.append('p').text('No numeric data for selected axes.');
        return;
    }

    const ext = k => d3.extent(points, p => p[k]);
    const pad = e => (e[1] - e[0] || 1) * 0.05;
    const xExt = ext('xVal'), yExt = ext('yVal'), zExt = ext('zVal');
    const xScale = d3.scaleLinear().domain([xExt[0] - pad(xExt), xExt[1] + pad(xExt)]).range([0, 1]);
    const yScale = d3.scaleLinear().domain([yExt[0] - pad(yExt), yExt[1] + pad(yExt)]).range([0, 1]);
    const zScale = d3.scaleLinear().domain([zExt[0] - pad(zExt), zExt[1] + pad(zExt)]).range([0, 1]);
    points.forEach(p => { p.nx = xScale(p.xVal); p.ny = yScale(p.yVal); p.nz = zScale(p.zVal); });

    const shouldAnimate = animate && hasPrevDomain;
    const ANIM_DUR = 420;
    const startXScale = shouldAnimate ? d3.scaleLinear().domain([prevXMin, prevXMax]).range([0, 1]) : xScale;
    const startYScale = shouldAnimate ? d3.scaleLinear().domain([prevYMin, prevYMax]).range([0, 1]) : yScale;
    const startZScale = shouldAnimate ? d3.scaleLinear().domain([prevZMin, prevZMax]).range([0, 1]) : zScale;
    if (shouldAnimate) {
        points.forEach(p => {
            p.startNx = startXScale(p.xVal);
            p.startNy = startYScale(p.yVal);
            p.startNz = startZScale(p.zVal);
        });
    }

    containerNode.dataset.prevGl3dXMin = String(xScale.domain()[0]);
    containerNode.dataset.prevGl3dXMax = String(xScale.domain()[1]);
    containerNode.dataset.prevGl3dYMin = String(yScale.domain()[0]);
    containerNode.dataset.prevGl3dYMax = String(yScale.domain()[1]);
    containerNode.dataset.prevGl3dZMin = String(zScale.domain()[0]);
    containerNode.dataset.prevGl3dZMax = String(zScale.domain()[1]);

    const { renderer, canvas, scene, camera, spherical, updateCamera, axisLabelSprites, oldAxisLabelSprites } =
        buildScene(containerNode, W, H, xKey, yKey, zKey, xScale, yScale, zScale,
            { startXScale, startYScale, startZScale, shouldAnimate });
    wrapper.node().appendChild(canvas);

    function renderFrame() { renderer.render(scene, camera); }

    const POINT_SIZE     = 0.035;
    const RING_SIZE      = POINT_SIZE * 1.1;
    const pointMeshes    = [], ringMeshes = [];
    const pointCircleTex = createCircleTexture(64, '#ffffff', 1.0);
    const ringTex        = createRingTexture(64, '#1d1d1f', 8);

    points.forEach(p => {
        const sx = shouldAnimate ? p.startNx : p.nx;
        const sy = shouldAnimate ? p.startNy : p.ny;
        const sz = shouldAnimate ? p.startNz : p.nz;
        const mat = new THREE.SpriteMaterial({
            map: pointCircleTex, transparent: true, opacity: 1.0,
            depthTest: true, depthWrite: false, color: '#34c759',
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(POINT_SIZE, POINT_SIZE, 1);
        sprite.position.set(sx, sy, sz);
        sprite.userData = p;
        scene.add(sprite);
        pointMeshes.push(sprite);

        const ring = new THREE.Sprite(new THREE.SpriteMaterial({
            map: ringTex, transparent: true, opacity: 0,
            depthTest: true, depthWrite: false,
        }));
        ring.scale.set(RING_SIZE, RING_SIZE, 2);
        ring.position.set(sx, sy, sz);
        scene.add(ring);
        ringMeshes.push(ring);
    });

    if (showSurface && points.length >= 3) scene.add(buildSurfaceMesh(points));

    if (showDominated && points.length > 0) {
        const front  = computeParetoFront(points);
        const cloud  = generateDominatedCloud(front, xScale.domain(), yScale.domain(), zScale.domain());
        const domTex = createCircleTexture(32, '#ffffff', 1.0);
        cloud.forEach(c => {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: domTex, transparent: true, opacity: 0.35,
                depthTest: true, depthWrite: false, color: '#8a9ab0',
            }));
            sprite.scale.set(0.014, 0.014, 1);
            sprite.position.set(xScale(c.xVal), yScale(c.yVal), zScale(c.zVal));
            scene.add(sprite);
        });
    }

    if (showIdealPoint) {
        const ix = d3.max(points, p => p.xVal);
        const iy = d3.max(points, p => p.yVal);
        const iz = d3.max(points, p => p.zVal);
        if (Number.isFinite(ix) && Number.isFinite(iy) && Number.isFinite(iz)) {
            const idealMesh = new THREE.Sprite(new THREE.SpriteMaterial({
                map: createCircleTexture(64, '#eab308', 1.0, '#ca8a04'),
                transparent: true, opacity: 1.0, depthTest: true, depthWrite: false,
            }));
            idealMesh.scale.set(0.05, 0.05, 1);
            idealMesh.position.set(xScale(ix), yScale(iy), zScale(iz));
            scene.add(idealMesh);
            const idealLabel = makeTextSprite('Ideal Point', { color: '#ca8a04', fontSize: 12, bold: true });
            idealLabel.position.set(xScale(ix) + 0.04, yScale(iy) + 0.04, zScale(iz) + 0.04);
            scene.add(idealLabel);
        }
    }

    const labelSprites = [];
    if (showLabels) {
        points.forEach(p => {
            const sprite = makeTextSprite(`op${p.rowIndex + 1}`, { color: '#5f6673', fontSize: 11 });
            sprite.position.set(p.nx + 0.025, p.ny + 0.025, p.nz + 0.025);
            scene.add(sprite);
            labelSprites.push(sprite);
        });
    }

    wrapper.append('div').attr('class', 'scatter3dgl-hint')
        .text('Drag to rotate · Shift+click to select · Double-click filter to remove');
    const legendDiv = wrapper.append('div').attr('class', 'scatter3dgl-legend');
    if (showSurface) {
        legendDiv.html(
            '<span class="scatter3dgl-legend-title">Distance to Ideal [1, 1, 1]</span>' +
            '<div class="scatter3dgl-legend-bar"></div>' +
            '<div class="scatter3dgl-legend-labels"><span>Near</span><span>Far</span></div>'
        );
    }

    const axisScaleMeta = [
        { key: xKey, scale: xScale, from: new THREE.Vector3(0,0,0), to: new THREE.Vector3(1,0,0), color: '#e74c3c' },
        { key: yKey, scale: yScale, from: new THREE.Vector3(0,0,0), to: new THREE.Vector3(0,1,0), color: '#27ae60' },
        { key: zKey, scale: zScale, from: new THREE.Vector3(0,0,0), to: new THREE.Vector3(0,0,1), color: '#3498db' },
    ];

    const pvModule = buildPointVisuals({
        pointMeshes, ringMeshes, labelSprites, filterState,
        xKey, yKey, zKey, POINT_SIZE, RING_SIZE, renderFrame,
    });

    function updateFilteredPoints() {
        const active   = Object.entries(filterState.axisFilters).filter(([k]) => !filterState.hiddenFilters.has(k));
        const hasBrush = active.length > 0;
        const hasOnlyHidden = Object.keys(filterState.axisFilters).length > 0 && !hasBrush;
        if (!hasOnlyHidden) {
            const wasActive = filterState.hadActiveBrushFilters || false;
            filterState.hadActiveBrushFilters = hasBrush;
            if (hasBrush) {
                const passing = data
                    .filter(row => active.every(([axis, f]) => { const v = Number(row[axis]); return v >= f.min && v <= f.max; }))
                    .map((row, i) => row.__rowIndex ?? i);
                onBrushFilterChange(passing);
            } else if (wasActive) {
                onBrushFilterChange(null);
            }
        }
        pvModule.refreshPointVisuals();
    }

    const filterPlaneGroup    = new THREE.Group();
    const brushHighlightGroup = new THREE.Group();
    scene.add(filterPlaneGroup);
    scene.add(brushHighlightGroup);

    const brushModule = buildBrushFilter({
        canvas, scene, camera, filterState, axisScaleMeta,
        filterPlaneGroup, brushHighlightGroup,
        disableBrush, renderFrame, updateFilteredPoints,
    });

    const orbitModule = buildOrbitControls({
        canvas, camera, spherical, updateCamera, renderer, containerNode,
        pointMeshes, xKey, yKey, zKey,
        renderFrame, onHoverStart, onHoverEnd, onShiftClick,
    });

    brushModule.rebuildFilterPlanes();
    brushModule.rebuildBrushHighlights();
    pvModule.applyHighlight(getActiveRowIndex());
    pvModule.setSelection(getEffectiveSelection());
    updateFilteredPoints();
    renderFrame();

    if (shouldAnimate) {
        const t0 = performance.now();
        function animStep(now) {
            const progress = Math.min((now - t0) / ANIM_DUR, 1);
            const t = 1 - Math.pow(1 - progress, 3);
            points.forEach((p, i) => {
                const x = p.startNx + (p.nx - p.startNx) * t;
                const y = p.startNy + (p.ny - p.startNy) * t;
                const z = p.startNz + (p.nz - p.startNz) * t;
                pointMeshes[i].position.set(x, y, z);
                ringMeshes[i].position.set(x, y, z);
                if (labelSprites[i]) labelSprites[i].position.set(x + 0.025, y + 0.025, z + 0.025);
            });
            oldAxisLabelSprites.forEach(s => { s.material.opacity = 1 - t; });
            axisLabelSprites.forEach(s   => { s.material.opacity = t; });
            renderFrame();
            if (progress < 1) {
                requestAnimationFrame(animStep);
            } else {
                oldAxisLabelSprites.forEach(s => { scene.remove(s); s.material.map?.dispose(); s.material.dispose(); });
            }
        }
        requestAnimationFrame(animStep);
    }

    const dispose = () => {
        containerNode.dataset.gl3dRadius = String(spherical.radius);
        containerNode.dataset.gl3dPhi    = String(spherical.phi);
        containerNode.dataset.gl3dTheta  = String(spherical.theta);
        pvModule.teardown();
        orbitModule.teardown();
        brushModule.teardown();
        renderer.dispose();
        scene.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });
        _instances.delete(containerSelector);
    };

    _instances.set(containerSelector, {
        setSelection:   pvModule.setSelection,
        applyHighlight: pvModule.applyHighlight,
        dispose,
        refreshVisuals: updateFilteredPoints,
    });
}

// Populates a <select> element with the given column names as options.
export function populateAxisSelect3dGL(select, columns) {
    select.selectAll('*').remove();
    select.selectAll('option')
        .data(columns)
        .enter()
        .append('option')
        .attr('value', c => c)
        .text(c => c);
}
