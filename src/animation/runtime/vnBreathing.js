// Adapted from the original character animation runtime. Artwork is provided separately by local packs.
// Optional lower-torso motion; the source canvas remains the untouched facial-animation composite.
export const vnBreathing = (() => {
    'use strict';

    function create(sourceCanvas, visibleCanvas, options = {}) {
        if (sourceCanvas === visibleCanvas) throw new Error('Breathing requires separate source and visible canvases');
        const context = visibleCanvas.getContext('2d');
        if (!context) throw new Error('Breathing canvas is unavailable');
        const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        const value = (candidate, fallback, maximum) => Number.isFinite(candidate) ? Math.max(0, Math.min(maximum, candidate)) : fallback;
        const fixedTopNative = value(options.rig?.fixedTop, 720, 1000);
        const verticalNative = Math.min(value(options.rig?.vertical, 5, 8), (1023 - fixedTopNative) * .25);
        const horizontalNative = value(options.rig?.horizontal, 2, 4);
        // Breathing follows one clock per character, so two expressions of the same character
        // (for example during an expression morph) always breathe in step.
        const offset = Array.from(String(options.seed || '')).reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) % 5000, 0);
        let enabled = true, disposed = false, frame = 0, started = null, wasAllowed = false;
        let state = { phase: 'rest', amount: 0, cycleMs: 0 };

        function allowed() {
            return enabled && !disposed && !document.hidden && !motionQuery?.matches &&
                (typeof options.isEnabled !== 'function' || options.isEnabled());
        }
        function sizeCanvas() {
            if (visibleCanvas.width !== sourceCanvas.width) visibleCanvas.width = sourceCanvas.width;
            if (visibleCanvas.height !== sourceCanvas.height) visibleCanvas.height = sourceCanvas.height;
            return { width: sourceCanvas.width, height: sourceCanvas.height };
        }
        function copySource(width, height) {
            context.clearRect(0, 0, width, height);
            if (width > 0 && height > 0) context.drawImage(sourceCanvas, 0, 0);
        }
        function reset() {
            cancelAnimationFrame(frame); frame = 0; started = null;
            state = { phase: 'rest', amount: 0, cycleMs: 0 };
        }
        function paint(now) {
            if (disposed) return;
            const { width, height } = sizeCanvas();
            if (!allowed() || width <= 0 || height <= 0) {
                reset(); copySource(width, height); options.onRender?.(); return;
            }
            // Resuming after a pause eases in instead of jumping to the shared phase.
            if (started === null) started = wasAllowed || options.seed === undefined ? now : -Infinity;
            wasAllowed = true;
            const cycleMs = (now + offset) % 5000;
            const inhaling = cycleMs < 2000;
            const fade = Math.min(1, Math.max(0, (now - started) / 600));
            const amount = (inhaling
                ? .5 - .5 * Math.cos(Math.PI * cycleMs / 2000)
                : .5 + .5 * Math.cos(Math.PI * (cycleMs - 2000) / 3000)) * (fade * fade * (3 - 2 * fade));
            state = { phase: amount === 0 ? 'rest' : inhaling ? 'inhale' : 'exhale', amount, cycleMs };
            if (amount === 0) copySource(width, height);
            else {
                const fixedTop = Math.round(height * fixedTopNative / 1024), movingHeight = Math.max(1, height - fixedTop - 1);
                const vertical = verticalNative * height / 1024 * amount;
                const horizontal = horizontalNative * width / 1024 * amount;
                const envelope = y => Math.sin(Math.PI * Math.max(0, Math.min(1, (y - fixedTop) / movingHeight)));
                const sourceY = y => y + vertical * envelope(y);
                context.clearRect(0, 0, width, height);
                // Exact 1:1 copy above the torso; eyes, mouth, face and hair remain fixed.
                context.drawImage(sourceCanvas, 0, 0, width, fixedTop, 0, 0, width, fixedTop);
                for (let y = fixedTop; y < height - 1; y++) {
                    const expansion = horizontal * envelope(y + .5);
                    const sampleWidth = width / (1 + 2 * expansion / width);
                    const top = sourceY(y), bottom = sourceY(y + 1);
                    // Inverse sampling integrates each full source-row interval into one aligned pixel row.
                    // Adjacent destination rows never overlap or leave a transparent triangle seam.
                    context.drawImage(sourceCanvas, (width - sampleWidth) / 2, top, sampleWidth, bottom - top,
                        0, y, width, 1);
                }
                context.drawImage(sourceCanvas, 0, height - 1, width, 1, 0, height - 1, width, 1);
            }
            options.onRender?.();
            if (!frame) frame = requestAnimationFrame(timestamp => { frame = 0; paint(timestamp); });
        }
        function render() { paint(performance.now()); }
        // Coalesce per-frame pose updates from other layers into this layer's next paint.
        function requestRender() {
            if (!disposed && !frame) frame = requestAnimationFrame(timestamp => { frame = 0; paint(timestamp); });
        }
        function setEnabled(value) {
            enabled = Boolean(value);
            render();
        }
        function dispose() {
            if (disposed) return;
            reset();
            const { width, height } = sizeCanvas(); copySource(width, height); options.onRender?.();
            disposed = true;
            document.removeEventListener('visibilitychange', render);
            motionQuery?.removeEventListener?.('change', render);
        }
        document.addEventListener('visibilitychange', render);
        motionQuery?.addEventListener?.('change', render);
        render();
        return { render, requestRender, setEnabled, dispose, getStatus: () => ({ ...state, enabled: allowed(), running: !!frame,
            verticalPixels: state.amount * verticalNative * sourceCanvas.height / 1024,
            horizontalPixels: state.amount * horizontalNative * sourceCanvas.width / 1024 }) };
    }

    return { create };
})();
