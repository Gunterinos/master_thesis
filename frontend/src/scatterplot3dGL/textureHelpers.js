/**
 * textureHelpers.js
 *
 * Canvas-based texture and sprite factories for the 3D GL scatterplot.
 * All textures are lazily cached so repeated calls for the same parameters
 * reuse the same Three.js CanvasTexture object.
 *
 * Exports:
 *   createCircleTexture(size, fillColor, alpha, strokeColor)
 *     – solid filled circle, optionally stroked; used for data points,
 *       tick marks, dominated cloud, and the ideal-point marker.
 *
 *   createRingTexture(size, strokeColor, lineWidth)
 *     – outline-only ring; used as a selection overlay on shift-clicked points.
 *
 *   makeCircleSprite(color, size)
 *     – convenience wrapper: returns a THREE.Sprite from createCircleTexture.
 *
 *   makeTextSprite(text, { color, fontSize, bold })
 *     – renders a text label to a canvas and wraps it in a THREE.Sprite.
 *       Rendered at 3× for crisp HiDPI quality.  Sprites use depthTest:false
 *       so axis labels always render on top.
 */

import * as THREE from 'three';

/* ---- circle texture ---- */
const _circleTexCache = new Map();

export function createCircleTexture(size = 64, fillColor = '#ffffff', alpha = 1.0, strokeColor = null) {
    const key = `${size}_${fillColor}_${alpha}_${strokeColor}`;
    if (_circleTexCache.has(key)) return _circleTexCache.get(key);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
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

/* ---- ring (outline-only) texture ---- */
const _ringTexCache = new Map();

export function createRingTexture(size = 64, strokeColor = '#1d1d1f', lineWidth = 2.5) {
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

/* ---- circle sprite convenience wrapper ---- */
export function makeCircleSprite(color, size = 0.02) {
    const tex = createCircleTexture(32, '#ffffff', 1.0);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, color });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(size, size, 1);
    return sprite;
}

/* ---- text sprite ---- */
export function makeTextSprite(text, { color = 0x000000, fontSize = 28, bold = false } = {}) {
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    const font = `${bold ? 'bold ' : ''}${fontSize}px sans-serif`;
    measureCtx.font = font;
    const metrics = measureCtx.measureText(text);
    const lw = Math.ceil(metrics.width) + 8;
    const lh = fontSize + 8;

    // Render at 3× for crisp HiDPI quality
    const SCALE = 3;
    const canvas = document.createElement('canvas');
    canvas.width = lw * SCALE;
    canvas.height = lh * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.font = font;
    // White outline for readability against any background
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeText(text, 4, fontSize);
    const c = new THREE.Color(color);
    ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
    ctx.fillText(text, 4, fontSize);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(lw / 350, lh / 350, 1);
    return sprite;
}
