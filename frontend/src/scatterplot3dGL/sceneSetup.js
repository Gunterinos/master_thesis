/**
 * sceneSetup.js
 *
 * Initialises the Three.js scene, WebGL renderer, perspective camera and all
 * static scene objects for the 3D GL scatterplot:
 *
 *   • WebGLRenderer + canvas element (transparent background)
 *   • PerspectiveCamera with spherical-coordinate orbit state
 *   • Dashed bounding-box wireframe cube (unit 0…1 space)
 *   • Axis spine lines (X red, Y green, Z blue)
 *   • Axis tick marks (circle sprites + text labels)
 *   • Optional old-axis label sprites for cross-fade transitions
 *   • Ambient light for flat (no directional shading) appearance
 *
 * Returns an object with references to the live scene objects, the
 * updateCamera() helper, and the lists of axis label sprites used by the
 * animation system.
 */

import * as THREE from 'three';
import { makeTextSprite, makeCircleSprite } from './textureHelpers.js';

const TICK_COUNT = 3;

/**
 * @param {Element}  containerNode
 * @param {number}   W  canvas width
 * @param {number}   H  canvas height
 * @param {string}   xKey
 * @param {string}   yKey
 * @param {string}   zKey
 * @param {d3.ScaleLinear} xScale
 * @param {d3.ScaleLinear} yScale
 * @param {d3.ScaleLinear} zScale
 * @param {{ startXScale, startYScale, startZScale, shouldAnimate }} animOpts
 */
