/**
 * orbitControls.js
 *
 * Pointer-based orbit (drag-to-rotate) and resize handling for the 3D GL
 * scatterplot canvas.
 *
 * Orbit model:
 *   • Left-button drag on the canvas rotates the camera around the scene
 *     centre (0.5, 0.5, 0.5) using spherical coordinates (theta/phi).
 *   • Shift+drag is not captured (shift is reserved for point selection).
 *   • The brushFilter module registers in capture phase so brush drags on
 *     axis spines take priority and the orbit ignores those frames.
 *
 * Raycasting for hover & click:
 *   • pointermove → raycast against pointMeshes, fire onHoverStart /
 *     onHoverEnd and update the floating tooltip.
 *   • click with shiftKey → raycast and fire onShiftClick for multi-select.
 *
 * ResizeObserver:
 *   • Watches the container node and keeps the renderer and camera projection
 *     in sync whenever the panel changes size.
 *
 * Exports:
 *   buildOrbitControls(ctx) – wires up all listeners; returns { teardown }
 */

import * as THREE from 'three';
import * as d3 from 'd3';

/**
 * @param {object} ctx
 * @param {HTMLCanvasElement}  ctx.canvas
 * @param {THREE.Camera}       ctx.camera
 * @param {THREE.Spherical}    ctx.spherical
 * @param {Function}           ctx.updateCamera     – persists spherical → camera
 * @param {THREE.WebGLRenderer} ctx.renderer
 * @param {Element}            ctx.containerNode
 * @param {Array<THREE.Sprite>} ctx.pointMeshes
 * @param {string}             ctx.xKey
 * @param {string}             ctx.yKey
 * @param {string}             ctx.zKey
 * @param {Function}           ctx.renderFrame
 * @param {Function}           ctx.onHoverStart
 * @param {Function}           ctx.onHoverEnd
 * @param {Function}           ctx.onShiftClick
 */
export function buildOrbitControls(ctx) {
    const {
        canvas, camera, spherical, updateCamera, renderer, containerNode,
        pointMeshes, xKey, yKey, zKey,
        renderFrame, onHoverStart, onHoverEnd, onShiftClick,
    } = ctx;

    const tooltip = d3.select('body')
        .selectAll('.scatter-tooltip')
        .data([null])
        .join('div')
        .attr('class', 'scatter-tooltip');

    /* ---- raycasting ---- */
    const raycaster = new THREE.Raycaster();
    const mouse     = new THREE.Vector2();
    let hoveredMesh = null;

    function onPointerMove(event) {
        const rect = canvas.getBoundingClientRect();
        mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
        mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
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
                    .style('top',  `${event.pageY - 36}px`);
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
        if (!event.shiftKey) return;
        const rect = canvas.getBoundingClientRect();
        mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
        mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(pointMeshes);
        if (hits.length > 0) {
            event.stopPropagation();
            onShiftClick(hits[0].object.userData.rowIndex);
        }
    }

    /* ---- orbit drag ---- */
    let isDragging = false, lastX = 0, lastY = 0;

    function onDown(e) {
        if (e.button !== 0 || e.shiftKey) return;
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.style.cursor = 'grabbing';
    }
    function onMove(e) {
        if (!isDragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        spherical.theta -= dx * 0.005;
        spherical.phi    = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi + dy * 0.005));
        lastX = e.clientX;
        lastY = e.clientY;
        updateCamera();
        renderFrame();
    }
    function onUp() {
        isDragging = false;
        canvas.style.cursor = 'grab';
    }

    /* ---- resize handler ---- */
    const resizeObserver = new ResizeObserver(() => {
        const r  = containerNode.getBoundingClientRect();
        const nW = Math.max(400, r.width  || 400);
        const nH = Math.max(300, r.height || 300);
        renderer.setSize(nW, nH);
        camera.aspect = nW / nH;
        camera.updateProjectionMatrix();
        renderFrame();
    });
    resizeObserver.observe(containerNode);

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('click',       onPointerClick);
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);

    function teardown() {
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('click',       onPointerClick);
        canvas.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup',   onUp);
        resizeObserver.disconnect();
    }

    return { teardown };
}
