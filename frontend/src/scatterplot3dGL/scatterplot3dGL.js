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
import {
    POINT_COLOR_BENCHMARK, interpolateSurfaceColor,
    COLOR_WHITE, COLOR_INK, COLOR_DOMINATED,
    COLOR_IDEAL_FILL, COLOR_IDEAL_STROKE, COLOR_TEXT_SECONDARY,
    getColumnColor, getGroupBaseColor, getGroupOrder,
} from '../colors.js';

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
        objectiveDirections = {},
        groupColorOverrides = null,
        decisionColumns     = [],
        groups              = {},
        frontierColorOverrides = null,
        frontierLegendItems    = [],
    } = options;

    const xDir = objectiveDirections[xKey] ?? 'min';
    const yDir = objectiveDirections[yKey] ?? 'min';
    const zDir = objectiveDirections[zKey] ?? 'min';

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

    const totalObj = Object.keys(data[0] || {}).filter(k => k.startsWith('obj')).length;

    const wrapper = container.append('div').attr('class', 'scatter3dgl-wrapper');

    const points = data
        .map((row, i) => ({
            xVal: Number(row[xKey]), yVal: Number(row[yKey]), zVal: Number(row[zKey]),
            rawX: row[xKey], rawY: row[yKey], rawZ: row[zKey],
            rowIndex: row.__rowIndex ?? i,
            isBenchmark: row.__isBenchmark === true,
        }))
        .filter(p => Number.isFinite(p.xVal) && Number.isFinite(p.yVal) && Number.isFinite(p.zVal));

    const frontierByIndex = new Map(data.map(row => [row.__rowIndex, row.__frontier ?? null]));

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

    // Compute distance-to-ideal colour for each point (same gradient as the Pareto surface).
    const xIdeal = xDir === 'max' ? 1 : 0;
    const yIdeal = yDir === 'max' ? 1 : 0;
    const zIdeal = zDir === 'max' ? 1 : 0;
    points.forEach(p => {
        p.distToIdeal = Math.sqrt((xIdeal - p.nx) ** 2 + (yIdeal - p.ny) ** 2 + (zIdeal - p.nz) ** 2);
    });
    const dMin = Math.min(...points.map(p => p.distToIdeal));
    const dMax = Math.max(...points.map(p => p.distToIdeal));
    const dRange = dMax - dMin || 1;
    points.forEach(p => {
        const ao = (p.distToIdeal - dMin) / dRange;
        p.surfaceColor = interpolateSurfaceColor(ao).hex;
    });

    const shouldAnimate = animate && hasPrevDomain;
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
    const pointCircleTex = createCircleTexture(64, COLOR_WHITE, 1.0);
    const ringTex        = createRingTexture(64, COLOR_INK, 8);

    points.forEach(p => {
        p.activeColor = p.isBenchmark
            ? POINT_COLOR_BENCHMARK
            : (frontierColorOverrides?.get(p.rowIndex) ?? groupColorOverrides?.get(p.rowIndex) ?? p.surfaceColor);
        const sx = shouldAnimate ? p.startNx : p.nx;
        const sy = shouldAnimate ? p.startNy : p.ny;
        const sz = shouldAnimate ? p.startNz : p.nz;
        p.baseSize     = p.isBenchmark ? POINT_SIZE * 1.4 : POINT_SIZE;
        p.baseRingSize = p.baseSize * (RING_SIZE / POINT_SIZE);
        const mat = new THREE.SpriteMaterial({
            map: pointCircleTex, transparent: true, opacity: 1.0,
            depthTest: true, depthWrite: false,
            color: p.activeColor,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(p.baseSize, p.baseSize, 1);
        sprite.position.set(sx, sy, sz);
        sprite.userData = p;
        scene.add(sprite);
        pointMeshes.push(sprite);

        const ring = new THREE.Sprite(new THREE.SpriteMaterial({
            map: ringTex, transparent: true, opacity: 0,
            depthTest: true, depthWrite: false,
        }));
        ring.scale.set(p.baseRingSize, p.baseRingSize, 2);
        ring.position.set(sx, sy, sz);
        scene.add(ring);
        ringMeshes.push(ring);
    });

    if (showSurface && points.length >= 3) scene.add(buildSurfaceMesh(points.filter(p => !p.isBenchmark), xDir, yDir, zDir));

    if (showDominated && points.length > 0) {
        const front  = computeParetoFront(points, xDir, yDir, zDir);
        const cloud  = generateDominatedCloud(front, xScale.domain(), yScale.domain(), zScale.domain(), xDir, yDir, zDir);
        const domTex = createCircleTexture(32, COLOR_WHITE, 1.0);
        cloud.forEach(c => {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: domTex, transparent: true, opacity: 0.35,
                depthTest: true, depthWrite: false, color: COLOR_DOMINATED,
            }));
            sprite.scale.set(0.014, 0.014, 1);
            sprite.position.set(xScale(c.xVal), yScale(c.yVal), zScale(c.zVal));
            scene.add(sprite);
        });
    }

    if (showIdealPoint) {
        const ix = xDir === 'max' ? d3.max(points, p => p.xVal) : d3.min(points, p => p.xVal);
        const iy = yDir === 'max' ? d3.max(points, p => p.yVal) : d3.min(points, p => p.yVal);
        const iz = zDir === 'max' ? d3.max(points, p => p.zVal) : d3.min(points, p => p.zVal);
        if (Number.isFinite(ix) && Number.isFinite(iy) && Number.isFinite(iz)) {
            const idealMesh = new THREE.Sprite(new THREE.SpriteMaterial({
                map: createCircleTexture(64, COLOR_IDEAL_FILL, 1.0, COLOR_IDEAL_STROKE),
                transparent: true, opacity: 1.0, depthTest: true, depthWrite: false,
            }));
            idealMesh.scale.set(0.05, 0.05, 1);
            idealMesh.position.set(xScale(ix), yScale(iy), zScale(iz));
            scene.add(idealMesh);
            const idealLabel = makeTextSprite('Ideal Point', { color: COLOR_IDEAL_STROKE, fontSize: 12, bold: true });
            idealLabel.position.set(xScale(ix) + 0.04, yScale(iy) + 0.04, zScale(iz) + 0.04);
            scene.add(idealLabel);
        }
    }

    const labelSprites = [];
    if (showLabels) {
        points.forEach(p => {
            const sprite = makeTextSprite(p.isBenchmark ? 'Benchmark' : `op${p.rowIndex}`, { color: p.isBenchmark ? POINT_COLOR_BENCHMARK : COLOR_TEXT_SECONDARY, fontSize: 11 });
            sprite.position.set(p.nx + 0.025, p.ny + 0.025, p.nz + 0.025);
            scene.add(sprite);
            labelSprites.push(sprite);
        });
    }

    wrapper.append('div').attr('class', 'scatter3dgl-hint')
        .text('Drag to rotate · Shift+click to select · Double-click filter to remove');

    if (totalObj > 3) {
        const warnTooltip = d3.select("body")
            .selectAll(".scatter-warn-tooltip")
            .data([null]).join("div")
            .attr("class", "scatter-warn-tooltip");

        wrapper.append("div")
            .attr("class", "scatter-dim-warning")
            .text("!")
            .on("mouseenter", (event) => {
                warnTooltip
                    .classed("visible", true)
                    .html(`Only 3 of ${totalObj} objectives shown<br>results may be misleading.`)
                    .style("left", `${event.pageX + 12}px`)
                    .style("top",  `${event.pageY - 36}px`);
            })
            .on("mousemove", (event) => {
                warnTooltip
                    .style("left", `${event.pageX + 12}px`)
                    .style("top",  `${event.pageY - 36}px`);
            })
            .on("mouseleave", () => warnTooltip.classed("visible", false));
    }
    const legendDiv = wrapper.append('div').attr('class', 'scatter3dgl-legend');
    const idealLabel = [xDir, yDir, zDir].map(d => d === 'max' ? 'max' : 'min').join(', ');
    const _buildLegendRows = (items) => items.map(({ label, color }) =>
        `<div class="scatter3dgl-legend-benchmark">` +
        `<span class="scatter3dgl-legend-dot" style="background:${color}"></span>` +
        `<span>${label}</span></div>`
    ).join('');
    const surfaceSection = showSurface
        ? `<div style="margin-top:8px">` +
          `<span class="scatter3dgl-legend-title">Surface · Distance to Ideal [${idealLabel}]</span>` +
          `<div class="scatter3dgl-legend-bar"></div>` +
          `<div class="scatter3dgl-legend-labels"><span>Near</span><span>Far</span></div></div>`
        : '';
    const benchmarkRow = `<div class="scatter3dgl-legend-benchmark" style="margin-top:6px">` +
        `<span class="scatter3dgl-legend-dot" style="background:${POINT_COLOR_BENCHMARK}"></span>` +
        `<span>Benchmark</span></div>`;

    if (frontierColorOverrides && frontierLegendItems.length > 0) {
        legendDiv.html(
            `<span class="scatter3dgl-legend-title">Frontier</span>` +
            _buildLegendRows(frontierLegendItems) +
            benchmarkRow +
            surfaceSection
        );
    } else if (groupColorOverrides && decisionColumns.length > 0) {
        const hasGroups = groups && Object.keys(groups).length > 0;
        const legendItems = hasGroups
            ? getGroupOrder(decisionColumns, groups).map((grp, gi) => ({ label: grp, color: getGroupBaseColor(gi) }))
            : decisionColumns.map((col, i) => ({ label: col, color: getColumnColor(i) }));
        legendDiv.html(
            `<span class="scatter3dgl-legend-title">${hasGroups ? 'Dominant Dec. Group' : 'Dominant Dec. Variable'}</span>` +
            _buildLegendRows(legendItems) +
            benchmarkRow +
            surfaceSection
        );
    } else {
        legendDiv.html(
            `<span class="scatter3dgl-legend-title">Distance to Ideal [${idealLabel}]</span>` +
            '<div class="scatter3dgl-legend-bar"></div>' +
            '<div class="scatter3dgl-legend-labels"><span>Near</span><span>Far</span></div>' +
            benchmarkRow
        );
    }

    const axisScaleMeta = [
        { key: xKey, scale: xScale, from: new THREE.Vector3(0,0,0), to: new THREE.Vector3(1,0,0), color: COLOR_INK },
        { key: yKey, scale: yScale, from: new THREE.Vector3(0,0,0), to: new THREE.Vector3(0,1,0), color: COLOR_INK },
        { key: zKey, scale: zScale, from: new THREE.Vector3(0,0,0), to: new THREE.Vector3(0,0,1), color: COLOR_INK },
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
        pointMeshes, xKey, yKey, zKey, frontierByIndex,
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
            const progress = Math.min((now - t0) / 420, 1);
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
