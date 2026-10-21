// Adapted from the original character animation runtime. Artwork is provided separately by local packs.
// Procedural "life" layer: idle head drift, hair drift, speech-coupled head motion, and small
// gaze saccades/glances. Authored acting (vnPerformance) is added on top by the caller.
export const vnLife = (() => {
    'use strict';
    const TAU = Math.PI * 2;
    const rest = () => ({ angle: 0, x: 0, y: 0, scale: 1, hair: 0, cloth: 0, gazeX: 0, gazeY: 0, brow: 0 });
    const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

    // Stable per-character phases keep motion continuous when the same character changes expression.
    function phases(seed) {
        let state = 0x9e3779b9;
        for (const character of String(seed)) state = Math.imul(state ^ character.charCodeAt(0), 2654435761) >>> 0;
        const list = [];
        for (let i = 0; i < 12; i++) {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            list.push(state / 4294967296 * TAU);
        }
        return list;
    }

    // Deterministic, non-repeating-looking sum of incommensurate sines: roughly 2 screen px of head drift.
    function idleAt(seconds, phase) {
        const wave = (frequency, index) => Math.sin(TAU * frequency * seconds + phase[index]);
        const gust = Math.pow(Math.max(0, wave(.043, 8)), 6);
        return {
            angle: .0065 * (.6 * wave(.071, 0) + .4 * wave(.183, 1)),
            x: 1.8 * (.7 * wave(.053, 2) + .3 * wave(.21, 3)),
            y: 1.0 * (.6 * wave(.097, 4) + .4 * wave(.29, 5)),
            hair: .8 * wave(.37, 6) + .4 * wave(.61, 7) + 1.0 * gust * wave(1.3, 9)
        };
    }

    // Normalized lip aperture per Rhubarb shape; used as a loudness proxy for head motion.
    const openness = { X: 0, A: .1, B: .35, C: .6, D: 1, E: .55, F: .3, G: .3, H: .45 };
    function speechEnergy(mouthPose) {
        if (!mouthPose) return 0;
        const from = openness[mouthPose.from] ?? 0, to = openness[mouthPose.to] ?? 0;
        return from + (to - from) * (Number.isFinite(mouthPose.blend) ? mouthPose.blend : 0);
    }

    function create(options) {
        const phase = phases(options.seed || 'vn');
        // Idle phases follow the character; saccade choices vary per surface so entrances don't repeat.
        let random = (phase.reduce((sum, value) => (sum + Math.round(value * 1e6)) >>> 0, 17) ^
            Math.imul((options.variation >>> 0) + 1, 2654435761)) >>> 0 || 1;
        const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 4294967296; };
        const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        let disposed = false, enabled = true, frame = 0, last = null, pose = rest();
        let energy = 0, slowEnergy = 0, follow = null, cloth = null;
        // Gaze: current offset, active transition, and when the next fixation starts.
        let gaze = { x: 0, y: 0 }, move = null, nextSaccade = 0, glance = null;
        // Brows: -1 furrow .. +1 raise, only in directions the pose has artwork for.
        let brow = 0, browPulse = null, nextBrowIdle = 0, browCooldown = 0;
        const browRange = () => { const brows = options.getBrows?.(); return { raise: !!brows?.raise, furrow: !!brows?.furrow }; };

        const allowed = () => enabled && !disposed && !document.hidden && !motionQuery?.matches && options.isEnabled();

        function publish(value, force = false) {
            const changed = Object.keys(value).some(key => value[key] !== pose[key]);
            pose = value; if (changed || force) options.onChange(value);
        }
        function reset() {
            cancelAnimationFrame(frame); frame = 0; last = null; energy = slowEnergy = 0; follow = cloth = null;
            gaze = { x: 0, y: 0 }; move = null; nextSaccade = 0; glance = null;
            brow = 0; browPulse = null; nextBrowIdle = 0; browCooldown = 0;
            publish(rest(), true);
        }
        function startMove(now, x, y, duration) {
            move = { started: now, duration, from: { ...gaze }, to: { x, y } };
        }
        function updateGaze(now, speaking) {
            if (glance) {
                if (now >= glance.returnAt && !glance.returning) { glance.returning = true; startMove(now, 0, 0, 110); }
                else if (!glance.started) { glance.started = true; startMove(now, glance.x, glance.y, 90); }
            } else if (options.gaze && now >= nextSaccade) {
                // Mostly hold eye contact with the player; occasional small fixations elsewhere.
                const centered = Math.abs(gaze.x) + Math.abs(gaze.y) > .01 ? next() < .7 : next() < .55;
                const x = centered ? 0 : (next() < .5 ? -1 : 1) * (.18 + next() * .27);
                const y = centered ? 0 : (next() - .55) * .4;
                if (Math.abs(x - gaze.x) + Math.abs(y - gaze.y) > .05) {
                    startMove(now, x, y, 70);
                    if (Math.abs(x - gaze.x) > .3 && next() < .35) options.onSaccade?.();
                }
                nextSaccade = now + (speaking ? 2600 : 1800) + next() * (speaking ? 4200 : 4600);
            }
            if (move) {
                const t = smooth((now - move.started) / move.duration);
                gaze = { x: move.from.x + (move.to.x - move.from.x) * t, y: move.from.y + (move.to.y - move.from.y) * t };
                if (t >= 1) {
                    move = null;
                    if (glance?.returning) { glance = null; nextSaccade = now + 1500 + next() * 2500; }
                }
            }
        }
        function render(now = performance.now()) {
            if (disposed) return;
            if (!allowed()) { if (frame || last !== null || Object.keys(pose).some(key => pose[key] !== rest()[key])) reset(); return; }
            const dt = last === null ? 16 : Math.max(0, Math.min(100, now - last)); last = now;
            if (!nextSaccade) nextSaccade = now + 1200 + next() * 2500;
            const seconds = now / 1000, idle = idleAt(seconds, phase);

            const target = Math.max(0, Math.min(1, Number(options.getSpeechEnergy?.()) || 0));
            energy += (target - energy) * (1 - Math.exp(-dt / (target > energy ? 60 : 200)));
            slowEnergy += (energy - slowEnergy) * (1 - Math.exp(-dt / 700));
            const emphasis = Math.max(0, energy - slowEnergy);
            updateGaze(now, energy > .05);

            const glanceAmount = glance ? Math.hypot(gaze.x, gaze.y) / Math.max(.01, Math.hypot(glance.x, glance.y)) : 0;
            const value = rest();
            value.angle = idle.angle + .005 * energy * Math.sin(TAU * .27 * seconds + phase[10]) - .006 * glanceAmount * Math.sign(glance?.x || 0);
            value.x = idle.x + 1.2 * energy * Math.sin(TAU * .19 * seconds + phase[11]) + 3 * glanceAmount * (glance?.x || 0);
            value.y = idle.y + 2.4 * emphasis + .5 * energy + .6 * glanceAmount;
            value.scale = 1 + .0025 * emphasis;

            // Hair and collar lag behind the procedural head, like the authored follow-through.
            const lag = (state, tau) => {
                const k = 1 - Math.exp(-dt / tau);
                if (!state) return { angle: value.angle, y: value.y };
                return { angle: state.angle + (value.angle - state.angle) * k, y: state.y + (value.y - state.y) * k };
            };
            follow = lag(follow, 110); cloth = lag(cloth, 170);
            value.hair = Math.max(-3, Math.min(3, idle.hair + (follow.angle - value.angle) * 220 + (follow.y - value.y) * .2));
            value.cloth = Math.max(-2, Math.min(2, (cloth.y - value.y) * .38 + (cloth.angle - value.angle) * 55));
            if (options.gaze) { value.gazeX = gaze.x; value.gazeY = gaze.y; }
            value.brow = updateBrow(now, dt, emphasis, energy > .05, glanceAmount);
            publish(value);
            if (!frame) frame = requestAnimationFrame(time => { frame = 0; render(time); });
        }
        function updateBrow(now, dt, emphasis, speaking, glanceAmount) {
            const range = browRange();
            if (!range.raise && !range.furrow) return 0;
            if (!nextBrowIdle) nextBrowIdle = now + 5000 + next() * 7000;
            // Stressed syllables lift the brows a little; a cooldown keeps it from becoming a rhythm.
            if (range.raise && speaking && emphasis > .2 && now >= browCooldown) {
                browPulse = { started: now, duration: 620, amount: Math.min(.36, .16 + emphasis * .7) };
                browCooldown = now + 1900 + next() * 1400;
            } else if (range.raise && !speaking && now >= nextBrowIdle) {
                browPulse = { started: now, duration: 700, amount: .12 + next() * .08 };
                nextBrowIdle = now + 7000 + next() * 7000;
            }
            let target = 0;
            if (browPulse) {
                const t = (now - browPulse.started) / browPulse.duration;
                if (t >= 1) browPulse = null;
                else target += browPulse.amount * (t < .3 ? smooth(t / .3) : 1 - smooth((t - .3) / .7));
            }
            const tone = options.getTone?.();
            if (tone === 'question' && speaking && range.raise) target = Math.max(target, .25);
            if (range.furrow) target -= .35 * glanceAmount;
            if (!range.raise) target = Math.min(0, target);
            if (!range.furrow) target = Math.max(0, target);
            brow += (target - brow) * (1 - Math.exp(-dt / (Math.abs(target) > Math.abs(brow) ? 110 : 240)));
            if (Math.abs(brow) < .004 && !target) brow = 0;
            return Math.max(-1, Math.min(1, brow));
        }
        function sync() { render(performance.now()); }
        // A brief look away (thinking/recalling) during a measured pause in the recording.
        function lookAway(durationMs) {
            if (!allowed() || glance || !(durationMs > 150)) return false;
            const now = performance.now();
            glance = { x: (next() < .5 ? -1 : 1) * (.45 + next() * .2), y: .15 + next() * .15,
                returnAt: now + Math.min(1100, durationMs), started: false, returning: false };
            sync();
            return true;
        }
        function setEnabled(value) { enabled = Boolean(value); if (!enabled) reset(); else sync(); }
        function dispose() {
            if (disposed) return;
            reset(); disposed = true;
            document.removeEventListener('visibilitychange', sync);
            motionQuery?.removeEventListener?.('change', sync);
        }
        document.addEventListener('visibilitychange', sync);
        motionQuery?.addEventListener?.('change', sync);
        return { sync, setEnabled, lookAway, dispose,
            getStatus: () => ({ pose: { ...pose }, enabled, running: !!frame, energy, glancing: !!glance }) };
    }

    // Authored acting leads; procedural gaze yields while an authored gaze event is visible.
    function combine(authored, life) {
        const a = authored || rest(), b = life || rest();
        const authoredGaze = Math.min(1, Math.hypot(a.gazeX || 0, a.gazeY || 0) * 4);
        return {
            angle: (a.angle || 0) + (b.angle || 0), x: (a.x || 0) + (b.x || 0), y: (a.y || 0) + (b.y || 0),
            scale: (a.scale ?? 1) + (b.scale ?? 1) - 1, hair: (a.hair || 0) + (b.hair || 0), cloth: (a.cloth || 0) + (b.cloth || 0),
            gazeX: (a.gazeX || 0) + (b.gazeX || 0) * (1 - authoredGaze), gazeY: (a.gazeY || 0) + (b.gazeY || 0) * (1 - authoredGaze),
            brow: Math.max(-1, Math.min(1, (a.brow || 0) + (b.brow || 0)))
        };
    }

    return { create, combine, idleAt, speechEnergy, phases };
})();
