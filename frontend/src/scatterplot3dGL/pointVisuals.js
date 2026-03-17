/**
 * pointVisuals.js
 *
 * Manages the visual appearance of data-point sprites in the 3D GL
 * scatterplot.  Provides a single compositing function (refreshPointVisuals)
 * that reads all three independent state streams simultaneously — hover,
 * selection, and brush filter — and writes the final colour/opacity/scale to
 * each sprite.  This mirrors the CSS class-composition approach used by the
 * SVG scatterplot and ensures the three states never clobber each other.
 *
 * State priority (highest → lowest):
 *   1. Brush filter      – grey-out and nearly-transparent, overrides all
 *   2. Hover             – scale up the hovered point, dim others
 *   3. Selection         – dim non-selected; in shift-mode show ring overlay
 *
 * Exports:
 *   buildPointVisuals(ctx) – returns { applyHighlight, setSelection,
 *                             refreshPointVisuals, teardown }
 *
 * ctx shape:
 *   { pointMeshes, ringMeshes, labelSprites, filterState,
 *     xKey, yKey, zKey, POINT_SIZE, RING_SIZE, renderFrame }
 */

/**
 * @param {object} ctx
 * @param {THREE.Sprite[]} ctx.pointMeshes
 * @param {THREE.Sprite[]} ctx.ringMeshes
 * @param {THREE.Sprite[]} ctx.labelSprites
 * @param {object}         ctx.filterState    – from filterState.js
 * @param {string}         ctx.xKey
 * @param {string}         ctx.yKey
 * @param {string}         ctx.zKey
 * @param {number}         ctx.POINT_SIZE
 * @param {number}         ctx.RING_SIZE
 * @param {Function}       ctx.renderFrame
 */
export function buildPointVisuals(ctx) {
    const { pointMeshes, ringMeshes, labelSprites, filterState,
            xKey, yKey, zKey, POINT_SIZE, RING_SIZE, renderFrame } = ctx;

    let _hoveredRowIndex  = null;
    let _lastSelectionSet = null;

    function refreshPointVisuals() {
        const hovered   = _hoveredRowIndex;
        const selected  = _lastSelectionSet;
        const active    = Object.entries(filterState.axisFilters)
            .filter(([k]) => !filterState.hiddenFilters.has(k));
        const hasBrush     = active.length > 0;
        const hasSelection = selected !== null && selected.size > 0;
        const hasHover     = hovered !== null;
        const shiftHeld    = document.body.classList.contains('shift-held');

        pointMeshes.forEach((m, i) => {
            const p    = m.userData;
            const ring = ringMeshes[i];
            const lbl  = labelSprites[i] || null;

            /* brush filter wins over everything */
            const isBrushFiltered = hasBrush && active.some(([axis, f]) => {
                const val = axis === xKey ? p.xVal : axis === yKey ? p.yVal : p.zVal;
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

            /* base colour */
            m.material.color.set(0x34c759);

            /* hover: scale and opacity contribution */
            const isHoverTarget = hasHover && p.rowIndex === hovered;
            const isHoverDim    = hasHover && !isHoverTarget;
            const pointScale    = isHoverTarget ? POINT_SIZE * 1.8
                                : isHoverDim    ? POINT_SIZE * 0.7
                                : POINT_SIZE;
            m.scale.set(pointScale, pointScale, 1);
            ring.scale.set(pointScale / POINT_SIZE * RING_SIZE, pointScale / POINT_SIZE * RING_SIZE, ring.scale.z);

            /* selection + hover compose for final opacity */
            const isSelected     = hasSelection && selected.has(p.rowIndex);
            const isSelectionDim = hasSelection && !isSelected;
            let opacity = 1, labelOpacity = 1, ringOpacity = 0;

            if (hasSelection && !hasBrush) {
                if (shiftHeld) {
                    ringOpacity = isSelected ? 1 : 0;
                } else {
                    opacity      = isSelectionDim ? 0.15 : 1;
                    labelOpacity = isSelectionDim ? 0.15 : 1;
                }
            }

            if (isHoverDim) {
                opacity      = Math.min(opacity, 0.35);
                labelOpacity = Math.min(labelOpacity, 0.15);
            }

            m.material.opacity      = opacity;
            ring.material.opacity   = ringOpacity;
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

    /* Re-composite when shift key state changes (body class mutation) */
    const shiftObserver = new MutationObserver(() => refreshPointVisuals());
    shiftObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    function teardown() {
        shiftObserver.disconnect();
    }

    return { applyHighlight, setSelection, refreshPointVisuals, teardown };
}
