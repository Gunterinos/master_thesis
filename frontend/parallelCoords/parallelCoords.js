const _pcpState = new Map();
const _pcpSetSelectionFns = new Map();
const _pcpLastSelection = new Map();

function setParallelCoordsSelection(rowIndexSet) {
    _pcpLastSelection.forEach((_, key) => _pcpLastSelection.set(key, rowIndexSet));
    _pcpSetSelectionFns.forEach((fn) => fn(rowIndexSet));
}

function renderParallelCoords(containerSelector, allColumns, data, options = {}) {
    const {
        onHoverStart = () => {},
        onHoverEnd = () => {},
        onShiftClick = () => {},
        animate = false,
    } = options;

    const container = d3.select(containerSelector);
    const containerNode = container.node();
    if (!containerNode) return;

    // ── Persistent state ────────────────────────────────────────
    if (!_pcpState.has(containerSelector)) {
        _pcpState.set(containerSelector, {
            axisOrder: [...allColumns],
            enabledAxes: new Set(allColumns),
            dropdownOpen: false,
            prevAxisPositions: {},
            prevYDomains: {},
        });
    }
    const state = _pcpState.get(containerSelector);

    // Sync state with potentially changed column list
    const addedCols = allColumns.filter((c) => !state.axisOrder.includes(c));
    state.axisOrder = state.axisOrder.filter((c) => allColumns.includes(c));
    state.axisOrder.push(...addedCols);
    for (const c of [...state.enabledAxes]) {
        if (!allColumns.includes(c)) state.enabledAxes.delete(c);
    }
    addedCols.forEach((c) => state.enabledAxes.add(c));

    // Convenience: re-render closure
    const rerender = (anim) =>
        renderParallelCoords(containerSelector, allColumns, data, { ...options, animate: anim });

    const activeAxes = state.axisOrder.filter((c) => state.enabledAxes.has(c));

    // ── Layout ───────────────────────────────────────────────────
    const containerWidth = Math.max(400, containerNode.clientWidth || 0);
    const containerHeight = Math.max(300, containerNode.clientHeight || 0);
    const HEADER_H = 40;
    const margin = { top: 46, right: 40, bottom: 24, left: 40 };
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - HEADER_H - margin.top - margin.bottom;

    // X positions for axes
    const xScale = d3.scalePoint()
        .domain(activeAxes)
        .range([0, width])
        .padding(0.25);

    // Snapshot previous positions before overwriting
    const prevAxisPositions = { ...state.prevAxisPositions };
    activeAxes.forEach((axis) => {
        state.prevAxisPositions[axis] = xScale(axis);
    });

    // ── Clear & rebuild DOM ──────────────────────────────────────
    container.selectAll("*").remove();

    // ── Dropdown UI ─────────────────────────────────────────────
    const dropdownWrapper = container
        .append("div")
        .attr("class", "pcp-dropdown-wrapper");

    dropdownWrapper
        .append("button")
        .attr("class", "pcp-axes-btn")
        .text("Dimensions ▾")
        .on("click", (event) => {
            event.stopPropagation();
            state.dropdownOpen = !state.dropdownOpen;
            dropdownPanel.classed("hidden", !state.dropdownOpen);
        });

    const dropdownPanel = dropdownWrapper
        .append("div")
        .attr("class", "pcp-axes-panel")
        .classed("hidden", !state.dropdownOpen);

    allColumns.forEach((col) => {
        const item = dropdownPanel
            .append("label")
            .attr("class", "pcp-axis-item");

        item.append("input")
            .attr("type", "checkbox")
            .property("checked", state.enabledAxes.has(col))
            .on("change", function () {
                if (this.checked) {
                    state.enabledAxes.add(col);
                } else {
                    // Always keep at least one axis enabled
                    if (state.enabledAxes.size <= 1) {
                        this.checked = true;
                        return;
                    }
                    state.enabledAxes.delete(col);
                }
                state.dropdownOpen = true; // keep panel open during toggle
                rerender(true);
            });

        item.append("span").text(col);
    });

    // Close dropdown on outside click
    const bodyEventKey = `click.pcp-dd-${containerSelector.replace(/\W/g, "")}`;
    d3.select("body").on(bodyEventKey, () => {
        if (state.dropdownOpen) {
            state.dropdownOpen = false;
            dropdownPanel.classed("hidden", true);
        }
    });

    // ── Early-exit when not enough axes to draw ───────────────── 
    if (activeAxes.length < 2) {
        container.append("p").attr("class", "pcp-empty").text("Not enough dimensions selected.");
        return;
    }

    // ── SVG ──────────────────────────────────────────────────────
    const svgHeight = containerHeight - HEADER_H;
    const svgEl = container
        .append("svg")
        .attr("class", "pcp-svg")
        .attr("viewBox", `0 0 ${containerWidth} ${svgHeight}`)
        .attr("preserveAspectRatio", "none");

    const g = svgEl
        .append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);

    // ── Y scales ─────────────────────────────────────────────────
    const prevYDomains = { ...state.prevYDomains };
    const yScales = {};
    activeAxes.forEach((axis) => {
        const ext = d3.extent(data, (row) => +row[axis]);
        const pad = (ext[1] - ext[0] || 1) * 0.05;
        yScales[axis] = d3
            .scaleLinear()
            .domain([ext[0] - pad, ext[1] + pad])
            .range([height, 0]);
        state.prevYDomains[axis] = yScales[axis].domain();
    });

    // Build start Y scales from previous domains for animation
    const startYScales = {};
    const hasPrevY = Object.keys(prevYDomains).length > 0;
    if (animate && hasPrevY) {
        activeAxes.forEach((axis) => {
            const prevDom = prevYDomains[axis];
            startYScales[axis] = prevDom
                ? d3.scaleLinear().domain(prevDom).range([height, 0])
                : yScales[axis];
        });
    }

    // ── Line helper ───────────────────────────────────────────────
    const buildPath = (orderedAxes, positions, scales, row) =>
        d3.line()(orderedAxes.map((axis) => [positions[axis], scales[axis](+row[axis])]));

    const currentPositions = {};
    activeAxes.forEach((axis) => { currentPositions[axis] = xScale(axis); });

    // ── Lines ─────────────────────────────────────────────────────
    const linesGroup = g.append("g").attr("class", "pcp-lines");

    const linePaths = linesGroup
        .selectAll("path.pcp-line")
        .data(data)
        .enter()
        .append("path")
        .attr("class", "pcp-line")
        .attr("data-row-index", (row, i) => row.__rowIndex ?? i)
        .on("click", function (event) {
            if (event.shiftKey) {
                event.stopPropagation();
                onShiftClick(+(this.dataset.rowIndex));
            }
        })
        .on("mouseenter", function () {
            onHoverStart(+(this.dataset.rowIndex));
            d3.select(this).raise();
        })
        .on("mouseleave", () => onHoverEnd());

    const hasPrev = Object.keys(prevAxisPositions).length > 0;
    const shouldAnimate = animate && (hasPrev || hasPrevY);

    if (shouldAnimate) {
        const startPos = {};
        activeAxes.forEach((axis) => {
            startPos[axis] = prevAxisPositions[axis] ?? xScale(axis);
        });
        const startScales = hasPrevY ? startYScales : yScales;

        linePaths
            .attr("d", (row) => buildPath(activeAxes, startPos, startScales, row))
            .transition()
            .duration(420)
            .ease(d3.easeCubicInOut)
            .attr("d", (row) => buildPath(activeAxes, currentPositions, yScales, row));
    } else {
        linePaths.attr("d", (row) => buildPath(activeAxes, currentPositions, yScales, row));
    }

    // ── Axis groups ───────────────────────────────────────────────
    const axisGs = g
        .selectAll("g.pcp-axis")
        .data(activeAxes)
        .enter()
        .append("g")
        .attr("class", "pcp-axis")
        .attr("data-axis", (axis) => axis);

    // Initial transform: animate from previous position or appear in-place
    axisGs.attr("transform", (axis) => {
        if (shouldAnimate && prevAxisPositions[axis] !== undefined) {
            return `translate(${prevAxisPositions[axis]}, 0)`;
        }
        return `translate(${xScale(axis)}, 0)`;
    });

    // Draw tick marks via d3.axisLeft and add vertical spine line
    axisGs.each(function (axis) {
        const grp = d3.select(this);
        if (shouldAnimate && hasPrevY && startYScales[axis]) {
            grp.call(d3.axisLeft(startYScales[axis]).ticks(5));
            grp.transition().duration(420).ease(d3.easeCubicInOut)
                .call(d3.axisLeft(yScales[axis]).ticks(5));
        } else {
            grp.call(d3.axisLeft(yScales[axis]).ticks(5));
        }
        grp.select(".domain").remove();
        grp.append("line")
            .attr("class", "pcp-axis-spine")
            .attr("y2", height);
    });

    // Axis title label (above the axis)
    axisGs
        .append("text")
        .attr("class", "pcp-axis-label")
        .attr("text-anchor", "middle")
        .attr("y", -14)
        .text((axis) => axis);

    // Drag handle — covers only the label area at the top
    axisGs
        .append("rect")
        .attr("class", "pcp-axis-drag-overlay")
        .attr("x", -46)
        .attr("y", -32)
        .attr("width", 92)
        .attr("height", 30);

    // Transition existing axes to their new positions
    if (shouldAnimate) {
        axisGs
            .filter((axis) => prevAxisPositions[axis] !== undefined)
            .transition()
            .duration(420)
            .ease(d3.easeCubicInOut)
            .attr("transform", (axis) => `translate(${xScale(axis)}, 0)`);

        // New axes fade in from their final position
        axisGs
            .filter((axis) => prevAxisPositions[axis] === undefined)
            .attr("opacity", 0)
            .transition()
            .duration(300)
            .delay(120)
            .attr("opacity", 1);
    }

    // ── Drag to reorder ───────────────────────────────────────────
    // livePositions tracks the visual x of each axis during a drag
    const livePositions = { ...currentPositions };
    let liveOrder = [...activeAxes]; // axis order according to live positions

    const drag = d3.drag()
        .on("start", function () {
            d3.select(this).raise().classed("pcp-axis--dragging", true);
        })
        .on("drag", function (event, axis) {
            const clampedX = Math.max(-margin.left * 0.5, Math.min(width + margin.right * 0.5, event.x));
            livePositions[axis] = clampedX;

            // Move the dragged axis immediately (no transition)
            d3.select(this).attr("transform", `translate(${clampedX}, 0)`);

            // Derive new logical order from visual positions
            const newOrder = [...activeAxes].sort((a, b) => livePositions[a] - livePositions[b]);

            if (newOrder.join("|") !== liveOrder.join("|")) {
                liveOrder = newOrder;

                // Recompute snap positions for non-dragged axes
                const snapXScale = d3.scalePoint()
                    .domain(newOrder)
                    .range([0, width])
                    .padding(0.25);

                newOrder.forEach((a) => {
                    if (a !== axis) {
                        livePositions[a] = snapXScale(a);
                        g.selectAll("g.pcp-axis")
                            .filter((d) => d === a)
                            .transition()
                            .duration(200)
                            .ease(d3.easeCubicOut)
                            .attr("transform", `translate(${livePositions[a]}, 0)`);
                    }
                });
            }

            // Redraw lines using live positions & live order
            linesGroup
                .selectAll("path.pcp-line")
                .attr("d", (row) => buildPath(liveOrder, livePositions, yScales, row));
        })
        .on("end", function (event, axis) {
            d3.select(this).classed("pcp-axis--dragging", false);

            // Persist new order into state
            const inactiveAxes = state.axisOrder.filter((c) => !activeAxes.includes(c));
            state.axisOrder = [...liveOrder, ...inactiveAxes];

            // Store live positions so the re-render can animate from them
            state.prevAxisPositions = { ...livePositions };

            rerender(true);
        });

    axisGs.call(drag);

    // ── Selection state ───────────────────────────────────────────
    function setSelection(rowIndexSet) {
        const hasSel = rowIndexSet !== null && rowIndexSet.size > 0;
        linesGroup
            .selectAll("path.pcp-line")
            .classed("is-selection-dim", function () {
                return hasSel && !rowIndexSet.has(Number(this.dataset.rowIndex));
            })
            .classed("is-line-selected", function () {
                return hasSel && rowIndexSet.has(Number(this.dataset.rowIndex));
            });
    }

    _pcpSetSelectionFns.set(containerSelector, setSelection);
    _pcpLastSelection.set(containerSelector, _pcpLastSelection.get(containerSelector) ?? null);

    // Reapply last-known selection (covers internal rerenders from drag/dropdown)
    const lastSel = _pcpLastSelection.get(containerSelector);
    if (lastSel && lastSel.size > 0) {
        setSelection(lastSel);
    }
}
