// Adapted from the original character compositor. Each factory owns its own portrait lifecycle.
import { vnBreathing } from './vnBreathing.js';
import { vnSpriteMotion } from './vnSpriteMotion.js';
import { vnPerformance } from './vnPerformance.js';
import { vnLife } from './vnLife.js';
import { isLocalChapterCue } from './cueUrl.js';
// Audio-clock lip sync and pose-specific facial/body performance throughout the visual novel.
/**
 * Blink seed of one portrait surface: an FNV-1a hash of the character ID mixed with the
 * runtime's surface count (never 0). Every portrait has its own runtime, so a count alone gave
 * two characters on stage the same blink rhythm.
 */
export function blinkSeed(character, sequence) {
    const hash = Array.from(String(character)).reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
    return (hash ^ Math.imul(sequence, 2654435761)) >>> 0 || 1;
}

export function createSpriteRuntime(options) {
    'use strict';
    const { manifestUrl, speechIndexUrl, lightingUrl, browsIndexUrl } = options;
    const assetRoot = options.assetRoot.replace(/\/$/, '') + '/';
    const root = options.element;
    const resolveAsset = options.resolveAsset || (url => url);
    const validAssetUrl = url => typeof url === 'string' && url.startsWith(assetRoot) && !url.slice(assetRoot.length).split('/').includes('..');
    const validCueUrl = url => {
        if (validAssetUrl(url)) return true;
        if (typeof url !== 'string') return false;
        if (resolveAsset(url) !== url && /^data:application\/json[;,]/.test(resolveAsset(url))) return true;
        if (isLocalChapterCue(url, document.baseURI)) return true;
        try {
            const parsed = new URL(url, location.href);
            return parsed.origin === location.origin && /^\/generated\/[a-f0-9]+\.cues\.json$/.test(parsed.pathname);
        } catch { return false; }
    };
    const jsonCache = new Map(), imageCache = new Map();
    let mouthAnimationOverride = null, mouthShapeOverride = null;
    function setMouthAnimationOverride(value) {
        mouthAnimationOverride = typeof value === 'boolean' ? value : null;
        if (mouthAnimationOverride === false && surface?.ready && surface.enabled)
            paint(surface, { from: 'X', to: 'X', blend: 0 });
        return !!active;
    }
    function setMouthShape(value) {
        mouthShapeOverride = /^[A-FX]$/.test(value || '') ? value : null;
        if (surface?.ready && surface.enabled) paint(surface, { from: mouthShapeOverride || 'X', to: mouthShapeOverride || 'X', blend: 0 });
    }
    let active = null, surface = null, frame = 0;
    let blinkEnabled = true, breathingEnabled = true, lifeEnabled = true, surfaceSequence = 0;
    let motionEnabled = { head: true, gaze: true, secondary: true };
    let lightingEnabled = true, browOverride = null;
    // Prepared, read-only per-pose artwork (healed base, mouth patches, eyelid frames/masks). Speakers
    // alternate constantly, so returning poses skip their per-pixel preparation on the main thread.
    const poseCache = new Map(), poseCacheLimit = 10;
    function cachedPose(key, sprite) {
        const entry = poseCache.get(key);
        if (!entry || entry.sprite !== sprite) return null;
        poseCache.delete(key); poseCache.set(key, entry);
        return entry;
    }
    function rememberPose(key, sprite, values) {
        const entry = { ...(poseCache.get(key)?.sprite === sprite ? poseCache.get(key) : {}), ...values, sprite };
        poseCache.delete(key); poseCache.set(key, entry);
        while (poseCache.size > poseCacheLimit) poseCache.delete(poseCache.keys().next().value);
    }
    const lighting = { data: null, background: null, from: null, to: null, started: 0, current: null };
    let status = { state: 'idle', shape: 'X', fromShape: 'X', toShape: 'X', blend: 0, rest: true };
    const basename = path => String(path).split(/[?#]/)[0].split('/').pop();
    const audioKey = path => {
        let value = String(path).split(/[?#]/)[0];
        try { value = decodeURIComponent(value); } catch { /* Retain malformed external paths safely. */ }
        const index = value.indexOf('/audio/');
        return index >= 0 ? value.slice(index) : value;
    };
    const spriteKey = path => basename(path).replace(/\.(png|webp)$/i, '').toLowerCase();
    const supportedCharacter = binding => typeof binding?.character === 'string' && binding.character.length > 0;
    const fetchJson = url => {
        if (!jsonCache.has(url)) jsonCache.set(url, fetch(resolveAsset(url)).then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
            return response.json();
        }).catch(error => { jsonCache.delete(url); throw error; }));
        return jsonCache.get(url);
    };
    // Decode off the main thread before first use; drawing an undecoded image decodes it synchronously.
    const loadImage = url => {
        if (!imageCache.has(url)) imageCache.set(url, new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => typeof image.decode === 'function' ? image.decode().catch(() => {}).then(() => resolve(image)) : resolve(image);
            image.onerror = () => reject(new Error(`Image unavailable: ${url}`)); image.src = resolveAsset(url);
        }).catch(error => { imageCache.delete(url); throw error; }));
        return imageCache.get(url);
    };
    // Splits portrait preparation into separate tasks so the stage keeps rendering frames.
    const yieldToBrowser = () => typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function' ? scheduler.yield()
        : typeof MessageChannel === 'function' ? new Promise(resolve => {
            const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); }; channel.port2.postMessage(0);
        }) : Promise.resolve();
    const makeCanvas = (width, height) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
    };
    // Canvases whose pixels are read back stay CPU-side: getImageData on a GPU canvas forces a
    // synchronous readback that blocked the main thread for milliseconds per call.
    const readable = canvas => canvas.getContext('2d', { willReadFrequently: true });
    function validRect(rect) {
        return rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0;
    }
    function validRig(rig, sprite) {
        const numbers = (value, length, min, max) => Array.isArray(value) && value.length === length &&
            value.every(n => Number.isFinite(n) && n >= min && n <= max);
        const range = (value, length) => numbers(value, length, -1024, 2048) && value[0] < value[1] &&
            (length === 2 || (value[1] <= value[2] && value[2] < value[3]));
        const bounded = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
        return rig?.sourceWidth === sprite.sourceWidth && rig.sourceHeight === sprite.sourceHeight &&
            validAssetUrl(rig.referenceImage) &&
            (rig.gaze === null || (validAssetUrl(rig.gaze))) &&
            bounded(rig.breathing?.fixedTop, 0, 1000) && bounded(rig.breathing?.vertical, 0, 8) &&
            bounded(rig.breathing?.horizontal, 0, 4) && numbers(rig.head?.pivot, 2, 0, 1024) &&
            bounded(rig.head.rigidUntil, 0, 1024) && bounded(rig.head.anchoredFrom, 0, 1024) &&
            rig.head.anchoredFrom > rig.head.rigidUntil && Array.isArray(rig.hair) && rig.hair.length <= 3 &&
            rig.hair.every(zone => range(zone.x, 4) && range(zone.y, 4) && numbers(zone.vector, 2, -2, 2)) &&
            range(rig.clothing?.left, 2) && range(rig.clothing?.right, 2) && range(rig.clothing?.y, 4);
    }
    const validLandmarks = points => Array.isArray(points) && points.length === 25 && points.every(point =>
        Array.isArray(point) && point.length === 2 && point.every(value => Number.isFinite(value) && value >= 0 && value <= 1));

    function restoreOriginal(target) {
        if (!target) return;
        target.enabled = false; target.mouthMotion = null;
        target.breathing?.render();
        target.canvas.getContext('2d')?.clearRect(0, 0, target.canvas.width, target.canvas.height);
        target.canvas.style.visibility = 'hidden';
        target.image.style.visibility = target.originalVisibility;
        target.enabled = false;
        target.canvas.dataset.mouthShape = 'X';
    }
    function disposeSurface() {
        if (!surface) return;
        surface.performance?.dispose();
        surface.life?.dispose();
        disposeBlink(surface);
        surface.breathing?.dispose();
        surface.motion?.dispose();
        restoreOriginal(surface);
        surface.resizeObserver?.disconnect();
        if (surface.resizeHandler) window.removeEventListener('resize', surface.resizeHandler);
        surface = null;
    }
    function stop(reason = 'idle', fallback = false) {
        cancelAnimationFrame(frame); frame = 0; active = null;
        if (surface) surface.speechEnergy = 0;
        surface?.performance?.sync();
        if (fallback && surface?.mouthEnabled !== false) { if (surface) { surface.blockedByVoice = true; pauseBlink(surface); } restoreOriginal(surface); }
        else if (surface?.ready && surface.enabled) paint(surface, { from: 'X', to: 'X', blend: 0 });
        status = { ...status, state: reason, shape: 'X', fromShape: 'X', toShape: 'X', blend: 0, rest: true };
    }
    function stopTrack(howl) { if (active?.howl === howl) stop(); }
    function dispose() { stop(); disposeSurface(); vnSpriteMotion?.disposePreload(); }

    function positionCanvas(target) {
        const { image, canvas, sprite } = target;
        if (!sprite) return;
        const scale = Math.min(image.clientWidth / sprite.sourceWidth, image.clientHeight / sprite.sourceHeight);
        const width = sprite.sourceWidth * scale, height = sprite.sourceHeight * scale;
        canvas.style.left = `${image.offsetLeft + (image.clientWidth - width) / 2}px`;
        canvas.style.top = `${image.offsetTop + (image.clientHeight - height) / 2}px`;
        canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    }

    function pauseBlink(target) {
        const blink = target?.blink;
        if (!blink) return;
        clearTimeout(blink.timer); blink.timer = 0;
        cancelAnimationFrame(blink.frame); blink.frame = 0;
        blink.phase = 'open'; blink.closure = 0; blink.from = 0; blink.to = 0; blink.blend = 0;
        if (target.enabled) paintBlink(target, 0);
    }
    function disposeBlink(target) {
        pauseBlink(target);
        if (target.blink?.visibilityHandler) document.removeEventListener?.('visibilitychange', target.blink.visibilityHandler);
        target.blink?.motionQuery?.removeEventListener?.('change', target.blink.visibilityHandler);
    }
    function canBlink(target) {
        return surface === target && target.enabled && !target.blockedByVoice && blinkEnabled &&
            !document.hidden && !target.blink?.motionQuery?.matches && target.canvas.isConnected !== false;
    }
    // Tense or anxious expressions blink more often; intent or confrontational ones hold the stare.
    function blinkRange(poseKey) {
        const key = String(poseKey || '');
        if (/worried|confused|pleading|pained|scared|panicked|desperate|tearful|crying|broken|shocked/.test(key)) return [2200, 4500];
        if (/angry|determined|focused|serious|alert|smug|accus|composed/.test(key)) return [4000, 7500];
        return [3000, 6000];
    }
    function blinkRandom(blink) {
        blink.seed = (Math.imul(blink.seed, 1664525) + 1013904223) >>> 0;
        return blink.seed / 4294967296;
    }
    function scheduleBlink(target, delayOverride) {
        const blink = target.blink;
        if (!blink || blink.timer || blink.frame || !canBlink(target)) return;
        // Seed once per surface, then vary intervals without a permanent idle animation loop.
        const [low, high] = blinkRange(target.poseKey);
        const delay = Number.isFinite(delayOverride) ? delayOverride : low + blinkRandom(blink) * (high - low);
        blink.timer = setTimeout(() => beginBlink(target), delay);
    }
    // Blinks that punctuate a speech pause, expression change or large eye movement.
    function contextBlink(target, minimumGap = 1200) {
        const blink = target?.blink;
        if (!blink || blink.frame || !canBlink(target)) return false;
        if (performance.now() - (blink.lastEnded ?? -Infinity) < minimumGap) return false;
        return beginBlink(target);
    }
    function beginBlink(target) {
        const blink = target?.blink;
        if (!blink || !canBlink(target)) return false;
        clearTimeout(blink.timer); blink.timer = 0;
        if (blink.frame) return false;
        blink.started = performance.now();
        const animate = now => {
            blink.frame = 0;
            if (!canBlink(target)) { pauseBlink(target); return; }
            const elapsed = now - blink.started;
            const ease = value => value * value * (3 - 2 * value);
            let closure;
            if (elapsed < 90) { closure = ease(Math.max(0, elapsed / 90)); blink.phase = 'closing'; }
            else if (elapsed < 120) { closure = 1; blink.phase = 'closed'; }
            else if (elapsed < 260) { closure = 1 - ease((elapsed - 120) / 140); blink.phase = 'opening'; }
            else { closure = 0; blink.phase = 'open'; }
            paintBlink(target, closure);
            if (elapsed < 260) blink.frame = requestAnimationFrame(animate);
            else {
                blink.lastEnded = now;
                // Occasional natural double blink; the second one resumes the normal rhythm.
                if (!blink.second && blinkRandom(blink) < .12) { blink.second = true; blink.timer = setTimeout(() => beginBlink(target), 90); }
                else { blink.second = false; scheduleBlink(target); }
            }
        };
        blink.frame = requestAnimationFrame(animate);
        return true;
    }
    function setBlinkEnabled(enabled) {
        blinkEnabled = Boolean(enabled);
        if (!surface?.blink) return;
        pauseBlink(surface);
        if (blinkEnabled) scheduleBlink(surface);
    }

    function warpBlinkPatch(patch, points, geometry, buffer, triangles) {
        warpPatch(patch, points, geometry, buffer, triangles);
        // Shared clipped triangle edges have partial coverage. Re-compositing the same pixels
        // preserves their sampled color while closing alpha cracks; the eye mask is applied later.
        // Keep this eye-only so the already approved mouth rendering remains unchanged.
        const context = buffer.getContext('2d');
        for (let pass = 0; pass < 3; pass++) context.drawImage(buffer, 0, 0);
    }

    function eyeAperture(eye, geometry) {
        const rect = eye.rect;
        const points = eye.apertureIndices.map(i => [geometry[i][0] * rect.width, geometry[i][1] * rect.height]);
        const center = points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
        const inset = Math.max(0, Math.min(2, eye.apertureInset ?? .75));
        return points.map(point => {
            const dx = point[0] - center[0], dy = point[1] - center[1];
            const scale = Math.max(0, 1 - inset / (Math.hypot(dx, dy) || 1));
            return [rect.x + center[0] + dx * scale, rect.y + center[1] + dy * scale];
        });
    }
    function clipPolygon(context, points) {
        context.beginPath();
        points.forEach((point, i) => i ? context.lineTo(...point) : context.moveTo(...point));
        context.closePath(); context.clip();
    }
    // Authored acting plus the procedural life layer, as presented on screen.
    function presentedPose(target) {
        const pose = vnLife && target.lifePose ? vnLife.combine(target.performancePose, target.lifePose) : { ...target.performancePose };
        if (!motionEnabled.head) { pose.angle = pose.x = pose.y = 0; pose.scale = 1; }
        if (!motionEnabled.gaze) pose.gazeX = pose.gazeY = 0;
        if (!motionEnabled.secondary) pose.hair = pose.cloth = 0;
        return pose;
    }
    function hasGaze(target, eye) {
        const pose = presentedPose(target);
        // Gaze moves the iris inside the eye's aperture outline. An illustrated blink without
        // one (an animal's eyes, say) keeps its drawn eyes still instead of failing to paint.
        return eye.gaze && eye.apertureIndices && Math.hypot(pose.gazeX || 0, pose.gazeY || 0) > .00001;
    }
    function paintEyeInterior(target, eye, geometry, closure = 0) {
        const rect = eye.rect, context = (target.composite || target.canvas).getContext('2d');
        let aperture = eyeAperture(eye, geometry);
        if (hasGaze(target, eye) && eye.gaze.gazeAperture) {
            // Some narrow eyes need their true exposed iris crown at rest. Fade this
            // pose-specific correction away early in the blink, before the lid covers it.
            const amount = Math.max(0, 1 - closure / .2);
            const weight = amount * amount * (3 - 2 * amount);
            const open = eyeAperture(eye, eye.frames[0].landmarks);
            aperture = aperture.map((point, i) => point.map((value, axis) =>
                value + (eye.gaze.gazeAperture[i][axis] - open[i][axis]) * weight));
        }
        context.save(); clipPolygon(context, aperture);
        context.drawImage(target.base, rect.x, rect.y, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);
        if (hasGaze(target, eye)) {
            const gaze = eye.gaze, offset = presentedPose(target);
            const dx = offset.gazeX * gaze.maxShiftX, dy = offset.gazeY * gaze.maxShiftY;
            const painter = gaze.mixed.getContext('2d');
            painter.clearRect(0, 0, rect.width, rect.height);
            painter.drawImage(target.gaze.atlas, gaze.sourceRect.x, gaze.sourceRect.y, gaze.sourceRect.width, gaze.sourceRect.height,
                0, 0, rect.width, rect.height);
            painter.drawImage(gaze.irisCanvas, dx, dy);
            // Blend only the subpixel onset/return; exact zero always bypasses the replacement.
            context.globalAlpha = Math.min(1, Math.hypot(dx, dy) / .75);
            context.drawImage(gaze.mixed, rect.x, rect.y);
        }
        context.restore(); eye.aperture = aperture;
    }
    function attachGaze(target) {
        if (!target.gaze || !target.blink) return;
        target.blink.eyes.forEach((eye, index) => {
            const config = target.gaze.eyes[index], rect = eye.rect;
            if (!config) return;
            if (['x', 'y', 'width', 'height'].some(key => config.rect[key] !== rect[key])) return;
            const irisCanvas = makeCanvas(rect.width, rect.height), painter = irisCanvas.getContext('2d');
            painter.drawImage(target.base, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
            const mask = makeCanvas(rect.width, rect.height), brush = readable(mask);
            const pixels = brush.getImageData(0, 0, rect.width, rect.height), iris = config.iris;
            for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) {
                const radius = Math.hypot((x + .5 + rect.x - iris.x) / iris.radiusX, (y + .5 + rect.y - iris.y) / iris.radiusY);
                const amount = Math.max(0, Math.min(1, (1 - radius) * Math.min(iris.radiusX, iris.radiusY) / (iris.feather || 1)));
                pixels.data[(y * rect.width + x) * 4 + 3] = 255 * amount * amount * (3 - 2 * amount);
            }
            brush.putImageData(pixels, 0, 0);
            painter.globalCompositeOperation = 'destination-in'; painter.drawImage(mask, 0, 0);
            // Keep the original dark iris crown; clip only at the destination eyelid.
            painter.globalCompositeOperation = 'source-over';
            eye.gaze = { ...config, irisCanvas, mixed: makeCanvas(rect.width, rect.height) };
        });
        paintBlink(target, target.blink.closure);
    }
    async function prepareGaze(target) {
        if (!target.rig.gaze) return;
        try {
            const config = await fetchJson(target.rig.gaze);
            if (config.sourceWidth !== target.sprite.sourceWidth || config.sourceHeight !== target.sprite.sourceHeight ||
                !Array.isArray(config.eyes) || ![1, 2].includes(config.eyes.length) ||
                config.eyes.length !== target.sprite.blink?.eyes?.length || config.eyes.some(eye =>
                !validRect(eye.rect) || !validRect(eye.sourceRect) || ![eye.iris?.x, eye.iris?.y, eye.iris?.radiusX, eye.iris?.radiusY,
                    eye.maxShiftX, eye.maxShiftY].every(Number.isFinite) || eye.iris.radiusX <= 0 || eye.iris.radiusY <= 0 ||
                eye.maxShiftX < 0 || eye.maxShiftX > 5 || eye.maxShiftY < 0 || eye.maxShiftY > 2 ||
                (eye.gazeAperture && (!Array.isArray(eye.gazeAperture) || eye.gazeAperture.length !== 8 ||
                    eye.gazeAperture.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)))))) throw new Error('Invalid gaze geometry');
            const atlas = await loadImage(config.image);
            if (surface !== target) return;
            target.gaze = { ...config, atlas }; attachGaze(target);
        } catch (error) {
            if (surface === target) console.warn('[VNPerformance] Keeping original gaze:', error.message);
        }
    }
    // Scene lighting from the offline background analysis (Scripts/build-vn-lighting.py).
    function lightFor(entry) {
        return entry && { key: entry.key.color, rim: entry.key.strength, direction: entry.key.direction, rimWidth: 16,
            ambient: entry.ambient.color, tint: entry.ambient.strength, exposure: entry.exposure, gradient: entry.gradient,
            flicker: entry.flicker || null };
    }
    function mixLight(a, b, t) {
        const mix = (x, y) => Array.isArray(x) ? x.map((value, i) => value + (y[i] - value) * t) : x + (y - x) * t;
        const result = { ...b };
        for (const key of ['key', 'rim', 'direction', 'rimWidth', 'ambient', 'tint', 'exposure', 'gradient']) result[key] = mix(a[key], b[key], t);
        return result;
    }
    function flickerAt(seconds, flicker) {
        if (!flicker?.amount) return 1;
        const wave = (frequency, phase = 0) => Math.sin(2 * Math.PI * frequency * seconds + phase);
        if (flicker.kind === 'fire') return 1 + flicker.amount * (.6 * wave(7.3) + .4 * wave(11.1, 1.3)) * (.6 + .4 * wave(.7));
        if (flicker.kind === 'neon') return 1 - flicker.amount * Math.pow(Math.max(0, wave(.23)), 40) * (.5 + .5 * wave(23));
        if (flicker.kind === 'chem') return 1 + flicker.amount * wave(.35);
        return 1;
    }
    function currentLight(target, now = performance.now()) {
        const background = target.layer?.dataset?.vnBackground || '';
        // No declared background (fixtures, exporters, other pages): keep the approved unlit pixels.
        if (!lightingEnabled || !lighting.data || !background) return null;
        if (background !== lighting.background) {
            const next = lightFor(lighting.data.backgrounds?.[background] || lighting.data.default);
            // Background changes cross-fade the light like the backdrop; the first light applies directly.
            lighting.from = lighting.current; lighting.to = next; lighting.started = now; lighting.background = background;
        }
        const t = lighting.from ? Math.max(0, Math.min(1, (now - lighting.started) / 900)) : 1;
        const light = t < 1 ? mixLight(lighting.from, lighting.to, t * t * (3 - 2 * t)) : lighting.to;
        lighting.current = light;
        if (!light?.flicker || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return light;
        const factor = flickerAt(now / 1000, light.flicker);
        return { ...light, rim: light.rim * factor, exposure: light.exposure * (1 + (factor - 1) * .35) };
    }
    function loadLighting() {
        if (lightingUrl && !lighting.data) void fetchJson(lightingUrl).then(data => {
            if (data?.backgrounds && data.default) { lighting.data = data; surface?.breathing?.render(); }
        }).catch(() => { /* Lighting is optional; portraits stay unlit. */ });
    }
    function setLightingEnabled(enabled) {
        lightingEnabled = !!enabled;
        lighting.background = null; lighting.from = null; lighting.current = null;
        surface?.breathing?.render();
    }

    // Lets the stage start an entrance on the finished (lit) canvas instead of the static image.
    function whenReady(timeout = 350) {
        const started = performance.now();
        return new Promise(resolve => {
            const check = () => {
                if (!surface || surface.failed || (surface.ready && surface.enabled)) resolve(!!surface?.enabled);
                else if (performance.now() - started >= timeout) resolve(false);
                else requestAnimationFrame(check);
            };
            check();
        });
    }

    function presentPerformance(target) {
        if (!target.breathingCanvas) return;
        // The jaw follows the mouth; it belongs to the head motion layer for isolation/export.
        const mouth = target.mouthMotion;
        const pose = mouth && motionEnabled.head ? { ...presentedPose(target), ...mouth } : presentedPose(target);
        if (target.motion) target.motion.render(target.breathingCanvas, target.canvas, pose, target.rig, currentLight(target));
        else {
            const painter = target.canvas.getContext('2d'); painter.clearRect(0, 0, target.canvas.width, target.canvas.height);
            painter.drawImage(target.breathingCanvas, 0, 0);
        }
    }
    async function preparePerformance(target) {
        if (!vnPerformance) return;
        try {
            const config = await fetchJson(target.rig.lines || options.performanceIndexUrl);
            if (!config.lines || Object.values(config.lines).some(line =>
                !Array.isArray(line.head) || !Array.isArray(line.gaze) || [...line.head, ...line.gaze].some(event =>
                    !Number.isFinite(event.start) || event.start < 0 || !Number.isFinite(event.duration) || event.duration <= 0 || event.duration > 5)))
                throw new Error('Invalid performance timeline');
            if (surface !== target) return;
            target.performanceLines = config.lines;
            target.performance = vnPerformance.create({
                lines: config.lines,
                isEnabled: () => surface === target && target.enabled && !target.blockedByVoice && target.canvas.isConnected !== false,
                getPlayback: () => active && active.binding.scene === target.binding.scene && active.binding.character.toLowerCase() === target.binding.character.toLowerCase() &&
                    String(active.binding.dialogue) === target.layer.dataset.vnLipsyncDialogue && active.howl.playing(active.soundId)
                    ? { source: audioKey(active.src), seconds: Number(active.howl.seek(active.soundId)) } : null,
                onChange: pose => {
                    const old = target.performancePose; target.performancePose = pose;
                    if (target.blink && (old?.gazeX !== pose.gazeX || old?.gazeY !== pose.gazeY)) paintBlink(target, target.blink.closure);
                    else target.breathing?.render();
                }
            });
            target.performance.setEnabled(motionEnabled); target.performance.sync();
        } catch (error) {
            if (surface === target) console.warn('[VNPerformance] Keeping resting pose:', error.message);
        }
    }

    // Brows share the upper face with the eyes: reset the brow region from the base, repaint the
    // eyes, then draw the warped brows through their fixed mask (which excludes eyes and hair).
    function resetBrowRegion(target, context) {
        const brows = target.brows;
        if (!brows || !(target.browValue || target.browsDrawn)) return;
        const { x, y, width, height } = brows.rect;
        context.clearRect(x, y, width, height);
        context.drawImage(target.base, x, y, width, height, x, y, width, height);
    }
    // Brow states are rendered once per pose at 0.05 steps (at most ~1.5 px of brow travel) and cached;
    // a moving brow then costs one drawImage per level change instead of re-warping ~360 triangles.
    const browStep = 20;
    const browLevel = value => Math.round(Math.max(-1, Math.min(1, value)) * browStep) / browStep;
    function renderBrowLevel(brows, value) {
        const frames = brows.frames;
        let index = 0;
        while (index + 1 < frames.length - 1 && value > frames[index + 1].value) index++;
        const from = frames[index], to = frames[index + 1];
        const blend = Math.max(0, Math.min(1, (value - from.value) / (to.value - from.value)));
        const geometry = from.landmarks.map((point, i) => point.map((v, axis) => v + (to.landmarks[i][axis] - v) * blend));
        // Geometry moves linearly; the generated texture fades in late (t^2.2), so everyday in-between
        // values show the warped original brow (no doubled outlines) and the new art leads at extremes.
        const ease = t => Math.pow(t, 2.2);
        const textureBlend = from.value === 0 ? ease(blend) : to.value === 0 ? 1 - ease(1 - blend) : blend;
        const level = makeCanvas(brows.mask.width, brows.mask.height), mixed = level.getContext('2d');
        warpBlinkPatch(from.patch, from.landmarks, geometry, brows.warpFrom, brows.triangles);
        warpBlinkPatch(to.patch, to.landmarks, geometry, brows.warpTo, brows.triangles);
        mixed.globalAlpha = 1 - textureBlend; mixed.drawImage(brows.warpFrom, 0, 0);
        mixed.globalCompositeOperation = 'lighter'; mixed.globalAlpha = textureBlend; mixed.drawImage(brows.warpTo, 0, 0);
        mixed.globalAlpha = 1; mixed.globalCompositeOperation = 'destination-in'; mixed.drawImage(brows.mask, 0, 0);
        mixed.globalCompositeOperation = 'source-over';
        brows.levels.set(value, level);
        return level;
    }
    // Rendered levels (up to 24 canvases per pose) are kept for the three most recent brow poses only;
    // older poses keep their prepared frames and re-render levels on demand.
    const browLevelOwners = [], browLevelLimit = 3;
    function retainBrowLevels(brows) {
        const index = browLevelOwners.indexOf(brows);
        if (index >= 0) browLevelOwners.splice(index, 1);
        browLevelOwners.unshift(brows);
        while (browLevelOwners.length > browLevelLimit) browLevelOwners.pop().levels.clear();
    }
    function drawBrows(target, context) {
        const brows = target.brows, value = browLevel(target.browValue || 0);
        target.browsDrawn = false;
        if (!brows || !value) return;
        const level = brows.levels.get(value) || renderBrowLevel(brows, value);
        context.drawImage(level, brows.rect.x, brows.rect.y, brows.rect.width, brows.rect.height);
        target.browsDrawn = true;
    }
    // Pre-render the everyday range in idle time, one level per idle period.
    function prewarmBrows(target) {
        const brows = target.brows;
        const pending = [];
        for (let i = 1; i <= 14; i++) if (brows.raise) pending.push(i / browStep);
        for (let i = 1; i <= 10; i++) if (brows.furrow) pending.push(-i / browStep);
        const step = () => {
            if (surface !== target || !pending.length) return;
            const value = pending.shift();
            if (!brows.levels.has(value)) renderBrowLevel(brows, value);
            whenIdle(step);
        };
        whenIdle(step);
    }
    function paintBrows(target) {
        if (!target.enabled || !target.brows) return;
        // Present on the next coalesced frame rather than forcing an extra full paint now.
        if (target.blink) { paintBlink(target, target.blink.closure, true); return; }
        const context = (target.composite || target.canvas).getContext('2d');
        resetBrowRegion(target, context); drawBrows(target, context);
        if (target.breathing?.requestRender) target.breathing.requestRender(); else target.breathing?.render();
    }

    // The upper lids follow the brows. A knit narrows the eyes along the authored blink frames; a raise
    // continues the open-to-closing lid motion in reverse, lifting the lid a few pixels (the aperture
    // interior stretches with it, since there is no hidden iris art above the lid).
    const lidLiftPixels = 8, lidMaxWiden = .35, lidNarrow = .15;
    function lidClosure(target, eye) {
        const brow = target.brows ? browLevel(target.browValue || 0) * (eye.browInfluence ?? 1) : 0;
        if (brow <= 0) return -brow * lidNarrow;
        if (eye.liftPerClosure === undefined) {
            const [open, next] = eye.frames;
            eye.liftPerClosure = Math.max(0, ...(eye.apertureIndices || []).map(i =>
                (next.landmarks[i][1] - open.landmarks[i][1]) * eye.rect.height / next.closure));
        }
        if (!eye.liftPerClosure || !eye.apertureIndices) return 0;
        const lift = lidLiftPixels * target.sprite.sourceWidth / 1024;
        return -brow * Math.min(lidMaxWiden, lift / eye.liftPerClosure, foldFreeWiden(eye));
    }
    // Some eyelid meshes fold before the full lift (extrapolating past the open frame); cap each eye
    // at 90% of its largest fold-free lift, found once by sampling the extrapolated mesh.
    function foldFreeWiden(eye) {
        if (eye.foldFreeWiden !== undefined) return eye.foldFreeWiden;
        const [open, next] = eye.frames, area = (p, [a, b, c]) =>
            (p[b][0] - p[a][0]) * (p[c][1] - p[a][1]) - (p[b][1] - p[a][1]) * (p[c][0] - p[a][0]);
        const signs = eye.triangles.map(t => Math.sign(area(open.landmarks, t)));
        let safe = lidMaxWiden;
        for (let step = 1; step <= 40; step++) {
            const widen = lidMaxWiden * step / 40, t = -widen / next.closure;
            const points = open.landmarks.map((p, i) => [p[0] + (next.landmarks[i][0] - p[0]) * t, p[1] + (next.landmarks[i][1] - p[1]) * t]);
            if (eye.triangles.some((tri, i) => Math.sign(area(points, tri)) !== signs[i])) { safe = .9 * lidMaxWiden * (step - 1) / 40; break; }
        }
        return (eye.foldFreeWiden = safe);
    }
    function paintWidenedEye(target, eye, context, closure) {
        const { rect, frames } = eye, [open, next] = frames, t = closure / next.closure;
        if (hasGaze(target, eye)) paintEyeInterior(target, eye, open.landmarks);
        const geometry = open.landmarks.map((point, i) => point.map((value, axis) => value + (next.landmarks[i][axis] - value) * t));
        // Warp the open eye as currently presented (including any gaze shift) to the lifted lid.
        const source = eye.warpTo.getContext('2d');
        source.clearRect(0, 0, rect.width, rect.height);
        source.drawImage(target.composite || target.canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
        warpBlinkPatch(eye.warpTo, open.landmarks, geometry, eye.warpFrom, eye.triangles);
        const mixed = eye.mixed.getContext('2d');
        mixed.clearRect(0, 0, eye.mixed.width, eye.mixed.height);
        mixed.globalCompositeOperation = 'source-over'; mixed.globalAlpha = 1;
        mixed.drawImage(eye.warpFrom, 0, 0);
        mixed.globalCompositeOperation = 'destination-in'; mixed.drawImage(eye.mask, 0, 0);
        mixed.globalCompositeOperation = 'source-over';
        context.drawImage(eye.mixed, rect.x, rect.y, rect.width, rect.height);
        eye.aperture = eyeAperture(eye, geometry);
    }

    function paintBlink(target, blinkClosure, deferPresent = false) {
        const blink = target.blink;
        if (!blink || !target.enabled) return;
        const context = (target.composite || target.canvas).getContext('2d');
        resetBrowRegion(target, context);
        for (const eye of blink.eyes) {
            const { rect, frames } = eye;
            context.clearRect(rect.x, rect.y, rect.width, rect.height);
            context.drawImage(target.base, rect.x, rect.y, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);
            eye.aperture = null;
            // A blink closes from wherever the brows hold the lid.
            const lid = lidClosure(target, eye), closure = blinkClosure + (1 - blinkClosure) * lid;
            if (closure < 0) { paintWidenedEye(target, eye, context, closure); continue; }
            if (closure <= 0) {
                if (hasGaze(target, eye)) paintEyeInterior(target, eye, eye.frames[0].landmarks);
                continue; // Exact approved open eyes between authored gaze shifts.
            }
            let index = 0;
            while (index + 1 < frames.length - 1 && closure > frames[index + 1].closure) index++;
            const from = frames[index], to = frames[index + 1];
            const blend = Math.max(0, Math.min(1, (closure - from.closure) / (to.closure - from.closure)));
            const geometry = from.landmarks.map((point, i) => point.map((value, axis) => value + (to.landmarks[i][axis] - value) * blend));
            const mixed = eye.mixed.getContext('2d');
            mixed.clearRect(0, 0, eye.mixed.width, eye.mixed.height);
            mixed.globalCompositeOperation = 'source-over'; mixed.globalAlpha = 1;
            if (blend === 0 || blend === 1) {
                // Exact authored keyframes need no mesh resampling, especially the closed hold.
                mixed.drawImage(blend === 0 ? from.patch : to.patch, 0, 0);
            } else {
                warpBlinkPatch(from.patch, from.landmarks, geometry, eye.warpFrom, eye.triangles);
                warpBlinkPatch(to.patch, to.landmarks, geometry, eye.warpTo, eye.triangles);
                mixed.globalAlpha = 1 - blend; mixed.drawImage(eye.warpFrom, 0, 0);
                mixed.globalCompositeOperation = 'lighter'; mixed.globalAlpha = blend;
                mixed.drawImage(eye.warpTo, 0, 0);
            }
            mixed.globalAlpha = 1; mixed.globalCompositeOperation = 'destination-in';
            mixed.drawImage(eye.mask, 0, 0); mixed.globalCompositeOperation = 'source-over';
            context.drawImage(eye.mixed, rect.x, rect.y, rect.width, rect.height);
            if (eye.apertureIndices && closure < .98) {
                paintEyeInterior(target, eye, geometry, closure);
            }
            blink.from = from.closure; blink.to = to.closure; blink.blend = blend;
        }
        blink.closure = blinkClosure;
        target.canvas.dataset.blinkClosure = String(blinkClosure);
        drawBrows(target, context);
        for (const eye of blink.eyes) if (eye.protectedPath) {
            // Restore straight from the original source, avoiding extra colour/alpha rounding.
            context.save(); context.translate(eye.rect.x, eye.rect.y); context.clip(eye.protectedPath);
            context.clearRect(0, 0, eye.rect.width, eye.rect.height);
            context.drawImage(target.base, eye.rect.x, eye.rect.y, eye.rect.width, eye.rect.height, 0, 0, eye.rect.width, eye.rect.height);
            context.restore();
        }
        if (deferPresent && target.breathing?.requestRender) target.breathing.requestRender();
        else target.breathing?.render();
    }

    async function prepareBrows(target) {
        if (!browsIndexUrl) return;
        try {
            const index = await fetchJson(browsIndexUrl);
            const url = index?.poses?.[target.poseKey];
            if (!validAssetUrl(url)) return;
            const config = await fetchJson(url);
            const sprite = target.sprite, rect = config.rect, count = config.frames?.[0]?.landmarks?.length;
            const inside = (r, w, h) => validRect(r) && r.x >= 0 && r.y >= 0 && r.x + r.width <= w && r.y + r.height <= h;
            const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
            const frames = Array.isArray(config.frames) ? config.frames : [];
            if (config.sourceWidth !== sprite.sourceWidth || config.sourceHeight !== sprite.sourceHeight ||
                !inside(rect, sprite.sourceWidth, sprite.sourceHeight) || (validRect(sprite.mouth) && overlaps(rect, sprite.mouth)) ||
                !validRect(config.maskRect) || frames.length < 2 || frames.length > 5 ||
                frames.filter(frame => frame.value === 0).length !== 1 ||
                frames.some((frame, i) => !Number.isFinite(frame.value) || frame.value < -1 || frame.value > 1 ||
                    (i && frame.value <= frames[i - 1].value) || (frame.value !== 0 && !validRect(frame.sourceRect)) ||
                    !Array.isArray(frame.landmarks) || frame.landmarks.length !== count ||
                    frame.landmarks.some(point => !Array.isArray(point) || point.length !== 2 || point.some(v => !Number.isFinite(v) || v < -.05 || v > 1.05))) ||
                !Number.isInteger(count) || count < 4 || count > 128 || !Array.isArray(config.triangles) || !config.triangles.length ||
                config.triangles.length > 256 || config.triangles.some(t => !Array.isArray(t) || t.length !== 3 ||
                    t.some(i => !Number.isInteger(i) || i < 0 || i >= count))) throw new Error('Invalid brow geometry');
            const atlas = await loadImage(config.image);
            if (surface !== target) return;
            let brows = cachedPose(target.cacheKey, sprite)?.brows;
            if (!brows) {
                const width = Math.round(rect.width), height = Math.round(rect.height);
                const built = frames.map(frame => {
                    const patch = makeCanvas(width, height), source = frame.value === 0 ? rect : frame.sourceRect;
                    patch.getContext('2d').drawImage(frame.value === 0 ? target.base : atlas, source.x, source.y, source.width, source.height, 0, 0, width, height);
                    return { value: frame.value, landmarks: frame.landmarks, patch };
                });
                const mask = makeCanvas(width, height), m = config.maskRect;
                mask.getContext('2d').drawImage(atlas, m.x, m.y, m.width, m.height, 0, 0, width, height);
                brows = { rect, triangles: config.triangles, frames: built, mask, raise: frames.some(f => f.value > 0), furrow: frames.some(f => f.value < 0),
                    warpFrom: makeCanvas(width, height), warpTo: makeCanvas(width, height), levels: new Map() };
                rememberPose(target.cacheKey, sprite, { brows });
            }
            target.brows = brows; target.browValue = browOverride ?? 0; target.browsDrawn = false;
            retainBrowLevels(brows); prewarmBrows(target);
            if (browOverride !== null) paintBrows(target);
        } catch (error) {
            if (surface === target) console.warn('[VNBrows] Keeping the original brows:', error.message);
        }
    }

    async function prepareBlink(target) {
        const config = target.sprite.blink;
        if (!config || !supportedCharacter(target.binding)) return;
        try {
            if (!config.image || !Array.isArray(config.eyes) || ![1, 2].includes(config.eyes.length)) throw new Error('One or two visible eye patches required');
            const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
            for (const eye of config.eyes) {
                if (!validRect(eye.rect) || eye.rect.x < 0 || eye.rect.y < 0 ||
                    eye.rect.x + eye.rect.width > target.sprite.sourceWidth || eye.rect.y + eye.rect.height > target.sprite.sourceHeight ||
                    !Array.isArray(eye.frames) || eye.frames.length < 2 || eye.frames.length > 5 ||
                    eye.frames[0].closure !== 0 || eye.frames.at(-1).closure !== 1 ||
                    (validRect(target.sprite.mouth) && overlaps(eye.rect, target.sprite.mouth))) throw new Error('Invalid blink frames');
                const count = eye.frames[0].landmarks?.length;
                if (!Number.isInteger(count) || count < 4 || count > 64 || !Array.isArray(eye.triangles) || !eye.triangles.length || eye.triangles.length > 256 ||
                    eye.triangles.some(triangle => !Array.isArray(triangle) || triangle.length !== 3 ||
                        triangle.some(index => !Number.isInteger(index) || index < 0 || index >= count))) throw new Error('Invalid blink mesh');
                if (eye.apertureIndices && (!Array.isArray(eye.apertureIndices) || eye.apertureIndices.length < 3 ||
                    eye.apertureIndices.length > count || new Set(eye.apertureIndices).size !== eye.apertureIndices.length ||
                    eye.apertureIndices.some(index => !Number.isInteger(index) || index < 0 || index >= count))) throw new Error('Invalid eye aperture');
                if (eye.maskPolygon && (!Array.isArray(eye.maskPolygon) || eye.maskPolygon.length < 3 || eye.maskPolygon.length > 32 ||
                    eye.maskPolygon.some(point => !Array.isArray(point) || point.length !== 2 ||
                        point.some(value => !Number.isFinite(value) || value < 0 || value > 1)))) throw new Error('Invalid eye mask');
                for (let i = 0; i < eye.frames.length; i++) {
                    const frame = eye.frames[i];
                    if (!Number.isFinite(frame.closure) || (i && frame.closure <= eye.frames[i - 1].closure) ||
                        (i && !validRect(frame.sourceRect)) || !Array.isArray(frame.landmarks) || frame.landmarks.length !== count ||
                        frame.landmarks.some(point => !Array.isArray(point) || point.length !== 2 ||
                            point.some(value => !Number.isFinite(value) || value < 0 || value > 1))) throw new Error('Invalid eyelid landmarks');
                }
            }
            if (config.eyes.length === 2 && overlaps(config.eyes[0].rect, config.eyes[1].rect)) throw new Error('Eye patches overlap');
            const atlas = await loadImage(config.image);
            if (surface !== target) return;
            const buildEye = eye => {
                const width = Math.round(eye.rect.width), height = Math.round(eye.rect.height);
                const frames = eye.frames.map(frame => {
                    const patch = makeCanvas(width, height), painter = patch.getContext('2d');
                    const source = frame.closure === 0 ? eye.rect : frame.sourceRect;
                    painter.drawImage(frame.closure === 0 ? target.base : atlas, source.x, source.y, source.width, source.height, 0, 0, width, height);
                    return { ...frame, patch };
                });
                const mask = makeCanvas(width, height), painter = readable(mask);
                const pixels = painter.getImageData(0, 0, width, height);
                const feather = Math.max(.01, Math.min(.3, eye.feather ?? .10));
                const polygon = eye.maskPolygon?.map(point => [point[0] * width, point[1] * height]);
                const polygonFeather = Math.max(.1, Math.min(8, eye.maskFeatherPixels ?? 1.5));
                for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                    let t;
                    if (polygon) {
                        // Static support mask keeps regenerated brow/cheek pixels out of the eye animation.
                        let inside = false, distance = Infinity;
                        const px = x + .5, py = y + .5;
                        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                            const [ax, ay] = polygon[j], [bx, by] = polygon[i];
                            if ((ay > py) !== (by > py) && px < (bx - ax) * (py - ay) / (by - ay) + ax) inside = !inside;
                            const dx = bx - ax, dy = by - ay;
                            const along = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
                            distance = Math.min(distance, Math.hypot(px - ax - along * dx, py - ay - along * dy));
                        }
                        t = inside ? Math.min(1, distance / polygonFeather) : 0;
                    } else {
                        const nx = Math.abs((x + .5 - width / 2) / (width / 2));
                        const ny = Math.abs((y + .5 - height / 2) / (height / 2));
                        const distance = Math.hypot(Math.max(nx - .88, 0), Math.max(ny - .88, 0)) + Math.min(Math.max(nx - .88, ny - .88), 0) - .12;
                        t = Math.max(0, Math.min(1, -distance / feather));
                    }
                    pixels.data[(y * width + x) * 4 + 3] = 255 * t * t * (3 - 2 * t);
                }
                painter.putImageData(pixels, 0, 0);
                let protectedPath;
                if (eye.protectedPolygons?.length) {
                    if (eye.protectedPolygons.some(polygon => !Array.isArray(polygon) || polygon.length < 3 || polygon.some(p => !Array.isArray(p) || p.length !== 2 || p.some(v => !Number.isFinite(v) || v < 0 || v > 1)))) throw new Error('Invalid protected eye foreground');
                    protectedPath = new Path2D();
                    const inside = (x, y) => eye.protectedPolygons.some(polygon => {
                        let hit = false;
                        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                            const a = polygon[i], b = polygon[j];
                            // Include boundary centres despite normalized-coordinate rounding.
                            const cross = (x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0]);
                            if (Math.abs(cross) < 1e-10 && x >= Math.min(a[0], b[0]) - 1e-10 && x <= Math.max(a[0], b[0]) + 1e-10 && y >= Math.min(a[1], b[1]) - 1e-10 && y <= Math.max(a[1], b[1]) + 1e-10) return true;
                            if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
                        }
                        return hit;
                    });
                    for (let y = 0; y < height; y++) {
                        let start = -1;
                        for (let x = 0; x <= width; x++) {
                            const hit = x < width && inside((x + .5) / width, (y + .5) / height);
                            if (hit && start < 0) start = x;
                            if (!hit && start >= 0) { protectedPath.rect(start, y, x - start, 1); start = -1; }
                        }
                    }
                }
                return { ...eye, frames, mask, protectedPath, warpFrom: makeCanvas(width, height), warpTo: makeCanvas(width, height), mixed: makeCanvas(width, height) };
            };
            let eyes = cachedPose(target.cacheKey, target.sprite)?.blinkEyes;
            if (!eyes) {
                eyes = [];
                for (const eye of config.eyes) {
                    await yieldToBrowser();
                    if (surface !== target) return;
                    eyes.push(buildEye(eye));
                }
                rememberPose(target.cacheKey, target.sprite, { blinkEyes: eyes });
            }
            // Each character gets its own blink rhythm: two faces loaded together never blink in step.
            const blink = target.blink = { eyes, seed: blinkSeed(target.binding.character, ++surfaceSequence), timer: 0, frame: 0, closure: 0, phase: 'open',
                motionQuery: window.matchMedia?.('(prefers-reduced-motion: reduce)') };
            blink.visibilityHandler = () => { pauseBlink(target); scheduleBlink(target); };
            document.addEventListener?.('visibilitychange', blink.visibilityHandler);
            blink.motionQuery?.addEventListener?.('change', blink.visibilityHandler);
            attachGaze(target);
            // A new speaker or expression "lands" with a blink, the classic cut-masking beat.
            // Swaps blink immediately to mask the cut; an entrance cued before the eyelids loaded blinks now.
            const swap = target.arrivalBlink === 'expression';
            const cued = !swap && Number.isFinite(target.pendingArrival) && blinkRandom(blink) < target.pendingArrival;
            scheduleBlink(target, swap ? 70 + blinkRandom(blink) * 110 : cued ? 40 : undefined);
        } catch (error) {
            if (surface === target) {
                if (!target.mouthEnabled) { restoreOriginal(target); target.failed = true; }
                console.warn('[VNLipSync] Keeping approved open eyes:', error.message);
            }
        }
    }
    function buildPatches(sprite, atlas, sourceImage) {
        const patches = new Map();
        const target = sprite.mouth;
        const width = Math.round(target.width);
        const height = Math.round(target.height);
        let originalPixels = null;
        if (sprite.colorMatch) {
            // Sampling may be prohibited for CDN art without CORS. It never taints the visible canvas.
            try {
                const sample = document.createElement('canvas');
                sample.width = width;
                sample.height = height;
                const context = readable(sample);
                context.drawImage(sourceImage, target.x, target.y, target.width, target.height, 0, 0, width, height);
                originalPixels = context.getImageData(0, 0, width, height).data;
            } catch { /* Keep the authored atlas colors when source sampling is unavailable. */ }
        }
        for (const [shape, rect] of Object.entries(sprite.frames || {})) {
            if (!validRect(rect)) continue;
            const patch = document.createElement('canvas');
            patch.width = width;
            patch.height = height;
            const context = readable(patch);
            if (shape === 'X' && sprite.originalRest === true) {
                // New cast poses use their complete original rest region; no repair
                // or ellipse edge may survive at an upturned resting lip corner.
                context.drawImage(sourceImage, target.x, target.y, target.width, target.height, 0, 0, width, height);
                patches.set(shape, patch);
                continue;
            }
            context.drawImage(atlas, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
            const pixels = context.getImageData(0, 0, width, height);
            const authoredOffset = rect.colorOffset || sprite.colorOffset;
            let offset = authoredOffset ? [authoredOffset.r || 0, authoredOffset.g || 0, authoredOffset.b || 0] : [0, 0, 0];
            if (originalPixels && !authoredOffset) {
                let count = 0;
                // Only upper/lower corners: avoid lipstick, teeth and the opening in the moving core.
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        if (!(x < width * .2 || x > width * .8) || !(y < height * .2 || y > height * .8)) continue;
                        const i = (y * width + x) * 4;
                        if (pixels.data[i + 3] < 240 || originalPixels[i + 3] < 240) continue;
                        for (let channel = 0; channel < 3; channel++) offset[channel] += originalPixels[i + channel] - pixels.data[i + channel];
                        count++;
                    }
                }
                offset = offset.map(value => count ? Math.max(-40, Math.min(40, value / count)) : 0);
            }
            const feather = Math.max(0, Math.min(.5, rect.feather ?? sprite.feather ?? .18));
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const i = (y * width + x) * 4;
                    for (let channel = 0; channel < 3; channel++) pixels.data[i + channel] += offset[channel];
                    const nx = Math.abs((x + .5 - width / 2) / (width / 2));
                    const ny = Math.abs((y + .5 - height / 2) / (height / 2));
                    const distance = sprite.patchMask === 'rounded-rectangle'
                        ? Math.hypot(Math.max(nx - .88, 0), Math.max(ny - .88, 0)) + Math.min(Math.max(nx - .88, ny - .88), 0) - .12
                        : Math.hypot(nx, ny) - 1;
                    const t = feather > 0 ? Math.max(0, Math.min(1, -distance / feather)) : Number(distance <= 0);
                    pixels.data[i + 3] *= t * t * (3 - 2 * t);
                }
            }
            context.putImageData(pixels, 0, 0);
            patches.set(shape, patch);
        }
        return patches;
    }

    // Eight fixed support points, eight outer lip points, eight inner lip points, and an inner center.
    const meshTriangles = [];
    for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 8; i++) {
        const a = ring * 8 + i, b = ring * 8 + (i + 1) % 8, c = a + 8, d = b + 8;
        meshTriangles.push([a, b, d], [a, d, c]);
    }
    for (let i = 0; i < 8; i++) meshTriangles.push([16 + i, 16 + (i + 1) % 8, 24]);

    function warpPatch(patch, points, geometry, buffer, triangles = meshTriangles) {
        const width = patch.width, height = patch.height;
        const context = buffer.getContext('2d');
        context.clearRect(0, 0, width, height);
        for (const indices of triangles) {
            const src = indices.map(i => [points[i][0] * width, points[i][1] * height]);
            const dst = indices.map(i => [geometry[i][0] * width, geometry[i][1] * height]);
            const [[x0, y0], [x1, y1], [x2, y2]] = src;
            const denominator = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
            if (Math.abs(denominator) < .00001) continue;
            const coefficient = axis => {
                const [z0, z1, z2] = dst.map(point => point[axis]);
                return [(z0 * (y1 - y2) + z1 * (y2 - y0) + z2 * (y0 - y1)) / denominator,
                    (z0 * (x2 - x1) + z1 * (x0 - x2) + z2 * (x1 - x0)) / denominator,
                    (z0 * (x1 * y2 - x2 * y1) + z1 * (x2 * y0 - x0 * y2) + z2 * (x0 * y1 - x1 * y0)) / denominator];
            };
            const [a, c, e] = coefficient(0), [b, d, f] = coefficient(1);
            const center = dst.reduce((sum, point) => [sum[0] + point[0] / 3, sum[1] + point[1] / 3], [0, 0]);
            context.save(); context.beginPath();
            // A subpixel overlap prevents anti-aliased clip seams between adjacent triangles.
            dst.forEach((point, index) => {
                const dx = point[0] - center[0], dy = point[1] - center[1];
                const length = Math.hypot(dx, dy) || 1;
                const x = point[0] + dx / length * .25, y = point[1] + dy / length * .25;
                if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
            });
            context.closePath(); context.clip(); context.setTransform(a, b, c, d, e, f);
            context.drawImage(patch, 0, 0); context.restore();
        }
    }

    function samplePose(cues, seconds) {
        let low = 0, high = cues.length - 1, index = -1;
        while (low <= high) {
            const middle = (low + high) >> 1, cue = cues[middle];
            if (seconds < cue.start) high = middle - 1;
            else if (seconds >= cue.end) low = middle + 1;
            else { index = middle; break; }
        }
        if (index < 0) return { from: 'X', to: 'X', blend: 0 };
        const cue = cues[index];
        const previous = index ? cues[index - 1] : { start: cue.start - .1, end: cue.start, value: 'X' };
        const next = index + 1 < cues.length ? cues[index + 1] : { start: cue.end, end: cue.end + .1, value: 'X' };
        const blendNear = (left, right, boundary) => {
            const half = Math.min(.04, (left.end - left.start) * .45, (right.end - right.start) * .45);
            if (left.value === right.value || half <= 0 || Math.abs(left.end - right.start) > .001 ||
                seconds < boundary - half || seconds > boundary + half) return null;
            const t = (seconds - boundary + half) / (2 * half);
            return { from: left.value, to: right.value, blend: t * t * (3 - 2 * t) };
        };
        // Finish a clipped final syllable with a one-sided closure that reaches rest at the audio end.
        // Centering this transition on the end would leave a half-open mouth for onend to snap shut.
        if (index === cues.length - 1 && cue.value !== 'X') {
            const window = Math.min(.08, (cue.end - cue.start) * .9);
            if (seconds >= cue.end - window) {
                const t = Math.max(0, Math.min(1, (seconds - cue.end + window) / window));
                return { from: cue.value, to: 'X', blend: t * t * (3 - 2 * t) };
            }
        }
        // Anticipate each boundary instead of chasing the last frame; seeking is deterministic.
        return blendNear(previous, cue, cue.start) || blendNear(cue, next, cue.end) ||
            { from: cue.value, to: cue.value, blend: 0 };
    }

    // How far each mouth shape opens, from its own inner-lip landmarks: 0 for the most closed shape,
    // 1 for the widest. The jaw (vnSpriteMotion) drops by this amount, so lips and chin move together.
    const mouthOpenings = new WeakMap();
    function mouthOpenness(sprite, shape) {
        if (shape === 'X') return 0;
        let table = mouthOpenings.get(sprite);
        if (!table) {
            const gaps = Object.entries(sprite.frames || {}).filter(([name, frame]) => name !== 'X' && frame?.landmarks?.length > 22)
                .map(([name, frame]) => [name, frame.landmarks[22][1] - frame.landmarks[18][1]]);
            const values = gaps.map(([, gap]) => gap), min = Math.min(...values), span = Math.max(...values) - min;
            table = Object.fromEntries(gaps.map(([name, gap]) => [name, span > 0 ? (gap - min) / span : 0]));
            mouthOpenings.set(sprite, table);
        }
        return table[shape] || 0;
    }

    // What each Rhubarb shape does to the cheeks and lips: B (ee, most consonants) and C (eh) widen,
    // D (ah) pulls in slightly as the jaw opens, E (oh) and F (oo, w) narrow and push the lips forward.
    const shapeCheeks = { A: [0, 0], B: [1, 0], C: [.6, 0], D: [-.3, 0], E: [-.6, .5], F: [-1, 1], X: [0, 0] };
    function mouthMotion(sprite, from, to, blend) {
        const mix = (a, b) => a + (b - a) * blend, [fromStretch, fromPush] = shapeCheeks[from] || [0, 0], [toStretch, toPush] = shapeCheeks[to] || [0, 0];
        const motion = { jaw: mix(mouthOpenness(sprite, from), mouthOpenness(sprite, to)), cheekStretch: mix(fromStretch, toStretch), lipPush: mix(fromPush, toPush) };
        return motion.jaw || motion.cheekStretch || motion.lipPush ? motion : null;
    }

    function paint(target, pose) {
        if (!target.ready) return;
        if (!target.mouthEnabled) {
            if (!target.enabled) {
                const context = (target.composite || target.canvas).getContext('2d');
                context.clearRect(0, 0, target.canvas.width, target.canvas.height);
                context.drawImage(target.base, 0, 0);
                target.canvas.style.visibility = 'visible'; target.image.style.visibility = 'hidden'; target.enabled = true;
                target.canvas.dataset.mouthShape = 'X'; target.canvas.dataset.baseReady = 'true';
                if (target.blink) { paintBlink(target, target.blink.closure); scheduleBlink(target); }
                target.breathing?.render(); target.life?.sync();
            }
            return;
        }
        const semanticFrom = pose.from, semanticTo = pose.to;
        const from = semanticFrom === 'X' ? (target.sprite.restShape || 'X') : semanticFrom;
        const to = semanticTo === 'X' ? (target.sprite.restShape || 'X') : semanticTo;
        const { blend } = pose;
        if (target.enabled && target.pose?.from === pose.from && target.pose?.to === pose.to && target.pose?.blend === blend) return;
        const fromPatch = target.patches.get(from), toPatch = target.patches.get(to);
        if (!fromPatch || !toPatch) { restoreOriginal(target); return; }
        const sprite = target.sprite, mouth = sprite.mouth, context = (target.composite || target.canvas).getContext('2d');
        const restoreEyes = !target.enabled;
        const fromPoints = sprite.frames[from].landmarks, toPoints = sprite.frames[to].landmarks;
        const geometry = fromPoints.map((point, i) => [point[0] + (toPoints[i][0] - point[0]) * blend,
            point[1] + (toPoints[i][1] - point[1]) * blend]);
        if (!target.enabled) {
            context.clearRect(0, 0, target.canvas.width, target.canvas.height);
            context.drawImage(target.base, 0, 0);
        } else {
            context.clearRect(mouth.x - 1, mouth.y - 1, mouth.width + 2, mouth.height + 2);
            context.drawImage(target.base, mouth.x - 1, mouth.y - 1, mouth.width + 2, mouth.height + 2,
                mouth.x - 1, mouth.y - 1, mouth.width + 2, mouth.height + 2);
        }
        let patch = fromPatch;
        if (from !== to && blend > .001 && blend < .999) {
            warpPatch(fromPatch, fromPoints, geometry, target.warpFrom, sprite.meshTriangles);
            warpPatch(toPatch, toPoints, geometry, target.warpTo, sprite.meshTriangles);
            const mixed = target.mixed.getContext('2d');
            mixed.clearRect(0, 0, target.mixed.width, target.mixed.height);
            mixed.globalCompositeOperation = 'source-over'; mixed.globalAlpha = 1 - blend;
            mixed.drawImage(target.warpFrom, 0, 0);
            // Add premultiplied colors: ordinary source-over would expose the skin between two half-alpha patches.
            mixed.globalCompositeOperation = 'lighter'; mixed.globalAlpha = blend;
            mixed.drawImage(target.warpTo, 0, 0); mixed.globalAlpha = 1; mixed.globalCompositeOperation = 'source-over';
            patch = target.mixed;
        } else if (blend >= .999) patch = toPatch;
        // Exact rest is a complete source crop. Replacing the healed base avoids
        // increasing alpha (and changing colors) for portraits with translucent pixels.
        if (sprite.originalRest === true && patch === target.patches.get('X'))
            context.clearRect(mouth.x, mouth.y, mouth.width, mouth.height);
        context.drawImage(patch, mouth.x, mouth.y, mouth.width, mouth.height);
        target.canvas.style.visibility = 'visible'; target.image.style.visibility = 'hidden'; target.enabled = true;
        target.canvas.dataset.mouthShape = blend >= .5 ? semanticTo : semanticFrom;
        target.canvas.dataset.mouthBlend = String(blend);
        target.canvas.dataset.baseReady = 'true';
        target.pose = pose; target.geometry = geometry;
        target.mouthMotion = mouthMotion(sprite, semanticFrom, semanticTo, blend);
        if (restoreEyes && target.blink) { paintBlink(target, target.blink.closure); scheduleBlink(target); }
        target.breathing?.render();
        if (restoreEyes) target.life?.sync();
    }

    function makeHealedBase(sprite, original, healed) {
        const base = makeCanvas(sprite.sourceWidth, sprite.sourceHeight), context = base.getContext('2d');
        context.drawImage(original, 0, 0, sprite.sourceWidth, sprite.sourceHeight);
        const rect = sprite.baseRect || sprite.mouth;
        const patch = makeCanvas(Math.round(rect.width), Math.round(rect.height)), painter = readable(patch);
        const scaleX = (healed.naturalWidth || sprite.sourceWidth) / sprite.sourceWidth;
        const scaleY = (healed.naturalHeight || sprite.sourceHeight) / sprite.sourceHeight;
        const input = sprite.baseSourceRect || { x: rect.x * scaleX, y: rect.y * scaleY, width: rect.width * scaleX, height: rect.height * scaleY };
        painter.drawImage(healed, input.x, input.y, input.width, input.height, 0, 0, patch.width, patch.height);
        const pixels = painter.getImageData(0, 0, patch.width, patch.height);
        const feather = Math.max(.01, Math.min(.5, sprite.baseFeather ?? .15));
        const offset = sprite.baseColorOffset || { r: 0, g: 0, b: 0 };
        for (let y = 0; y < patch.height; y++) for (let x = 0; x < patch.width; x++) {
            const nx = Math.abs((x + .5 - patch.width / 2) / (patch.width / 2));
            const ny = Math.abs((y + .5 - patch.height / 2) / (patch.height / 2));
            // A small rounded-box perimeter preserves the opaque repair at off-center smile corners.
            // An ellipse can expose those original lips even when they are well inside the crop.
            const distance = sprite.baseMask === 'rounded-rectangle'
                ? Math.hypot(Math.max(nx - .88, 0), Math.max(ny - .88, 0)) + Math.min(Math.max(nx - .88, ny - .88), 0) - .12
                : Math.hypot(nx, ny) - 1;
            const t = Math.max(0, Math.min(1, -distance / feather));
            const i = (y * patch.width + x) * 4;
            pixels.data[i] += offset.r; pixels.data[i + 1] += offset.g; pixels.data[i + 2] += offset.b;
            pixels.data[i + 3] *= t * t * (3 - 2 * t);
        }
        painter.putImageData(pixels, 0, 0); context.drawImage(patch, rect.x, rect.y, rect.width, rect.height);
        return base;
    }

    async function prepareSurface(target) {
        try {
            const manifest = await fetchJson(manifestUrl);
            if (surface !== target) return;
            const sprite = manifest.sprites?.[target.layer.dataset.vnPoseKey || spriteKey(target.image.getAttribute('src'))];
            if (!(sprite?.sourceWidth > 0 && sprite.sourceHeight > 0)) throw new Error('Character animation dimensions unavailable');
            target.mouthEnabled = supportedCharacter(target.binding) && validRect(sprite.mouth);
            if (!target.mouthEnabled && !sprite.blink) throw new Error('Blink artwork unavailable');
            const validMesh = !sprite?.meshTriangles || (Array.isArray(sprite.meshTriangles) && sprite.meshTriangles.length === 40 &&
                sprite.meshTriangles.every(triangle => Array.isArray(triangle) && triangle.length === 3 &&
                    triangle.every(index => Number.isInteger(index) && index >= 0 && index < 25)));
            if (target.mouthEnabled && (!validMesh || !sprite?.baseImage || !validRect(sprite.mouth) ||
                (sprite.baseRect && !validRect(sprite.baseRect)) || (sprite.baseSourceRect && !validRect(sprite.baseSourceRect)) ||
                !['A', 'B', 'C', 'D', 'E', 'F', 'X'].every(shape => validRect(sprite.frames?.[shape]) && validLandmarks(sprite.frames[shape].landmarks)))) {
                throw new Error('Incomplete healed base or mouth geometry');
            }
            target.poseKey = target.layer.dataset.vnPoseKey || spriteKey(target.image.getAttribute('src'));
            // Optional rigs must be complete and match this portrait; never borrow another
            // pose's geometry. Missing optional assets preserve the approved facial renderer.
            let reference = null;
            try {
                const rig = await fetchJson(sprite.performanceRig);
                if (!validRig(rig, sprite))
                    throw new Error('Pose rig unavailable or mismatched');
                reference = await loadImage(rig.referenceImage);
                target.rig = rig;
            } catch { /* Facial artwork remains available without optional motion assets. */ }
            if (surface !== target) return;
            target.performanceSupported = !!target.rig;
            // Same-origin, byte-identical references keep the completed canvas GPU-safe
            // even when the displayed /images URL redirects to production Blob storage.
            const assets = target.mouthEnabled ? await Promise.all([
                loadImage(sprite.image), loadImage(sprite.baseImage),
                reference || (sprite.baseReferenceImage ? loadImage(sprite.baseReferenceImage) : target.image)
            ]) : null;
            if (target.image.decode) await target.image.decode().catch(() => {});
            if (surface !== target) return;
            target.sprite = sprite;
            target.cacheKey = `${target.poseKey}:${target.mouthEnabled}`;
            const cached = cachedPose(target.cacheKey, sprite);
            if (cached?.base) {
                Object.assign(target, { base: cached.base, patches: cached.patches, warpFrom: cached.warpFrom, warpTo: cached.warpTo, mixed: cached.mixed });
            } else if (target.mouthEnabled) {
                const [atlas, healed, reference] = assets;
                target.patches = buildPatches(sprite, atlas, reference);
                if (!target.patches.has('X')) throw new Error('Rest mouth unavailable');
                await yieldToBrowser();
                if (surface !== target) return;
                target.base = makeHealedBase(sprite, reference, healed);
                target.warpFrom = makeCanvas(Math.round(sprite.mouth.width), Math.round(sprite.mouth.height));
                target.warpTo = makeCanvas(target.warpFrom.width, target.warpFrom.height);
                target.mixed = makeCanvas(target.warpFrom.width, target.warpFrom.height);
            } else {
                // Poses without authored mouth artwork retain their complete original expression.
                target.base = makeCanvas(sprite.sourceWidth, sprite.sourceHeight);
                target.base.getContext('2d').drawImage(reference || target.image, 0, 0, sprite.sourceWidth, sprite.sourceHeight);
            }
            if (!cached?.base) rememberPose(target.cacheKey, sprite,
                { base: target.base, patches: target.patches, warpFrom: target.warpFrom, warpTo: target.warpTo, mixed: target.mixed });
            target.canvas.width = sprite.sourceWidth; target.canvas.height = sprite.sourceHeight;
            target.canvas.style.filter = window.getComputedStyle ? window.getComputedStyle(target.image).filter : '';
            // Per-pose rigs keep the face rigid while the torso and secondary regions move.
            // Facial compositing stays in source coordinates; only the final torso presentation deforms.
            if (target.performanceSupported && vnBreathing) {
                target.composite = makeCanvas(sprite.sourceWidth, sprite.sourceHeight);
                target.breathingCanvas = makeCanvas(sprite.sourceWidth, sprite.sourceHeight);
                target.motion = vnSpriteMotion?.create();
                target.breathing = vnBreathing.create(target.composite, target.breathingCanvas, {
                    rig: target.rig.breathing,
                    seed: String(target.binding.character).toLowerCase(),
                    onRender: () => presentPerformance(target),
                    isEnabled: () => surface === target && target.enabled && !target.blockedByVoice && target.canvas.isConnected !== false
                });
                target.breathing.setEnabled(breathingEnabled);
                if (vnLife) target.life = vnLife.create({
                    seed: String(target.binding.character).toLowerCase(), variation: surfaceSequence,
                    gaze: typeof target.rig.gaze === 'string',
                    isEnabled: () => lifeEnabled && surface === target && target.enabled && !target.blockedByVoice && target.canvas.isConnected !== false,
                    getSpeechEnergy: () => target.speechEnergy || 0,
                    getBrows: () => target.brows && { raise: target.brows.raise, furrow: target.brows.furrow },
                    getTone: () => target.layer?.dataset?.vnLineTone || '',
                    onSaccade: () => { if (blinkRandom(target.blink || { seed: 1 }) < .5) contextBlink(target); },
                    onChange: pose => {
                        const old = target.lifePose; target.lifePose = pose;
                        const brow = target.brows ? browOverride ?? (presentedPose(target).brow || 0) : 0;
                        const browMoved = !!target.brows && browLevel(brow) !== browLevel(target.browValue || 0);
                        if (target.brows) target.browValue = brow;
                        if (browMoved) paintBrows(target);
                        else if (target.blink && target.gaze && (old?.gazeX !== pose.gazeX || old?.gazeY !== pose.gazeY)) paintBlink(target, target.blink.closure);
                        else if (target.breathing?.requestRender) target.breathing.requestRender();
                        else target.breathing?.render();
                    }
                });
            }
            target.ready = true; positionCanvas(target);
            target.resizeHandler = () => positionCanvas(target);
            window.addEventListener('resize', target.resizeHandler);
            if (typeof ResizeObserver !== 'undefined') {
                target.resizeObserver = new ResizeObserver(target.resizeHandler);
                target.resizeObserver.observe(target.image);
                if (target.image.parentElement) target.resizeObserver.observe(target.image.parentElement);
            }
            if (!target.blockedByVoice) paint(target, { from: mouthShapeOverride || 'X', to: mouthShapeOverride || 'X', blend: 0 });
            void prepareBlink(target).then(() => prepareBrows(target));
            if (target.performanceSupported) { void preparePerformance(target); void prepareGaze(target); }
        } catch (error) {
            if (surface !== target) return;
            restoreOriginal(target); target.failed = true; status.state = 'static:asset-error';
            console.warn('[VNLipSync] Using original character art:', error.message);
        }
    }

    function refresh() {
        loadLighting();
        const layer = root.matches('.vne-portrait-layer[data-vn-lipsync-dialogue]') ? root : root.querySelector('.vne-portrait-layer[data-vn-lipsync-dialogue]');
        const binding = layer && { scene: layer.dataset.vnLipsyncScene, character: layer.dataset.vnLipsyncCharacter };
        const canvas = layer?.querySelector('.vne-portrait-canvas'), image = layer?.querySelector('img.vne-portrait-image');
        if (!supportedCharacter(binding) || !canvas || !image) { disposeSurface(); return; }
        const identity = `${binding.scene}:${binding.character}:${image.getAttribute('src')}`;
        if (surface?.canvas === canvas && surface.identity === identity && (!surface.failed || surface.dialogue === layer.dataset.vnLipsyncDialogue)) return;
        const previous = surface?.binding;
        disposeSurface();
        const target = { canvas, image, layer, identity, binding, dialogue: layer.dataset.vnLipsyncDialogue, originalVisibility: image.style.visibility,
            ready: false, enabled: false,
            arrivalBlink: previous?.character === binding.character && previous?.scene === binding.scene ? 'expression' : false };
        surface = target; void prepareSurface(target);
    }

    async function prepareVoice(state) {
        try {
            const index = state.cueUrl ? null : await fetchJson(speechIndexUrl);
            if (active !== state) return;
            const cueUrl = state.cueUrl || index?.lines?.[audioKey(state.src)];
            if (!validCueUrl(cueUrl)) throw new Error('Voice cues unavailable');
            state.cueUrl = cueUrl;
            const data = await fetchJson(cueUrl);
            if (active !== state) return;
            if (!Array.isArray(data.mouthCues) || !data.mouthCues.length || data.mouthCues.some((cue, index, cues) =>
                !Number.isFinite(cue.start) || cue.start < 0 || !Number.isFinite(cue.end) || cue.end <= cue.start || !/^[A-FX]$/.test(cue.value) ||
                (index > 0 && cue.start < cues[index - 1].end))) throw new Error('Invalid mouth cue timeline');
            if (data.metadata?.soundFile && audioKey(data.metadata.soundFile) !== audioKey(state.src))
                throw new Error('Mouth cues do not match the current recording');
            state.cues = [];
            state.speechState = 'ready';
            for (const cue of data.mouthCues) {
                const last = state.cues.at(-1);
                if (last?.value === cue.value && Math.abs(last.end - cue.start) < .001) last.end = cue.end;
                else state.cues.push({ ...cue });
            }
        } catch (error) {
            if (active !== state) return;
            // Missing speech data is independent of voice playback and optional acting.
            // Keep the complete expression-specific rest mouth; never borrow another line.
            state.cues = null; state.speechState = 'unavailable';
            console.warn('[VNLipSync] Keeping the rest mouth:', error.message);
        }
    }

    // Internal silences in the recording: sometimes glance away to "think", sometimes blink.
    function punctuatePause(target, state, seconds) {
        const cues = state.cues;
        let index = -1;
        for (let low = 0, high = cues.length - 1; low <= high;) {
            const middle = (low + high) >> 1;
            if (seconds < cues[middle].start) high = middle - 1;
            else if (seconds >= cues[middle].end) low = middle + 1;
            else { index = middle; break; }
        }
        const cue = cues[index];
        if (!cue || cue.value !== 'X' || index === 0 || index === cues.length - 1 || state.pauseIndex === index) return;
        const remaining = cue.end - seconds;
        if (cue.end - cue.start < .35 || remaining < .25) return;
        state.pauseIndex = index;
        const roll = ((Math.imul(index + 1, 2654435761) ^ Math.imul(String(state.src).length, 40503)) >>> 0) / 4294967296;
        const authoredGaze = target.performanceLines?.[audioKey(state.src)]?.gaze?.length > 0;
        if (!authoredGaze && roll < .55) target.life?.lookAway((remaining - .12) * 1000);
        if ((roll * 7.31) % 1 < .5) contextBlink(target);
    }

    function tick() {
        const state = active;
        if (!state) return;
        if (!state.howl.playing(state.soundId)) { stop(); return; }
        refresh();
        const layer = surface?.layer;
        const matches = layer && layer.dataset.vnLipsyncScene === state.binding.scene &&
            layer.dataset.vnLipsyncCharacter.toLowerCase() === state.binding.character.toLowerCase() &&
            layer.dataset.vnLipsyncDialogue === String(state.binding.dialogue);
        if (!matches && state.attached) { stop('static:speaker-changed'); return; }
        if (matches) state.attached = true;
        if (surface?.canvas.isConnected === false) { dispose(); return; }
        if (surface?.ready && matches) {
            const seconds = Number(state.howl.seek(state.soundId));
            const audible = state.howl.volume() > 0;
            const animating = surface.mouthEnabled && state.cues && (mouthAnimationOverride ?? audible) && Number.isFinite(seconds);
            const pose = mouthShapeOverride ? { from: mouthShapeOverride, to: mouthShapeOverride, blend: 0 } : animating ? samplePose(state.cues, seconds) : { from: 'X', to: 'X', blend: 0 };
            paint(surface, pose);
            surface.speechEnergy = vnLife ? vnLife.speechEnergy(pose) : 0;
            if (animating) punctuatePause(surface, state, seconds);
            status = { state: 'playing', source: basename(state.src), character: state.binding.character,
                dialogue: state.binding.dialogue, position: seconds, shape: surface.canvas.dataset.mouthShape,
                fromShape: pose.from, toShape: pose.to, blend: pose.blend, rest: pose.from === 'X' && pose.to === 'X' };
        }
        if (active === state) frame = requestAnimationFrame(tick);
    }

    function start(howl, soundId, src, binding, cueUrl) {
        stop();
        if (!supportedCharacter(binding)) return;
        const state = { howl, soundId, src, cueUrl, speechState: 'loading', binding: { ...binding } }; active = state;
        status = { state: 'loading', source: basename(src), character: binding.character,
            dialogue: binding.dialogue, shape: 'X', position: 0, rest: true };
        refresh(); if (surface) { surface.blockedByVoice = false; scheduleBlink(surface); surface.performance?.sync(); surface.life?.sync(); }
        void prepareVoice(state); frame = requestAnimationFrame(tick);
    }
    function preload() {
        vnSpriteMotion?.preload();
        loadLighting();
        void fetchJson(speechIndexUrl).catch(() => {});

        // Keep the larger cast lazy: the active portrait loads its own local patches.

        void fetchJson(manifestUrl).then(manifest => Promise.allSettled(
            [...new Set(Object.values(manifest.sprites || {}).flatMap(sprite => [sprite.image, sprite.baseImage, sprite.baseReferenceImage, sprite.blink?.image]).filter(Boolean))].map(loadImage)
        )).catch(() => {});
    }
    // Fetch and decode a pose's animation assets ahead of its entrance, during idle time.
    const prefetched = new Set();
    async function prefetchPose(item) {
        const binding = { character: String(item?.character || '') }, src = String(item?.src || '');
        const key = spriteKey(src);
        if (!src || !supportedCharacter(binding) || prefetched.has(key)) return;
        prefetched.add(key);
        try {
            const manifest = await fetchJson(manifestUrl);
            const sprite = manifest.sprites?.[key];
            if (!sprite) return;
            // The displayed portrait itself too: surface preparation waits for it to decode.
            const urls = [src, sprite.image, sprite.baseImage, sprite.baseReferenceImage, sprite.blink?.image];
            try {
                const rig = await fetchJson(sprite.performanceRig);
                urls.push(rig.referenceImage);
                if (typeof rig.gaze === 'string') urls.push((await fetchJson(rig.gaze)).image);
            } catch { /* Optional motion assets. */ }
            // One image per idle period: parallel decodes of large portraits starved frame production.
            for (const url of urls) if (typeof url === 'string') prefetchQueue.push(() => loadImage(url));
            pumpPrefetch();
        } catch { prefetched.delete(key); }
    }
    const prefetchQueue = [];
    let prefetchBusy = false;
    const whenIdle = callback => typeof requestIdleCallback === 'function' ? requestIdleCallback(callback, { timeout: 2000 }) : setTimeout(callback, 150);
    function pumpPrefetch() {
        if (prefetchBusy || !prefetchQueue.length) return;
        prefetchBusy = true;
        whenIdle(() => Promise.resolve().then(prefetchQueue.shift()).catch(() => {}).then(() => { prefetchBusy = false; pumpPrefetch(); }));
    }
    function prefetch(items) {
        if (!Array.isArray(items)) return;
        whenIdle(() => items.slice(0, 4).forEach(item => void prefetchPose(item)));
    }
    function setBreathingEnabled(enabled) {
        breathingEnabled = !!enabled;
        surface?.breathing?.setEnabled(breathingEnabled);
    }
    // Called by the stage when a speaker entrance visibly lands, so the blink never races the slide-in.
    function cueArrivalBlink(chance = 1) {
        const target = surface;
        if (!target || target.arrivalBlink === 'expression') return false;
        if (!target.blink) { target.pendingArrival = chance; return false; }
        return blinkRandom(target.blink) < chance && contextBlink(target, 0);
    }
    // Inspection: hold the brows at a value in [-1, 1] (furrow..raise); null returns to live acting.
    function setBrowOverride(value) {
        browOverride = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : null;
        if (!surface?.brows) return false;
        surface.browValue = browOverride ?? (surface.lifePose?.brow || 0);
        paintBrows(surface);
        return true;
    }
    function setLifeEnabled(enabled) {
        lifeEnabled = !!enabled;
        surface?.life?.setEnabled(lifeEnabled);
    }
    function setMotionEnabled(value) {
        for (const key of Object.keys(motionEnabled)) if (typeof value?.[key] === 'boolean') motionEnabled[key] = value[key];
        surface?.performance?.setEnabled(motionEnabled);
        if (surface?.blink) paintBlink(surface, surface.blink.closure);
        surface?.breathing?.render();
    }
    return { start, stop, stopTrack, dispose, refresh, preload, setMouthShape, setBlinkEnabled, setMouthAnimationOverride, getMouthAnimationOverride: () => mouthAnimationOverride, setBreathingEnabled, setMotionEnabled, setLifeEnabled, setLightingEnabled, setBrowOverride, cueArrivalBlink, whenReady, prefetch, triggerBlink: () => beginBlink(surface), getStatus: () => ({ ...status, shape: surface?.canvas.dataset.mouthShape || status.shape, active: !!active,
        mouthAnimationOverride, poseKey: surface?.poseKey || null, performanceReady: !!surface?.performance, audioSource: active ? audioKey(active.src) : null,
        baseReady: !!surface?.ready && !!surface.enabled, mouthEnabled: !!surface?.mouthEnabled,
        speechState: active?.speechState || 'idle', cueUrl: active?.cueUrl || null,
        geometry: surface?.geometry?.map(point => [...point]) || null,
        breathingEnabled, breathing: surface?.breathing?.getStatus() || null,
        lifeEnabled, life: surface?.life?.getStatus() || null,
        lightingEnabled, lighting: lighting.current ? { background: lighting.background, ...lighting.current } : null,
        performance: surface?.performance?.getStatus() || null, gazeReady: !!surface?.gaze, motion: surface?.motion?.getStatus() || null,
        browsReady: !!surface?.brows, browValue: surface?.browValue || 0, jaw: surface?.mouthMotion?.jaw || 0, mouthMotion: surface?.mouthMotion ? { ...surface.mouthMotion } : null,
        blinkEnabled, blinkReady: !!surface?.blink, blinkClosure: surface?.blink?.closure || 0,
        blinkPhase: surface?.blink?.phase || 'open', blinkFrom: surface?.blink?.from ?? 0,
        blinkTo: surface?.blink?.to ?? 0, blinkBlend: surface?.blink?.blend ?? 0,
        blinkApertures: surface?.blink?.eyes.map(eye => eye.aperture?.map(point => [...point]) || null) || null }) };
}
