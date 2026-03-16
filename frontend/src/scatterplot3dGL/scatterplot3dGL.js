import * as THREE from 'three';
import * as d3 from 'd3';
import './scatterplot3dGL.css';
import { subscribe, getActiveRowIndex, getEffectiveSelection } from '../state/appState.js';

/* ================================================================== */
/*  Per-instance brush filter state (same pattern as SVG version)      */
/* ================================================================== */
const _filterStates = new Map();

function getFilterState(sel) {
    if (!_filterStates.has(sel)) {
        _filterStates.set(sel, { axisFilters: {}, hiddenFilters: new Set(), hadActiveBrushFilters: false });
    }
    return _filterStates.get(sel);
}

subscribe('zoom-enter', () => {
    _filterStates.forEach(s => Object.keys(s.axisFilters).forEach(k => s.hiddenFilters.add(k)));
    _instances.forEach(inst => inst.refreshVisuals());
});
subscribe('zoom-exit', () => {
    _filterStates.forEach(s => s.hiddenFilters.clear());
    _instances.forEach(inst => inst.refreshVisuals());
});
subscribe('filters-clear', () => {
    _filterStates.forEach(s => { s.axisFilters = {}; s.hiddenFilters.clear(); s.hadActiveBrushFilters = false; });
    _instances.forEach(inst => inst.refreshVisuals());
});

/* ================================================================== */
/*  Global hover / selection state shared across instances             */
/* ================================================================== */
const _instances = new Map();   // containerSelector → { setSelection, applyHighlight, dispose }

function globalHighlight(rowIndex) {
    _instances.forEach(inst => inst.applyHighlight(rowIndex));
}
subscribe('hover-change', globalHighlight);

export function setScatter3dGLSelection(rowIndexSet) {
    _instances.forEach(inst => inst.setSelection(rowIndexSet));
}
subscribe('selection-change', setScatter3dGLSelection);

/* ================================================================== */
/*  Pareto / dominated cloud helpers (same logic as SVG version)       */
/* ================================================================== */
function computeParetoFront(pts) {
    return pts.filter(p => !pts.some(q =>
        q !== p &&
        q.xVal <= p.xVal && q.yVal <= p.yVal && q.zVal <= p.zVal &&
        (q.xVal < p.xVal || q.yVal < p.yVal || q.zVal < p.zVal)
    ));
}

function generateDominatedCloud(front, xDom, yDom, zDom, count = 280) {
    if (!front.length) return [];
    const xR = (xDom[1] - xDom[0]) || 1;
    const yR = (yDom[1] - yDom[0]) || 1;
    const zR = (zDom[1] - zDom[0]) || 1;
    let seed = front.reduce((s, p) => (s + p.xVal * 7 + p.yVal * 13 + p.zVal * 17) | 0, 0);
    const rand = () => { seed = (seed * 1664525 + 1013904223) | 0; return (seed >>> 0) / 0xFFFFFFFF; };
    const res = [], per = Math.ceil(count / front.length);
    for (const p of front) {
        for (let i = 0; i < per && res.length < count; i++) {
            res.push({ xVal: p.xVal - rand() * xR * 0.4, yVal: p.yVal - rand() * yR * 0.4, zVal: p.zVal - rand() * zR * 0.4 });
        }
    }
    return res;
}

/* ================================================================== */
/*  Helper: build a Delaunay surface mesh in Three.js                  */
/* ================================================================== */
function buildSurfaceMesh(points) {
    // Delaunay triangulation in the XY plane of normalised coords, extruded to Z
    const delaunay = d3.Delaunay.from(points, d => d.nx, d => d.ny);
    const tris = delaunay.triangles;
    const positions = [];
    const colors = [];

    const maxDist = Math.sqrt(3); // diagonal of unit cube from [0,0,0] to [1,1,1]

    for (let i = 0; i < tris.length; i += 3) {
        const p0 = points[tris[i]], p1 = points[tris[i + 1]], p2 = points[tris[i + 2]];
        // Push positions
        positions.push(p0.nx, p0.ny, p0.nz, p1.nx, p1.ny, p1.nz, p2.nx, p2.ny, p2.nz);

        // AO-style colouring based on centroid distance to ideal [1,1,1]
        const cx = (p0.nx + p1.nx + p2.nx) / 3;
        const cy = (p0.ny + p1.ny + p2.ny) / 3;
        const cz = (p0.nz + p1.nz + p2.nz) / 3;
        const dist = Math.sqrt((1 - cx) ** 2 + (1 - cy) ** 2 + (1 - cz) ** 2);
        const ao = Math.min(dist / maxDist, 1);
        const lightness = 1.0 - ao * 0.5;
        // HSL(216, 25%, lightness) → approximate in RGB
        const c = new THREE.Color();
        c.setHSL(216 / 360, 0.25, lightness);
        // Same colour for all 3 verts of this tri (flat shading)
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
        opacity: 0.75,
    });
    return new THREE.Mesh(geom, mat);
}

