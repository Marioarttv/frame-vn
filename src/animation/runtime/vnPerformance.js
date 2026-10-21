// Adapted from the original character animation runtime. Artwork is provided separately by local packs.
// Sparse authored acting, sampled from local voice time rather than looping idle head gestures.
export const vnPerformance = (() => {
    'use strict';
    const clamp = value => Math.max(0, Math.min(1, value));
    const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
    const rest = () => ({ angle: 0, x: 0, y: 0, scale: 1, hair: 0, cloth: 0, gazeX: 0, gazeY: 0 });
    function envelope(time, event) {
        if (!(event.duration > 0) || time < event.start || time >= event.start + event.duration) return 0;
        const t = (time - event.start) / event.duration;
        return t < .25 ? ease(t / .25) : t < .45 ? 1 : 1 - ease((t - .45) / .55);
    }
    function headAt(line, seconds) {
        const pose = rest();
        for (const event of line?.head || []) {
            const amount = envelope(seconds, event) * Math.max(-1, Math.min(1, event.intensity ?? 1));
            if (event.kind === 'tilt') { pose.angle += .022 * amount; pose.x += 1.5 * amount; }
            if (event.kind === 'nod') { pose.y += 6 * amount; pose.angle += .004 * amount; pose.scale += .003 * amount; }
            if (event.kind === 'recoil') { pose.y -= 5 * amount; pose.x -= 2 * amount; pose.scale -= .007 * amount; }
        }
        return pose;
    }
    function sample(line, seconds, enabled = { head: true, gaze: true, secondary: true }) {
        const pose = enabled.head ? headAt(line, seconds) : rest();
        if (enabled.secondary && enabled.head) {
            const hair = headAt(line, seconds - .11), cloth = headAt(line, seconds - .17);
            pose.hair = Math.max(-3.5, Math.min(3.5, (hair.angle - pose.angle) * 220 + (hair.y - pose.y) * .2));
            pose.cloth = Math.max(-2, Math.min(2, (cloth.y - pose.y) * .38 + (cloth.angle - pose.angle) * 55));
        }
        if (enabled.gaze) for (const event of line?.gaze || []) {
            const amount = envelope(seconds, event);
            pose.gazeX += Math.max(-1, Math.min(1, event.x || 0)) * amount;
            pose.gazeY += Math.max(-1, Math.min(1, event.y || 0)) * amount;
        }
        return pose;
    }
    function create(options) {
        let disposed = false, frame = 0, pose = rest(), release = null, source = null;
        let enabled = { head: true, gaze: true, secondary: true };
        const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        const allowed = () => !disposed && !document.hidden && !motionQuery?.matches && options.isEnabled();
        function publish(next, force = false) {
            const changed = Object.keys(next).some(key => next[key] !== pose[key]);
            pose = next; if (changed || force) options.onChange(next);
        }
        function reset() {
            cancelAnimationFrame(frame); frame = 0; release = null; source = null; publish(rest(), true);
        }
        function render(now = performance.now()) {
            if (disposed) return;
            if (!allowed()) { reset(); return; }
            const playback = options.getPlayback();
            if (playback && Number.isFinite(playback.seconds)) {
                release = null; source = playback.source;
                publish(sample(options.lines[source], playback.seconds, enabled));
            } else {
                source = null;
                if (!release && Object.keys(pose).some(key => Math.abs(pose[key] - (key === 'scale' ? 1 : 0)) > .00001))
                    release = { started: now, pose: { ...pose } };
                if (!release) { cancelAnimationFrame(frame); frame = 0; return; }
                const blend = ease((now - release.started) / 220), next = rest();
                for (const key of Object.keys(next)) next[key] += (release.pose[key] - next[key]) * (1 - blend);
                publish(next);
                if (blend === 1) { release = null; cancelAnimationFrame(frame); frame = 0; return; }
            }
            if (!frame) frame = requestAnimationFrame(time => { frame = 0; render(time); });
        }
        function sync() { render(performance.now()); }
        function setEnabled(value) {
            for (const key of Object.keys(enabled)) if (typeof value[key] === 'boolean') enabled[key] = value[key];
            // Inspection toggles restore immediately, including during a voice-stop release.
            if (!enabled.head) { pose.angle = pose.x = pose.y = pose.hair = pose.cloth = 0; pose.scale = 1; }
            if (!enabled.gaze) pose.gazeX = pose.gazeY = 0;
            if (!enabled.secondary) pose.hair = pose.cloth = 0;
            release = null; publish({ ...pose }, true); sync();
        }
        function dispose() {
            if (disposed) return;
            reset(); disposed = true;
            document.removeEventListener('visibilitychange', sync);
            motionQuery?.removeEventListener?.('change', sync);
        }
        document.addEventListener('visibilitychange', sync);
        motionQuery?.addEventListener?.('change', sync);
        return { sync, setEnabled, dispose, getStatus: () => ({ pose: { ...pose }, source, enabled: { ...enabled }, running: !!frame }) };
    }
    return { create, sample };
})();
