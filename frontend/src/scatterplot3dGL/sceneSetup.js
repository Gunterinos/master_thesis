// Initialises the Three.js scene: renderer, camera, bounding box, axis spines,
// tick marks, labels and ambient light for the 3D GL scatterplot.

import * as THREE from 'three';
import { makeTextSprite, makeCircleSprite } from './textureHelpers.js';

// tick count per axis
const TICK_COUNT = 4;

// Creates the full Three.js scene with renderer, camera, axes and tick labels, returning all live references.
export function buildScene(containerNode, W, H, xKey, yKey, zKey, xScale, yScale, zScale, animOpts) {
    const { startXScale, startYScale, startZScale, shouldAnimate } = animOpts;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor('#000000', 0);
    const canvas = renderer.domElement;
    canvas.classList.add('scatter3dgl-canvas');

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight('#ffffff', 1.0));

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

    const boxGeom = new THREE.BoxGeometry(1, 1, 1);
    const boxEdges = new THREE.EdgesGeometry(boxGeom);
    const boxLine = new THREE.LineSegments(boxEdges, new THREE.LineDashedMaterial({
        color: '#d1d5db', dashSize: 0.02, gapSize: 0.02,
    }));
    boxLine.computeLineDistances();
    boxLine.position.set(0.5, 0.5, 0.5);
    scene.add(boxLine);

    const AXIS_CFG = [
        { color: '#1d1d1f', from: [0,0,0], to: [1,0,0], label: xKey, scale: xScale },
        { color: '#1d1d1f', from: [0,0,0], to: [0,1,0], label: yKey, scale: yScale },
        { color: '#1d1d1f', from: [0,0,0], to: [0,0,1], label: zKey, scale: zScale },
    ];

    AXIS_CFG.forEach(a => {
        const mat  = new THREE.LineBasicMaterial({ color: a.color, linewidth: 2 });
        const geom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(...a.from), new THREE.Vector3(...a.to),
        ]);
        scene.add(new THREE.Line(geom, mat));
    });

    const oldAxisLabelSprites = [];
    if (shouldAnimate) {
        const OLD_CFG = [
            { color: '#1d1d1f', from: [0,0,0], to: [1,0,0], label: xKey, scale: startXScale },
            { color: '#1d1d1f', from: [0,0,0], to: [0,1,0], label: yKey, scale: startYScale },
            { color: '#1d1d1f', from: [0,0,0], to: [0,0,1], label: zKey, scale: startZScale },
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
        const mid = new THREE.Vector3(
            (a.from[0] + a.to[0]) / 2,
            (a.from[1] + a.to[1]) / 2,
            (a.from[2] + a.to[2]) / 2,
        );
        const off = new THREE.Vector3(a.to[0] === 1 ? 0 : -0.2, a.to[1] === 1 ? 0 : 0, a.to[2] === 1 ? 0 : -0.2);
        const nameSprite = makeTextSprite(a.label, { color: a.color, fontSize: 18, bold: true });
        nameSprite.position.copy(mid).add(off);
        scene.add(nameSprite);
        axisLabelSprites.push(nameSprite);
    });

    return { renderer, canvas, scene, camera, CENTER, spherical, updateCamera, axisLabelSprites, oldAxisLabelSprites };
}