/* ================================================================== */
/*  MAIN RENDER                                                        */
/* ================================================================== */
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

    const filterState = getFilterState(containerSelector);
    const container = d3.select(containerSelector);
    const containerNode = container.node();
    if (!containerNode) return;

    /* ---- persist / restore camera state across re-renders ---- */
    const savedRadius = Number(containerNode.dataset.gl3dRadius);
    const savedPhi    = Number(containerNode.dataset.gl3dPhi);
    const savedTheta  = Number(containerNode.dataset.gl3dTheta);
    const hasSavedCamera = [savedRadius, savedPhi, savedTheta].every(Number.isFinite);

    /* ---- previous domain state (for animated transitions) ---- */
    const prevXMin = Number(containerNode.dataset.prevGl3dXMin);
    const prevXMax = Number(containerNode.dataset.prevGl3dXMax);
    const prevYMin = Number(containerNode.dataset.prevGl3dYMin);
    const prevYMax = Number(containerNode.dataset.prevGl3dYMax);
    const prevZMin = Number(containerNode.dataset.prevGl3dZMin);
    const prevZMax = Number(containerNode.dataset.prevGl3dZMax);
    const hasPrevDomain = [prevXMin, prevXMax, prevYMin, prevYMax, prevZMin, prevZMax].every(Number.isFinite);

    // Dispose previous instance
    if (_instances.has(containerSelector)) {
        _instances.get(containerSelector).dispose();
    }

    container.selectAll('*').remove();

    /* ---- sizing ---- */
    const rect = containerNode.getBoundingClientRect();
    const W = Math.max(400, rect.width || containerNode.clientWidth || 400);
    const H = Math.max(300, rect.height || containerNode.clientHeight || 300);

    /* ---- wrapper div ---- */
    const wrapper = container.append('div').attr('class', 'scatter3dgl-wrapper');

    /* ---- data points ---- */
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

    /* ---- scales: data → normalised 0…1 cube ---- */
    const ext = k => d3.extent(points, p => p[k]);
    const pad = e => (e[1] - e[0] || 1) * 0.05;
    const xExt = ext('xVal'), yExt = ext('yVal'), zExt = ext('zVal');
    const xScale = d3.scaleLinear().domain([xExt[0] - pad(xExt), xExt[1] + pad(xExt)]).range([0, 1]);
    const yScale = d3.scaleLinear().domain([yExt[0] - pad(yExt), yExt[1] + pad(yExt)]).range([0, 1]);
    const zScale = d3.scaleLinear().domain([zExt[0] - pad(zExt), zExt[1] + pad(zExt)]).range([0, 1]);

    // Normalised positions for each point
    points.forEach(p => { p.nx = xScale(p.xVal); p.ny = yScale(p.yVal); p.nz = zScale(p.zVal); });

    /* ---- start scales (old domains, for animated transitions) ---- */
    const shouldAnimate = animate && hasPrevDomain;
    const ANIM_DUR = 420; // ms – matches SVG 3D scatterplot
    const startXScale = shouldAnimate
        ? d3.scaleLinear().domain([prevXMin, prevXMax]).range([0, 1]) : xScale;
    const startYScale = shouldAnimate
        ? d3.scaleLinear().domain([prevYMin, prevYMax]).range([0, 1]) : yScale;
    const startZScale = shouldAnimate
        ? d3.scaleLinear().domain([prevZMin, prevZMax]).range([0, 1]) : zScale;

    // Compute start normalised positions for animation
    if (shouldAnimate) {
        points.forEach(p => {
            p.startNx = startXScale(p.xVal);
            p.startNy = startYScale(p.yVal);
            p.startNz = startZScale(p.zVal);
        });
    }

    /* ---- persist current domains for next render ---- */
    containerNode.dataset.prevGl3dXMin = String(xScale.domain()[0]);
    containerNode.dataset.prevGl3dXMax = String(xScale.domain()[1]);
    containerNode.dataset.prevGl3dYMin = String(yScale.domain()[0]);
    containerNode.dataset.prevGl3dYMax = String(yScale.domain()[1]);
    containerNode.dataset.prevGl3dZMin = String(zScale.domain()[0]);
    containerNode.dataset.prevGl3dZMax = String(zScale.domain()[1]);

    /* ================================================================ */
    /*  Three.js scene setup                                             */
    /* ================================================================ */
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0); // transparent background
    const canvas = renderer.domElement;
    canvas.classList.add('scatter3dgl-canvas');
    wrapper.node().appendChild(canvas);

    const scene = new THREE.Scene();

    // Camera — orbit around [0.5, 0.5, 0.5] (centre of unit cube)
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 100);
    const CENTER = new THREE.Vector3(0.5, 0.5, 0.5);
    let spherical = hasSavedCamera
        ? new THREE.Spherical(savedRadius, savedPhi, savedTheta)
        : new THREE.Spherical(2.8, Math.PI / 3, Math.PI / 4);
    function updateCamera() {
        camera.position.setFromSpherical(spherical).add(CENTER);
        camera.lookAt(CENTER);
        // Persist immediately so the next re-render restores the exact position
        containerNode.dataset.gl3dRadius = String(spherical.radius);
        containerNode.dataset.gl3dPhi    = String(spherical.phi);
        containerNode.dataset.gl3dTheta  = String(spherical.theta);
    }
    updateCamera();

    // Single ambient light (flat look, no directional shading)
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    /* ---- bounding box (wireframe cube 0…1) ---- */
    const boxGeom = new THREE.BoxGeometry(1, 1, 1);
    const boxEdges = new THREE.EdgesGeometry(boxGeom);
    const boxLine = new THREE.LineSegments(boxEdges, new THREE.LineDashedMaterial({
        color: 0xd1d5db, dashSize: 0.02, gapSize: 0.02,
    }));
    boxLine.computeLineDistances();
    boxLine.position.set(0.5, 0.5, 0.5);
    scene.add(boxLine);

    /* ---- axis spines ---- */
    const AXIS_CFG = [
        { color: 0xe74c3c, from: [0, 0, 0], to: [1, 0, 0], label: xKey, scale: xScale },
        { color: 0x27ae60, from: [0, 0, 0], to: [0, 1, 0], label: yKey, scale: yScale },
        { color: 0x3498db, from: [0, 0, 0], to: [0, 0, 1], label: zKey, scale: zScale },
    ];
    AXIS_CFG.forEach(a => {
        const mat = new THREE.LineBasicMaterial({ color: a.color, linewidth: 2 });
        const geom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(...a.from), new THREE.Vector3(...a.to),
        ]);
        scene.add(new THREE.Line(geom, mat));
    });

    /* ---- axis tick marks ---- */
    const TICK_COUNT = 3;
    const axisLabelSprites = [];
    const oldAxisLabelSprites = []; // for crossfade during animation

    // Build old axis labels (fade out) if animating
    if (shouldAnimate) {
        const OLD_AXIS_CFG = [
            { color: 0xe74c3c, from: [0, 0, 0], to: [1, 0, 0], label: xKey, scale: startXScale },
            { color: 0x27ae60, from: [0, 0, 0], to: [0, 1, 0], label: yKey, scale: startYScale },
            { color: 0x3498db, from: [0, 0, 0], to: [0, 0, 1], label: zKey, scale: startZScale },
        ];
        OLD_AXIS_CFG.forEach(a => {
            for (let i = 1; i <= TICK_COUNT; i++) {
                const t = i / TICK_COUNT;
                const pos = new THREE.Vector3(
                    a.from[0] + (a.to[0] - a.from[0]) * t,
                    a.from[1] + (a.to[1] - a.from[1]) * t,
                    a.from[2] + (a.to[2] - a.from[2]) * t,
                );
                const dataVal = a.scale.invert(t);
                const text = Math.abs(dataVal) >= 1000 ? dataVal.toFixed(0) : Math.abs(dataVal) >= 1 ? dataVal.toFixed(2) : dataVal.toFixed(3);
                const sprite = makeTextSprite(text, { color: a.color, fontSize: 12 });
                const off = new THREE.Vector3(
                    a.to[0] === 1 ? 0 : -0.06,
                    a.to[1] === 1 ? 0 : 0,
                    a.to[2] === 1 ? 0 : -0.06,
                );
                sprite.position.copy(pos).add(off);
                scene.add(sprite);
                oldAxisLabelSprites.push(sprite);
            }
        });
    }

    AXIS_CFG.forEach(a => {
        for (let i = 0; i <= TICK_COUNT; i++) {
            const t = i / TICK_COUNT;
            const pos = new THREE.Vector3(
                a.from[0] + (a.to[0] - a.from[0]) * t,
                a.from[1] + (a.to[1] - a.from[1]) * t,
                a.from[2] + (a.to[2] - a.from[2]) * t,
            );
            // Flat circle sprite for tick
            const tickSprite = makeCircleSprite(a.color, 0.025);
            tickSprite.position.copy(pos);
            scene.add(tickSprite);

            // Text sprite for tick value
            if (i > 0) {
                const dataVal = a.scale.invert(t);
                const text = Math.abs(dataVal) >= 1000 ? dataVal.toFixed(0) : Math.abs(dataVal) >= 1 ? dataVal.toFixed(2) : dataVal.toFixed(3);
                const sprite = makeTextSprite(text, { color: a.color, fontSize: 12 });
                // Offset label slightly away from axis
                const off = new THREE.Vector3(
                    a.to[0] === 1 ? 0 : -0.06,
                    a.to[1] === 1 ? 0 : 0,
                    a.to[2] === 1 ? 0 : -0.06,
                );
                sprite.position.copy(pos).add(off);
                // If animating, new labels start transparent and fade in
                if (shouldAnimate) sprite.material.opacity = 0;
                scene.add(sprite);
                axisLabelSprites.push(sprite);
            }
        }
        // Axis-name sprite at midpoint
        const mid = new THREE.Vector3(
            (a.from[0] + a.to[0]) / 2,
            (a.from[1] + a.to[1]) / 2,
            (a.from[2] + a.to[2]) / 2,
        );
        const off = new THREE.Vector3(
            a.to[0] === 1 ? 0 : -0.1,
            a.to[1] === 1 ? 0 : 0,
            a.to[2] === 1 ? 0 : -0.1,
        );
        const nameSprite = makeTextSprite(a.label, { color: a.color, fontSize: 12, bold: true });
        nameSprite.position.copy(mid).add(off);
        scene.add(nameSprite);
        axisLabelSprites.push(nameSprite);
    });

    /* ---- data point sprites (flat circles, always face camera) ---- */
    const POINT_SIZE = 0.035;
    const RING_SIZE = POINT_SIZE * 1.1;
    const pointMeshes = [];
    const ringMeshes = [];  // black-ring overlay sprites for shift-held selection
    const pointCircleTex = createCircleTexture(64, '#ffffff', 1.0);
    const ringTex = createRingTexture(64, '#1d1d1f', 8);
    points.forEach(p => {
        const mat = new THREE.SpriteMaterial({
            map: pointCircleTex, transparent: true, opacity: 1.0,
            depthTest: true, depthWrite: false,
            color: 0x34c759,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(POINT_SIZE, POINT_SIZE, 1);
        // Start at old position if animating, otherwise at final position
        const sx = shouldAnimate ? p.startNx : p.nx;
        const sy = shouldAnimate ? p.startNy : p.ny;
        const sz = shouldAnimate ? p.startNz : p.nz;
        sprite.position.set(sx, sy, sz);
        sprite.userData = p;
        scene.add(sprite);
        pointMeshes.push(sprite);

        // Ring overlay (hidden by default)
        const ringMat = new THREE.SpriteMaterial({
            map: ringTex, transparent: true, opacity: 0,
            depthTest: true, depthWrite: false,
        });
        const ring = new THREE.Sprite(ringMat);
        ring.scale.set(RING_SIZE, RING_SIZE, 2);
        ring.position.set(sx, sy, sz);
        scene.add(ring);
        ringMeshes.push(ring);
    });

    /* ---- Delaunay surface ---- */
    let surfaceMesh = null;
    if (showSurface && points.length >= 3) {
        surfaceMesh = buildSurfaceMesh(points);
        scene.add(surfaceMesh);
    }

    /* ---- dominated cloud (flat circles) ---- */
    let domMeshes = [];
    if (showDominated && points.length > 0) {
        const front = computeParetoFront(points);
        const cloud = generateDominatedCloud(front, xScale.domain(), yScale.domain(), zScale.domain());
        const domTex = createCircleTexture(32, '#ffffff', 1.0);
        cloud.forEach(c => {
            const mat = new THREE.SpriteMaterial({
                map: domTex, transparent: true, opacity: 0.35,
                depthTest: true, depthWrite: false,
                color: 0x8a9ab0,
            });
            const sprite = new THREE.Sprite(mat);
            sprite.scale.set(0.014, 0.014, 1);
            sprite.position.set(xScale(c.xVal), yScale(c.yVal), zScale(c.zVal));
            scene.add(sprite);
            domMeshes.push(sprite);
        });
    }

    /* ---- ideal point (flat circle sprite) ---- */
    let idealMesh = null, idealLabelSprite = null;
    if (showIdealPoint) {
        const ix = d3.max(points, p => p.xVal);
        const iy = d3.max(points, p => p.yVal);
        const iz = d3.max(points, p => p.zVal);
        if (Number.isFinite(ix) && Number.isFinite(iy) && Number.isFinite(iz)) {
            const idealTex = createCircleTexture(64, '#eab308', 1.0, '#ca8a04');
            const idealMat = new THREE.SpriteMaterial({
                map: idealTex, transparent: true, opacity: 1.0,
                depthTest: true, depthWrite: false,
            });
            idealMesh = new THREE.Sprite(idealMat);
            idealMesh.scale.set(0.05, 0.05, 1);
            idealMesh.position.set(xScale(ix), yScale(iy), zScale(iz));
            scene.add(idealMesh);

            idealLabelSprite = makeTextSprite('Ideal Point', { color: 0xca8a04, fontSize: 12, bold: true });
            idealLabelSprite.position.set(xScale(ix) + 0.04, yScale(iy) + 0.04, zScale(iz) + 0.04);
            scene.add(idealLabelSprite);
        }
    }

    /* ---- filter planes (Three.js version) ---- */
    const filterPlaneGroup = new THREE.Group();
    scene.add(filterPlaneGroup);

    function rebuildFilterPlanes() {
        while (filterPlaneGroup.children.length) {
            const c = filterPlaneGroup.children[0];
            filterPlaneGroup.remove(c);
            c.geometry?.dispose();
            c.material?.dispose();
        }
        const axisDefs = [
            { key: xKey, scale: xScale, color: 0xe74c3c, normal: [1, 0, 0] },
            { key: yKey, scale: yScale, color: 0x27ae60, normal: [0, 1, 0] },
            { key: zKey, scale: zScale, color: 0x3498db, normal: [0, 0, 1] },
        ];
        axisDefs.forEach(({ key, scale, color, normal }) => {
            const f = filterState.axisFilters[key];
            if (!f || filterState.hiddenFilters.has(key)) return;
            [f.min, f.max].forEach(dataVal => {
                const t = scale(dataVal);
                const planeGeom = new THREE.PlaneGeometry(1, 1);
                const planeMat = new THREE.MeshBasicMaterial({
                    color, transparent: true, opacity: 0.12, side: THREE.DoubleSide,
                });
                const mesh = new THREE.Mesh(planeGeom, planeMat);
                // Orient plane perpendicular to the axis
                if (normal[0] === 1) {
                    mesh.rotation.y = Math.PI / 2;
                    mesh.position.set(t, 0.5, 0.5);
                } else if (normal[1] === 1) {
                    mesh.rotation.x = Math.PI / 2;
                    mesh.position.set(0.5, t, 0.5);
                } else {
                    mesh.position.set(0.5, 0.5, t);
                }
                filterPlaneGroup.add(mesh);
            });
        });
    }

    // Tooltip
    const tooltip = d3.select('body').selectAll('.scatter-tooltip').data([null]).join('div').attr('class', 'scatter-tooltip');

    // Hint text (HTML div, no SVG)
    wrapper.append('div').attr('class', 'scatter3dgl-hint');
    wrapper.select('.scatter3dgl-hint').text('Drag to rotate · Shift+click to select · Double-click filter to remove');

    // Legend div (shown when showSurface is true)
    const legendDiv = wrapper.append('div').attr('class', 'scatter3dgl-legend');
    if (showSurface) {
        legendDiv.html(
            '<span class="scatter3dgl-legend-title">Distance to Ideal [1, 1, 1]</span>' +
            '<div class="scatter3dgl-legend-bar"></div>' +
            '<div class="scatter3dgl-legend-labels"><span>Near (Peak)</span><span>Far</span></div>'
        );
    }

    /* ---- project 3D → 2D screen coords helper (uses live canvas size) ---- */
    function toScreen(vec3) {
        const cW = canvas.clientWidth;
        const cH = canvas.clientHeight;
        const v = vec3.clone().project(camera);
        return { x: (v.x * 0.5 + 0.5) * cW, y: (-v.y * 0.5 + 0.5) * cH };
    }

    /* ================================================================ */
    /*  Brush filter on 3D axes (canvas-based, no SVG overlay lag)     */
    /* ================================================================ */
    const axisScaleMeta = [
        { key: xKey, scale: xScale, from: new THREE.Vector3(0,0,0), to: new THREE.Vector3(1,0,0), color: '#e74c3c', colorHex: 0xe74c3c },
        { key: yKey, scale: yScale, from: new THREE.Vector3(0,0,0), to: new THREE.Vector3(0,1,0), color: '#27ae60', colorHex: 0x27ae60 },
        { key: zKey, scale: zScale, from: new THREE.Vector3(0,0,0), to: new THREE.Vector3(0,0,1), color: '#3498db', colorHex: 0x3498db },
    ];

    // Three.js group for brush highlight segments on each axis
    const brushHighlightGroup = new THREE.Group();
    scene.add(brushHighlightGroup);

    function rebuildBrushHighlights() {
        while (brushHighlightGroup.children.length) {
            const c = brushHighlightGroup.children[0];
            brushHighlightGroup.remove(c);
            c.geometry?.dispose();
            c.material?.dispose();
        }
        axisScaleMeta.forEach(({ key, scale, from, to, colorHex }) => {
            const f = filterState.axisFilters[key];
            if (!f || filterState.hiddenFilters.has(key)) return;
            const tMin = scale(f.min), tMax = scale(f.max);
            const dir = to.clone().sub(from);
            const p0 = from.clone().add(dir.clone().multiplyScalar(tMin));
            const p1 = from.clone().add(dir.clone().multiplyScalar(tMax));
            // Thick colored line segment for the selected range
            const geom = new THREE.BufferGeometry().setFromPoints([p0, p1]);
            const mat = new THREE.LineBasicMaterial({ color: colorHex, linewidth: 3, transparent: true, opacity: 0.8 });
            brushHighlightGroup.add(new THREE.Line(geom, mat));
            // Small spheres at ends (handles)
            [p0, p1].forEach(pt => {
                const s = makeCircleSprite(colorHex, 0.025);
                s.position.copy(pt);
                brushHighlightGroup.add(s);
            });
        });
    }

    // Helper: project a 3D point to 2D screen pixel coords (as THREE.Vector2)
    function toScreenV2(v3) {
        const s = toScreen(v3);
        return new THREE.Vector2(s.x, s.y);
    }

    // Helper: find the closest axis spine to a 2D screen point and return the parametric t (0…1) along it
    const AXIS_HIT_DIST = 18; // pixels
    function hitTestAxis(screenX, screenY) {
        const sp = new THREE.Vector2(screenX, screenY);
        let best = null, bestDist = AXIS_HIT_DIST;
        axisScaleMeta.forEach(axis => {
            if (filterState.hiddenFilters.has(axis.key)) return;
            const a = toScreenV2(axis.from);
            const b = toScreenV2(axis.to);
            const ab = b.clone().sub(a);
            const abLen = ab.length();
            if (abLen < 10) return;
            const ap = sp.clone().sub(a);
            let t = ap.dot(ab) / (abLen * abLen);
            t = Math.max(0, Math.min(1, t));
            const closest = a.clone().add(ab.clone().multiplyScalar(t));
            const dist = sp.distanceTo(closest);
            if (dist < bestDist) {
                bestDist = dist;
                best = { axis, t };
            }
        });
        return best;
    }

    // Brush interaction state
    let brushDrag = null; // { axis, anchorT, startT, endT }

    function onBrushDown(e) {
        if (disableBrush || e.shiftKey || e.button !== 0) return;
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const hit = hitTestAxis(sx, sy);
        if (!hit) return;
        // Check for double-click to remove existing filter
        // (handled separately via dblclick event)
        e.preventDefault();
        e.stopPropagation();
        brushDrag = { axis: hit.axis, anchorT: hit.t, startT: hit.t, endT: hit.t };
        // Prevent orbit drag from starting
        isDragging = false;
    }

    function onBrushMove(e) {
        if (!brushDrag) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        // Project to the brushed axis
        const { axis, anchorT } = brushDrag;
        const a = toScreenV2(axis.from);
        const b = toScreenV2(axis.to);
        const ab = b.clone().sub(a);
        const abLen = ab.length();
        if (abLen < 1) return;
        const sp = new THREE.Vector2(sx, sy);
        const ap = sp.clone().sub(a);
        let t = ap.dot(ab) / (abLen * abLen);
        t = Math.max(0, Math.min(1, t));
        brushDrag.startT = Math.min(anchorT, t);
        brushDrag.endT = Math.max(anchorT, t);
        // Update filter
        const dMin = axis.scale.invert(brushDrag.startT);
        const dMax = axis.scale.invert(brushDrag.endT);
        filterState.axisFilters[axis.key] = { min: Math.min(dMin, dMax), max: Math.max(dMin, dMax) };
        updateFilteredPoints();
        rebuildFilterPlanes();
        rebuildBrushHighlights();
        renderFrame();
    }

    function onBrushUp(e) {
        if (!brushDrag) return;
        const range = brushDrag.endT - brushDrag.startT;
        if (range < 0.005) {
            // Too small — treat as a click, remove the filter
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
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const hit = hitTestAxis(sx, sy);
        if (!hit) return;
        const { axis } = hit;
        if (filterState.axisFilters[axis.key]) {
            e.preventDefault();
            e.stopPropagation();
            delete filterState.axisFilters[axis.key];
            filterState.hiddenFilters.delete(axis.key);
            updateFilteredPoints();
            rebuildFilterPlanes();
            rebuildBrushHighlights();
            renderFrame();
        }
    }

    canvas.addEventListener('pointerdown', onBrushDown, true); // capture phase, before orbit drag
    window.addEventListener('pointermove', onBrushMove);
    window.addEventListener('pointerup', onBrushUp);
    canvas.addEventListener('dblclick', onBrushDblClick);

    function updateFilteredPoints() {
        const active = Object.entries(filterState.axisFilters)
            .filter(([k]) => !filterState.hiddenFilters.has(k));
        const hasBrush = active.length > 0;

        const hasOnlyHidden = Object.keys(filterState.axisFilters).length > 0 && !hasBrush;
        if (!hasOnlyHidden) {
            const wasActive = filterState.hadActiveBrushFilters || false;
            filterState.hadActiveBrushFilters = hasBrush;

            if (hasBrush) {
                const passing = data
                    .filter(row => active.every(([axis, f]) => {
                        const v = Number(row[axis]);
                        return v >= f.min && v <= f.max;
                    }))
                    .map((row, i) => row.__rowIndex ?? i);
                onBrushFilterChange(passing);
            } else if (wasActive) {
                onBrushFilterChange(null);
            }
        }

        refreshPointVisuals();
    }

    /* ================================================================ */
    /*  Point label sprites (Three.js, always face camera)              */
    /* ================================================================ */
    const labelSprites = [];
    if (showLabels) {
        points.forEach(p => {
            const sprite = makeTextSprite(`op${p.rowIndex + 1}`, { color: 0x5f6673, fontSize: 8 });
            sprite.position.set(p.nx + 0.025, p.ny + 0.025, p.nz + 0.025);
            scene.add(sprite);
            labelSprites.push(sprite);
        });
    }

    /* ================================================================ */
    /*  Raycasting for hover & click                                    */
    /* ================================================================ */
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let hoveredMesh = null;

    function onPointerMove(event) {
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(pointMeshes);
        if (hits.length > 0) {
            const m = hits[0].object;
            if (hoveredMesh !== m) {
                hoveredMesh = m;
                const p = m.userData;
                onHoverStart(p.rowIndex);
                tooltip.classed('visible', true)
                    .html(`Point: ${p.rowIndex + 1}<br>${xKey}: ${Number(p.rawX).toFixed(3)}<br>${yKey}: ${Number(p.rawY).toFixed(3)}<br>${zKey}: ${Number(p.rawZ).toFixed(3)}`)
                    .style('left', `${event.pageX + 12}px`)
                    .style('top', `${event.pageY - 36}px`);
            } else {
                tooltip.style('left', `${event.pageX + 12}px`).style('top', `${event.pageY - 36}px`);
            }
            canvas.style.cursor = 'pointer';
        } else if (hoveredMesh) {
            hoveredMesh = null;
            onHoverEnd();
            tooltip.classed('visible', false);
            canvas.style.cursor = isDragging ? 'grabbing' : 'grab';
        }
    }

    function onPointerClick(event) {
        if (event.shiftKey) {
            const rect = canvas.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            const hits = raycaster.intersectObjects(pointMeshes);
            if (hits.length > 0) {
                event.stopPropagation();
                onShiftClick(hits[0].object.userData.rowIndex);
            }
        }
    }

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('click', onPointerClick);

    /* ================================================================ */
    /*  Orbit drag-to-rotate (on canvas, not SVG)                       */
    /* ================================================================ */
    let isDragging = false;
    let lastX = 0, lastY = 0;

    function onDown(e) {
        if (e.button !== 0) return;
        // Don't start rotation drag when shift is held (shift+click is for selection)
        if (e.shiftKey) return;
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.style.cursor = 'grabbing';
    }
    function onMove(e) {
        if (!isDragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        spherical.theta -= dx * 0.005;
        spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi + dy * 0.005));
        lastX = e.clientX;
        lastY = e.clientY;
        updateCamera();
        renderFrame();
    }
    function onUp() {
        isDragging = false;
        canvas.style.cursor = 'grab';
    }

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    // Scroll to zoom
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        spherical.radius = Math.max(1, Math.min(8, spherical.radius + e.deltaY * 0.002));
        updateCamera();
        renderFrame();
    }, { passive: false });

    // Resize observer — keep renderer and camera in sync with container
    const resizeObserver = new ResizeObserver(() => {
        const r = containerNode.getBoundingClientRect();
        const nW = Math.max(400, r.width || 400);
        const nH = Math.max(300, r.height || 300);
        renderer.setSize(nW, nH);
        camera.aspect = nW / nH;
        camera.updateProjectionMatrix();
        renderFrame();
    });
    resizeObserver.observe(containerNode);

    /* ================================================================ */
    /*  Highlight & selection helpers (called by pub-sub)               */
    /* ================================================================ */

    // Track hover and selection as plain state — visual updates go through
    // refreshPointVisuals() which composites all states at once, mirroring
    // the way the SVG version composes CSS classes.
    let _hoveredRowIndex = null;
    let _lastSelectionSet = null;

    /**
     * Single source of truth for point visuals.  Reads hover, selection and
     * brush-filter state simultaneously and computes the final appearance for
     * every point, so the three states never clobber each other.
     */
    function refreshPointVisuals() {
        const hovered   = _hoveredRowIndex;
        const selected  = _lastSelectionSet;
        const active    = Object.entries(filterState.axisFilters)
            .filter(([k]) => !filterState.hiddenFilters.has(k));
        const hasBrush      = active.length > 0;
        const hasSelection  = selected !== null && selected.size > 0;
        const hasHover      = hovered !== null;
        const shiftHeld     = document.body.classList.contains('shift-held');

        pointMeshes.forEach((m, i) => {
            const p    = m.userData;
            const row  = data[p.rowIndex];
            const ring = ringMeshes[i];
            const lbl  = labelSprites[i] || null;

            /* -- brush filter: wins over everything (like !important in SVG CSS) -- */
            const isBrushFiltered = hasBrush && row && active.some(([axis, f]) => {
                const val = Number(row[axis]);
                return val < f.min || val > f.max;
            });

            if (isBrushFiltered) {
                m.scale.set(POINT_SIZE, POINT_SIZE, 1);
                m.material.color.set(0xaaaaaa);
                m.material.opacity = 0.15;
                ring.scale.set(RING_SIZE, RING_SIZE, ring.scale.z);
                ring.material.opacity = 0;
                if (lbl) lbl.material.opacity = 0.15;
                return;
            }

            /* -- base colour -- */
            m.material.color.set(0x34c759);

            /* -- hover: controls scale and contributes to opacity -- */
            const isHoverTarget = hasHover && p.rowIndex === hovered;
            const isHoverDim    = hasHover && !isHoverTarget;
            const pointScale = isHoverTarget ? POINT_SIZE * 1.8
                             : isHoverDim    ? POINT_SIZE * 0.7
                             : POINT_SIZE;
            m.scale.set(pointScale, pointScale, 1);
            ring.scale.set(pointScale / POINT_SIZE * RING_SIZE, pointScale / POINT_SIZE * RING_SIZE, ring.scale.z);

            /* -- selection + hover compose together for opacity -- */
            const isSelected     = hasSelection && selected.has(p.rowIndex);
            const isSelectionDim = hasSelection && !isSelected;

            let opacity     = 1;
            let labelOpacity = 1;
            let ringOpacity  = 0;

            if (hasSelection && !hasBrush) {
                if (shiftHeld) {
                    // Shift mode: show ring on selected, full opacity for all
                    ringOpacity  = isSelected ? 1 : 0;
                    opacity      = 1;
                    labelOpacity = 1;
                } else {
                    // Normal selection: dim non-selected
                    opacity      = isSelectionDim ? 0.15 : 1;
                    labelOpacity = isSelectionDim ? 0.15 : 1;
                }
            }

            // Hover dim takes the minimum with whatever selection has set
            if (isHoverDim) {
                opacity      = Math.min(opacity, 0.35);
                labelOpacity = Math.min(labelOpacity, 0.15);
            }

            m.material.opacity = opacity;
            ring.material.opacity = ringOpacity;
            if (lbl) lbl.material.opacity = labelOpacity;
        });

        renderFrame();
    }

    function applyHighlight(rowIndex) {
        _hoveredRowIndex = rowIndex;
        refreshPointVisuals();
    }

    function setSelection(rowIndexSet) {
        _lastSelectionSet = rowIndexSet;
        refreshPointVisuals();
    }

    // Re-apply visuals when shift key state changes
    function onShiftChange() {
        refreshPointVisuals();
    }
    const shiftObserver = new MutationObserver(onShiftChange);
    shiftObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    /* ================================================================ */
    /*  Render loop (on demand, not continuous)                         */
    /* ================================================================ */
    function renderFrame() {
        renderer.render(scene, camera);
    }

    // Initial draws
    rebuildFilterPlanes();
    rebuildBrushHighlights();
    // Seed state so refreshPointVisuals() composites correctly on first paint
    _hoveredRowIndex  = getActiveRowIndex();
    _lastSelectionSet = getEffectiveSelection();
    updateFilteredPoints();  // handles callback + calls refreshPointVisuals()
    renderFrame();

    /* ---- animate transition if needed ---- */
    if (shouldAnimate) {
        const t0 = performance.now();
        let animId = 0;
        function animStep(now) {
            const elapsed = now - t0;
            const progress = Math.min(elapsed / ANIM_DUR, 1);
            // Ease-out cubic
            const t = 1 - Math.pow(1 - progress, 3);

            // Lerp point positions
            points.forEach((p, i) => {
                const x = p.startNx + (p.nx - p.startNx) * t;
                const y = p.startNy + (p.ny - p.startNy) * t;
                const z = p.startNz + (p.nz - p.startNz) * t;
                pointMeshes[i].position.set(x, y, z);
                ringMeshes[i].position.set(x, y, z);
                if (labelSprites[i]) labelSprites[i].position.set(x + 0.025, y + 0.025, z + 0.025);
            });

            // Crossfade axis labels: old fade out, new fade in
            oldAxisLabelSprites.forEach(s => { s.material.opacity = 1 - t; });
            axisLabelSprites.forEach(s => { s.material.opacity = t; });

            renderFrame();
            if (progress < 1) {
                animId = requestAnimationFrame(animStep);
            } else {
                // Cleanup old label sprites
                oldAxisLabelSprites.forEach(s => {
                    scene.remove(s);
                    s.material.map?.dispose();
                    s.material.dispose();
                });
            }
        }
        animId = requestAnimationFrame(animStep);
    }

    /* ---- register instance ---- */
    const dispose = () => {
        // Persist camera state before disposal
        containerNode.dataset.gl3dRadius = String(spherical.radius);
        containerNode.dataset.gl3dPhi    = String(spherical.phi);
        containerNode.dataset.gl3dTheta  = String(spherical.theta);
        shiftObserver.disconnect();
        resizeObserver.disconnect();
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('click', onPointerClick);
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointerdown', onBrushDown, true);
        canvas.removeEventListener('dblclick', onBrushDblClick);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointermove', onBrushMove);
        window.removeEventListener('pointerup', onBrushUp);
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

    function refreshVisuals() {
        updateFilteredPoints();  // handles onBrushFilterChange callback
        // refreshPointVisuals() is already called at the end of updateFilteredPoints
    }

    _instances.set(containerSelector, { setSelection, applyHighlight, dispose, refreshVisuals });
}

