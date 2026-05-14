import { POINT_COLOR_BENCHMARK, POINT_COLOR_REGULAR } from '../colors.js';

// Builds the point-visual compositing system; returns { applyHighlight, setSelection, refreshPointVisuals, teardown }.
export function buildPointVisuals(ctx) {
    const { pointMeshes, ringMeshes, labelSprites,
            POINT_SIZE, RING_SIZE, renderFrame } = ctx;

    let _hoveredRowIndex  = null;
    let _lastSelectionSet = null;

    function refreshPointVisuals() {
        const hovered      = _hoveredRowIndex;
        const selected     = _lastSelectionSet;
        const hasSelection = selected !== null;
        const hasHover     = hovered !== null;
        const shiftHeld    = document.body.classList.contains('shift-held');

        pointMeshes.forEach((m, i) => {
            const p    = m.userData;
            const ring = ringMeshes[i];
            const lbl  = labelSprites[i] || null;

            m.material.color.set(p.activeColor ?? (p.isBenchmark ? POINT_COLOR_BENCHMARK : POINT_COLOR_REGULAR));

            const BASE      = p.baseSize     ?? POINT_SIZE;
            const BASE_RING = p.baseRingSize ?? RING_SIZE;
            const isHoverTarget = hasHover && p.rowIndex === hovered;
            const isHoverDim    = hasHover && !isHoverTarget;
            const pointScale    = isHoverTarget ? BASE * 1.8
                                : isHoverDim    ? BASE * 0.7
                                : BASE;
            m.scale.set(pointScale, pointScale, 1);
            ring.scale.set(pointScale / BASE * BASE_RING, pointScale / BASE * BASE_RING, ring.scale.z);

            const isSelected     = hasSelection && selected.has(p.rowIndex);
            const isSelectionDim = hasSelection && !isSelected;
            let opacity = 1, labelOpacity = 1, ringOpacity = 0;

            if (hasSelection) {
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

    const shiftObserver = new MutationObserver(() => refreshPointVisuals());
    shiftObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    function teardown() {
        shiftObserver.disconnect();
    }

    return { applyHighlight, setSelection, refreshPointVisuals, teardown };
}