export function buildScene(containerNode, W, H, xKey, yKey, zKey, xScale, yScale, zScale, animOpts) {
    const { startXScale, startYScale, startZScale, shouldAnimate } = animOpts;

    /* ---- renderer ---- */
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.classList.add('scatter3dgl-canvas');

    /* ---- scene ---- */
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    /* ---- camera ---- */
    const savedRadius = Number(containerNode.dataset.gl3dRadius);
    const savedPhi    = Number(containerNode.dataset.gl3dPhi);
    const savedTheta  = Number(containerNode.dataset.gl3dTheta);
    const hasSavedCamera = [savedRadius, savedPhi, savedTheta].every(Number.isFinite);

    const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 100);
    const CENTER = new THREE.Vector3(0.5, 0.5, 0.5);
    let spherical = hasSavedCamera
        ? new THREE.Spherical(savedRadius, savedPhi, savedTheta)
        : new THREE.Spherical(2.2, Math.PI / 3, Math.PI / 4);

    function updateCamera() {
        camera.position.setFromSpherical(spherical).add(CENTER);
        camera.lookAt(CENTER);
        containerNode.dataset.gl3dRadius = String(spherical.radius);
        containerNode.dataset.gl3dPhi    = String(spherical.phi);
        containerNode.dataset.gl3dTheta  = String(spherical.theta);
    }
    updateCamera();

    /* ---- bounding box ---- */
    const boxGeom = new THREE.BoxGeometry(1, 1, 1);
    const boxEdges = new THREE.EdgesGeometry(boxGeom);
    const boxLine = new THREE.LineSegments(boxEdges, new THREE.LineDashedMaterial({
        color: 0xd1d5db, dashSize: 0.02, gapSize: 0.02,
    }));
    boxLine.computeLineDistances();
    boxLine.position.set(0.5, 0.5, 0.5);
    scene.add(boxLine);

    /* ---- axis definitions ---- */
    const AXIS_CFG = [
        { color: 0xe74c3c, from: [0,0,0], to: [1,0,0], label: xKey, scale: xScale },
        { color: 0x27ae60, from: [0,0,0], to: [0,1,0], label: yKey, scale: yScale },
        { color: 0x3498db, from: [0,0,0], to: [0,0,1], label: zKey, scale: zScale },
    ];

    AXIS_CFG.forEach(a => {
        const mat  = new THREE.LineBasicMaterial({ color: a.color, linewidth: 2 });
        const geom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(...a.from), new THREE.Vector3(...a.to),
        ]);
        scene.add(new THREE.Line(geom, mat));
    });

    /* ---- old axis labels (fade out during animated transitions) ---- */
    const oldAxisLabelSprites = [];
    if (shouldAnimate) {
        const OLD_CFG = [
            { color: 0xe74c3c, from: [0,0,0], to: [1,0,0], label: xKey, scale: startXScale },
            { color: 0x27ae60, from: [0,0,0], to: [0,1,0], label: yKey, scale: startYScale },
            { color: 0x3498db, from: [0,0,0], to: [0,0,1], label: zKey, scale: startZScale },
        ];
        OLD_CFG.forEach(a => {
            for (let i = 1; i <= TICK_COUNT; i++) {
                const t    = i / TICK_COUNT;
                const pos  = new THREE.Vector3(
                    a.from[0] + (a.to[0] - a.from[0]) * t,
                    a.from[1] + (a.to[1] - a.from[1]) * t,
                    a.from[2] + (a.to[2] - a.from[2]) * t,
                );
                const dataVal = a.scale.invert(t);
                const text    = Math.abs(dataVal) >= 1000 ? dataVal.toFixed(0) : Math.abs(dataVal) >= 1 ? dataVal.toFixed(2) : dataVal.toFixed(3);
                const sprite  = makeTextSprite(text, { color: a.color, fontSize: 18 });
                const off     = new THREE.Vector3(a.to[0] === 1 ? 0 : -0.06, a.to[1] === 1 ? 0 : 0, a.to[2] === 1 ? 0 : -0.06);
                sprite.position.copy(pos).add(off);
                scene.add(sprite);
                oldAxisLabelSprites.push(sprite);
            }
        });
    }

    /* ---- new axis tick marks and labels ---- */
    const axisLabelSprites = [];
    AXIS_CFG.forEach(a => {
        for (let i = 0; i <= TICK_COUNT; i++) {
            const t   = i / TICK_COUNT;
            const pos = new THREE.Vector3(
                a.from[0] + (a.to[0] - a.from[0]) * t,
                a.from[1] + (a.to[1] - a.from[1]) * t,
                a.from[2] + (a.to[2] - a.from[2]) * t,
            );
            const tickSprite = makeCircleSprite(a.color, 0.025);
            tickSprite.position.copy(pos);
            scene.add(tickSprite);

            if (i > 0) {
                const dataVal = a.scale.invert(t);
                const text    = Math.abs(dataVal) >= 1000 ? dataVal.toFixed(0) : Math.abs(dataVal) >= 1 ? dataVal.toFixed(2) : dataVal.toFixed(3);
                const sprite  = makeTextSprite(text, { color: a.color, fontSize: 20 });
                const off     = new THREE.Vector3(a.to[0] === 1 ? 0 : -0.06, a.to[1] === 1 ? 0 : 0, a.to[2] === 1 ? 0 : -0.06);
                sprite.position.copy(pos).add(off);
                if (shouldAnimate) sprite.material.opacity = 0;
                scene.add(sprite);
                axisLabelSprites.push(sprite);
            }
        }
        // Axis name at midpoint
        const mid = new THREE.Vector3(
            (a.from[0] + a.to[0]) / 2,
            (a.from[1] + a.to[1]) / 2,
            (a.from[2] + a.to[2]) / 2,
        );
        const off = new THREE.Vector3(a.to[0] === 1 ? 0 : -0.1, a.to[1] === 1 ? 0 : 0, a.to[2] === 1 ? 0 : -0.1);
        const nameSprite = makeTextSprite(a.label, { color: a.color, fontSize: 18, bold: true });
        nameSprite.position.copy(mid).add(off);
        scene.add(nameSprite);
        axisLabelSprites.push(nameSprite);
    });

    return { renderer, canvas, scene, camera, CENTER, spherical, updateCamera, axisLabelSprites, oldAxisLabelSprites };
}