/* ================================================================== */
/*  Circle texture / sprite helpers (flat 2D circles in 3D space)      */
/* ================================================================== */
const _circleTexCache = new Map();

function createCircleTexture(size = 64, fillColor = '#ffffff', alpha = 1.0, strokeColor = null) {
    const key = `${size}_${fillColor}_${alpha}_${strokeColor}`;
    if (_circleTexCache.has(key)) return _circleTexCache.get(key);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    // Clear to fully transparent so there is no black background
    ctx.clearRect(0, 0, size, size);
    const r = size / 2;
    ctx.beginPath();
    ctx.arc(r, r, r - 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fillColor;
    ctx.fill();
    if (strokeColor) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = strokeColor;
        ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.premultiplyAlpha = false;
    _circleTexCache.set(key, tex);
    return tex;
}

function makeCircleSprite(color, size = 0.02) {
    const tex = createCircleTexture(32, '#ffffff', 1.0);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, color });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(size, size, 1);
    return sprite;
}

/* ================================================================== */
/*  Ring (outline-only circle) texture for selected-point indicator     */
/* ================================================================== */
const _ringTexCache = new Map();

function createRingTexture(size = 64, strokeColor = '#1d1d1f', lineWidth = 2.5) {
    const key = `ring_${size}_${strokeColor}_${lineWidth}`;
    if (_ringTexCache.has(key)) return _ringTexCache.get(key);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    const r = size / 2;
    ctx.beginPath();
    ctx.arc(r, r, r - lineWidth - 1, 0, Math.PI * 2);
    ctx.closePath();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeColor;
    ctx.stroke();
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.premultiplyAlpha = false;
    _ringTexCache.set(key, tex);
    return tex;
}

/* ================================================================== */
/*  Text sprite helper (creates a canvas-textured sprite)              */
/* ================================================================== */
function makeTextSprite(text, { color = 0x000000, fontSize = 28, bold = false } = {}) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = `${bold ? 'bold ' : ''}${fontSize}px sans-serif`;
    ctx.font = font;
    const metrics = ctx.measureText(text);
    const w = Math.ceil(metrics.width) + 8;
    const h = fontSize + 8;
    canvas.width = w;
    canvas.height = h;
    ctx.font = font;
    // White outline for readability
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeText(text, 4, fontSize);
    // Actual text colour
    const c = new THREE.Color(color);
    ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
    ctx.fillText(text, 4, fontSize);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(w / 350, h / 350, 1);
    return sprite;
}

/* ================================================================== */
/*  Axis-select populator (same signature as SVG version)              */
/* ================================================================== */
export function populateAxisSelect3dGL(select, columns) {
    select.selectAll('*').remove();
    select.selectAll('option')
        .data(columns)
        .enter()
        .append('option')
        .attr('value', c => c)
        .text(c => c);
}
