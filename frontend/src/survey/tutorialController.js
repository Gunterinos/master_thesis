let steps = [];
let currentIndex = 0;
let resizeObserver = null;
let spotlightPool = [];

const PADDING = 8;
const SVG_NS = 'http://www.w3.org/2000/svg';

function rectAttrs(el, padding = 0) {
    const r = el.getBoundingClientRect();
    return {
        x: r.left - padding,
        y: r.top  - padding,
        w: r.width  + padding * 2,
        h: r.height + padding * 2,
    };
}

function setRect(svgEl, attrs) {
    svgEl.setAttribute('x',      attrs.x);
    svgEl.setAttribute('y',      attrs.y);
    svgEl.setAttribute('width',  attrs.w);
    svgEl.setAttribute('height', attrs.h);
}

function buildOverlay() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.id = 'tutorial-overlay';
    svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1000';

    // Mask: white = show dim, black rects = cutouts
    const defs = document.createElementNS(SVG_NS, 'defs');
    const mask = document.createElementNS(SVG_NS, 'mask');
    mask.id = 'tutorial-mask';

    const maskBg = document.createElementNS(SVG_NS, 'rect');
    maskBg.setAttribute('width', '100%');
    maskBg.setAttribute('height', '100%');
    maskBg.setAttribute('fill', 'white');

    const maskZone = document.createElementNS(SVG_NS, 'rect');
    maskZone.id = 'tutorial-mask-zone';
    maskZone.setAttribute('fill', 'black');
    maskZone.setAttribute('rx', '8');

    mask.append(maskBg, maskZone);
    defs.appendChild(mask);

    // Single dark overlay rect, masked
    const dim = document.createElementNS(SVG_NS, 'rect');
    dim.setAttribute('width', '100%');
    dim.setAttribute('height', '100%');
    dim.setAttribute('fill', 'rgba(0,0,0,0.45)');
    dim.setAttribute('mask', 'url(#tutorial-mask)');

    svg.append(defs, dim);
    return svg;
}

function ensurePoolSize(count, mask) {
    while (spotlightPool.length < count) {
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.classList.add('tutorial-mask-spotlight');
        rect.setAttribute('fill', 'black');
        rect.setAttribute('rx', '6');
        rect.setAttribute('width', '0');
        rect.setAttribute('height', '0');
        mask.appendChild(rect);
        spotlightPool.push(rect);
    }
}

function clearFocusBorders() {
    document.querySelectorAll('.tutorial-focus-border').forEach(el => el.remove());
}

function renderFocusBorders(step) {
    if (!step.focus) return;
    const selectors = Array.isArray(step.focus) ? step.focus : [step.focus];
    selectors.forEach(selector => {
        const target = document.querySelector(selector);
        if (!target) return;
        const r = target.getBoundingClientRect();
        const div = document.createElement('div');
        div.classList.add('tutorial-focus-border');
        div.style.left   = `${r.left}px`;
        div.style.top    = `${r.top}px`;
        div.style.width  = `${r.width}px`;
        div.style.height = `${r.height}px`;
        document.body.appendChild(div);
    });
}

function updatePositions() {
    const step   = steps[currentIndex];
    const zoneEl = document.getElementById('tutorial-zone');
    const mask   = document.getElementById('tutorial-mask');
    if (!zoneEl || !mask) return;

    const highlights = Array.isArray(step.highlight) ? step.highlight : [step.highlight];
    ensurePoolSize(highlights.length, mask);

    // Update active spotlights in place so CSS transition can animate them
    highlights.forEach((selector, i) => {
        const targetEl = document.querySelector(selector);
        if (targetEl) setRect(spotlightPool[i], rectAttrs(targetEl, PADDING));
    });

    // Collapse unused pool slots off-screen
    for (let i = highlights.length; i < spotlightPool.length; i++) {
        spotlightPool[i].setAttribute('width',  '0');
        spotlightPool[i].setAttribute('height', '0');
    }

    setRect(document.getElementById('tutorial-mask-zone'), rectAttrs(zoneEl, 4));

    clearFocusBorders();
    renderFocusBorders(step);
}

function closeAllStepMenus() {
    steps.forEach(s => {
        if (s.openMenu) document.querySelector(s.openMenu)?.classList.remove('open');
    });
}

function renderStep(index) {
    const step = steps[index];

    closeAllStepMenus();

    document.getElementById('tutorial-bubble-text').innerHTML = step.text;
    document.getElementById('tutorial-step-counter').textContent = `${index + 1} / ${steps.length}`;
    document.getElementById('tutorial-prev-btn').disabled = index === 0;
    document.getElementById('tutorial-next-btn').textContent =
        index === steps.length - 1 ? 'Finish' : 'Next →';

    setTimeout(() => {
        if (step.openMenu) document.querySelector(step.openMenu)?.classList.add('open');
        if (step.setChart) {
            const charts = Array.isArray(step.setChart) ? step.setChart : [step.setChart];
            charts.forEach(({ select, value }) => {
                const sel = document.querySelector(select);
                if (sel && sel.value !== value) {
                    sel.value = value;
                    sel.dispatchEvent(new Event('change'));
                }
            });
        }
        updatePositions();
    }, 0);
}

export function startTutorial(tutorialSteps) {
    steps = tutorialSteps;
    currentIndex = 0;

    document.body.classList.add('survey-active');
    document.getElementById('chart-guide-btn').style.display = 'none';

    const zone = document.getElementById('tutorial-zone');
    zone.innerHTML = `
        <p id="tutorial-bubble-text"></p>
        <div id="tutorial-bubble-controls">
            <div id="tutorial-bubble-nav">
                <button id="tutorial-prev-btn" type="button">← Back</button>
                <span id="tutorial-step-counter"></span>
                <button id="tutorial-next-btn" type="button">Next →</button>
            </div>
            <button id="tutorial-chart-guide-btn" type="button">Chart Guide</button>
        </div>
    `;

    spotlightPool = [];
    document.body.appendChild(buildOverlay());
    document.getElementById('start-tutorial-btn').style.display = 'none';

    document.getElementById('tutorial-prev-btn').addEventListener('click', () => {
        if (currentIndex > 0) { currentIndex--; renderStep(currentIndex); }
    });
    document.getElementById('tutorial-next-btn').addEventListener('click', () => {
        if (currentIndex < steps.length - 1) { currentIndex++; renderStep(currentIndex); }
        else endTutorial();
    });

    resizeObserver = new ResizeObserver(() => updatePositions());
    resizeObserver.observe(document.body);

    renderStep(0);
}

function endTutorial() {
    closeAllStepMenus();
    clearFocusBorders();
    document.getElementById('tutorial-overlay')?.remove();
    document.getElementById('tutorial-zone').innerHTML = '';
    document.body.classList.remove('survey-active');

    resizeObserver?.disconnect();
    resizeObserver = null;
    spotlightPool = [];

    document.getElementById('start-tutorial-btn').style.display = '';
    document.getElementById('chart-guide-btn').style.display = '';
    steps = [];
    currentIndex = 0;
}
