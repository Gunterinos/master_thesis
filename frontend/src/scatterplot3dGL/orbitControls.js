// Orbit drag-to-rotate, hover/click raycasting and resize handling for the
// 3D GL scatterplot canvas. Shift+drag is reserved for selection.

import * as THREE from 'three';
import * as d3 from 'd3';

// Wires up orbit rotation, hover raycasting, shift-click selection and resize observer; returns { teardown }.
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
                    .html(`${p.isBenchmark ? 'Benchmark' : `Point: ${p.rowIndex}`}<br>${xKey}: ${Number(p.rawX).toFixed(3)}<br>${yKey}: ${Number(p.rawY).toFixed(3)}<br>${zKey}: ${Number(p.rawZ).toFixed(3)}`)
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
