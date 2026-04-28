let steps = [];
let currentIndex = 0;
let resizeObserver = null;

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

    const maskSpotlight = document.createElementNS(SVG_NS, 'rect');
    maskSpotlight.id = 'tutorial-mask-spotlight';
    maskSpotlight.setAttribute('fill', 'black');
    maskSpotlight.setAttribute('rx', '6');

    mask.append(maskBg, maskZone, maskSpotlight);
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

function updatePositions() {
    const step = steps[currentIndex];
    const targetEl = document.querySelector(step.highlight);
    const zoneEl   = document.getElementById('tutorial-zone');
    if (!targetEl || !zoneEl) return;

    const spotlight = rectAttrs(targetEl, PADDING);
    const zone      = rectAttrs(zoneEl, 4);

    setRect(document.getElementById('tutorial-mask-spotlight'), spotlight);
    setRect(document.getElementById('tutorial-mask-zone'),      zone);
}

function renderStep(index) {
    const step = steps[index];

    document.getElementById('tutorial-bubble-text').textContent = step.text;
    document.getElementById('tutorial-step-counter').textContent = `${index + 1} / ${steps.length}`;
    document.getElementById('tutorial-prev-btn').disabled = index === 0;
    document.getElementById('tutorial-next-btn').textContent =
        index === steps.length - 1 ? 'Finish' : 'Next →';

    updatePositions();
}

export function startTutorial(tutorialSteps) {
    steps = tutorialSteps;
    currentIndex = 0;

    document.body.classList.add('survey-active');

    const zone = document.getElementById('tutorial-zone');
    zone.innerHTML = `
        <p id="tutorial-bubble-text"></p>
        <div id="tutorial-bubble-nav">
            <button id="tutorial-prev-btn" type="button">← Back</button>
            <span id="tutorial-step-counter"></span>
            <button id="tutorial-next-btn" type="button">Next →</button>
        </div>
    `;

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
    document.getElementById('tutorial-overlay')?.remove();
    document.getElementById('tutorial-zone').innerHTML = '';
    document.body.classList.remove('survey-active');

    resizeObserver?.disconnect();
    resizeObserver = null;

    document.getElementById('start-tutorial-btn').style.display = '';
    steps = [];
    currentIndex = 0;
}
