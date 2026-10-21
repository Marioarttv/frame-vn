// Adapted from the original character animation runtime. Artwork is provided separately by local packs.
// Timing-free, pose-specific presentation warp. Facial animation stays in the source canvas.
export const vnSpriteMotion = (() => {
    'use strict';

    let cachedRenderer = null;
    const defaultRig = {
        head: { pivot: [535, 730], rigidUntil: 690, anchoredFrom: 825 },
        hair: [
            { x: [-100, -1, 220, 350], y: [130, 250, 580, 675], vector: [1, .25] },
            { x: [250, 350, 550, 650], y: [-100, -1, 125, 210], vector: [.4, -.25] }
        ],
        clothing: { left: [330, 435], right: [640, 750], y: [730, 790, 940, 1023] }
    };
    function normalizeRig(rig) {
        const array = (value, length, min, max) => Array.isArray(value) && value.length === length && value.every(Number.isFinite)
            ? value.map(number => Math.max(min, Math.min(max, number))) : null;
        const range = (value, length) => {
            const result = array(value, length, -1024, 2048);
            return result && result[0] < result[1] && (length === 2 || (result[1] <= result[2] && result[2] < result[3])) ? result : null;
        };
        const finite = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(1024, value)) : fallback;
        const head = { pivot: array(rig?.head?.pivot, 2, 0, 1024) || defaultRig.head.pivot,
            rigidUntil: finite(rig?.head?.rigidUntil, 690), anchoredFrom: finite(rig?.head?.anchoredFrom, 825) };
        if (head.anchoredFrom <= head.rigidUntil) { head.rigidUntil = 690; head.anchoredFrom = 825; }
        const hair = (Array.isArray(rig?.hair) ? rig.hair : defaultRig.hair).slice(0, 3).flatMap(zone => {
            const x = range(zone?.x, 4), y = range(zone?.y, 4), vector = array(zone?.vector, 2, -2, 2);
            return x && y && vector ? [{ x, y, vector }] : [];
        });
        const clothing = { left: range(rig?.clothing?.left, 2) || defaultRig.clothing.left,
            right: range(rig?.clothing?.right, 2) || defaultRig.clothing.right,
            y: range(rig?.clothing?.y, 4) || defaultRig.clothing.y };
        return { head, hair, clothing, jaw: normalizeJaw(rig?.jaw), cheeks: normalizeCheeks(rig?.cheeks) };
    }
    // Optional cheeks: an ellipse around the mouth stretched horizontally with the lip shape (wide for
    // "ee", narrow for "oo") and a smaller lip ellipse magnified on rounded shapes (the lips push
    // forward). Amounts stay small enough that neither field can fold.
    function normalizeCheeks(cheeks) {
        const values = [cheeks?.center?.[0], cheeks?.center?.[1], cheeks?.radius?.[0], cheeks?.radius?.[1], cheeks?.radius?.[2],
            cheeks?.lips?.[0], cheeks?.lips?.[1], cheeks?.stretch, cheeks?.push];
        if (!cheeks || !values.every(Number.isFinite)) return null;
        const [x, y, radiusX, up, down, lipsX, lipsY, stretch, push] = values;
        if (x < 0 || x > 1024 || y < 0 || y > 1024 || [radiusX, up, down, lipsX, lipsY].some(r => r <= 4 || r > 400) ||
            stretch < 0 || push < 0) return null;
        return { x, y, radiusX, up, down, lipsX, lipsY, stretch: Math.min(stretch, .08), push: Math.min(push, .08) };
    }
    // Optional jaw: the region from the lower lip to the chin drops with the mouth opening, fading out
    // across the neck and toward the jaw angles. Invalid or missing data disables it.
    function normalizeJaw(jaw) {
        const values = [jaw?.center, jaw?.top, jaw?.full, jaw?.chin, jaw?.neck, jaw?.width?.[0], jaw?.width?.[1], jaw?.drop, jaw?.taper ?? 1];
        if (!jaw || !Array.isArray(jaw.width) || jaw.width.length !== 2 || !values.every(Number.isFinite)) return null;
        const [center, top, full, chin, neck, inner, outer, drop, taper] = values;
        if (center < 0 || center > 1024 || top < 0 || !(top < full && full <= chin && chin < neck && neck <= 1024) ||
            !(inner >= 0 && inner < outer && outer <= 400) || drop <= 0 || !(taper > .2 && taper <= 1)) return null;
        // The neck fade must never fold: the displacement may fall by at most ~60% of a pixel per pixel.
        return { center, top, full, chin, neck, inner, outer, taper, drop: Math.min(drop, 12, (neck - chin) / 1.6) };
    }

    function createRenderer() {
        const canvas = document.createElement('canvas');
        let gl = null, program = null, buffer = null, texture = null, uniforms = null;
        let disposed = false, failed = false, warmed = false;
        const contextLost = event => { event.preventDefault(); failed = true; };
        const contextRestored = () => { failed = true; };
        canvas.addEventListener('webglcontextlost', contextLost);
        canvas.addEventListener('webglcontextrestored', contextRestored);
        const vertexSource = `
            attribute vec2 position;
            void main() { gl_Position = vec4(position, 0.0, 1.0); }
        `;
        const fragmentSource = `
            precision highp float;
            uniform sampler2D source;
            uniform vec2 resolution;
            uniform vec4 head;
            uniform vec3 secondary;
            uniform vec4 headRig;
            uniform vec4 hairX[3];
            uniform vec4 hairY[3];
            uniform vec2 hairVector[3];
            uniform vec4 clothingX;
            uniform vec4 clothingY;
            // Jaw: centre x, lower-lip y, full-drop y, chin y; neck y, inner/outer half-width, drop (1024 units);
            // width taper at the neck (the jaw narrows toward the chin, clear of collars and the neck sides).
            uniform vec4 jawRig;
            uniform vec4 jawShape;
            uniform float jawTaper;
            // Cheeks: centre xy, horizontal radius, radius above; radius below, lip radii xy, unused;
            // stretch and push amounts for this frame.
            uniform vec4 cheekRig;
            uniform vec4 cheekLips;
            uniform vec2 cheekMotion;
            // Scene lighting: key rgb + rim strength, ambient tint rgb + amount,
            // light direction (texture space) + rim width (1024-unit px), exposure/gradient/enabled.
            uniform vec4 lightKey;
            uniform vec4 lightAmbient;
            uniform vec3 lightDirection;
            uniform vec3 lightShape;
            float zoneWeight(float position, vec4 edges) {
                return smoothstep(edges.x, edges.y, position) * (1.0 - smoothstep(edges.z, edges.w, position));
            }
            void main() {
                vec2 pixel = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y);
                vec2 p = pixel * (1024.0 / resolution);
                vec2 pivot = headRig.xy;
                float c = cos(head.x), s = sin(head.x);
                vec2 local = p - pivot - head.yz;
                vec2 rigid = pivot + vec2(c * local.x + s * local.y, -s * local.x + c * local.y) / head.w;
                float headWeight = 1.0 - smoothstep(headRig.z, headRig.w, p.y);
                vec2 q = mix(p, rigid, headWeight);

                // Cheeks and lips follow the mouth shape: horizontal stretch around the mouth, lip push.
                if (cheekMotion.x != 0.0 || cheekMotion.y != 0.0) {
                    vec2 offset = q - cheekRig.xy;
                    float radiusY = offset.y < 0.0 ? cheekRig.w : cheekLips.x;
                    float d = length(vec2(offset.x / cheekRig.z, offset.y / radiusY));
                    q.x -= cheekMotion.x * offset.x * (1.0 - smoothstep(0.35, 1.0, d));
                    float lips = length(offset / cheekLips.yz);
                    q -= cheekMotion.y * offset * (1.0 - smoothstep(0.45, 1.0, lips));
                }

                // Jaw drop in head space: the chin and the skin below the lower lip move down together.
                if (jawShape.w > 0.0) {
                    float jawY = smoothstep(jawRig.y, jawRig.z, q.y) * (1.0 - smoothstep(jawRig.w, jawShape.x, q.y));
                    float narrow = mix(1.0, jawTaper, smoothstep(jawRig.y, jawShape.x, q.y));
                    float jawX = 1.0 - smoothstep(jawShape.y * narrow, jawShape.z * narrow, abs(q.x - jawRig.x));
                    q.y -= jawShape.w * jawY * jawX;
                }

                // Authored per-pose support zones keep secondary hair movement away from the face.
                vec2 hairOffset = vec2(0.0);
                for (int i = 0; i < 3; i++) {
                    float weight = zoneWeight(q.x, hairX[i]) * zoneWeight(q.y, hairY[i]);
                    hairOffset += hairVector[i] * weight;
                }
                q += secondary.x * hairOffset;

                // Delayed shoulder/collar response, supplied by the caller; neck and bottom stay anchored.
                float leftCloth = 1.0 - smoothstep(clothingX.x, clothingX.y, p.x);
                float rightCloth = smoothstep(clothingX.z, clothingX.w, p.x);
                float clothWeight = zoneWeight(p.y, clothingY);
                q += vec2(secondary.y * .7 * (rightCloth - leftCloth), secondary.y * (leftCloth + rightCloth)) * clothWeight;

                vec2 uv = q / 1024.0;
                if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0); return; }
                vec4 color = texture2D(source, uv);
                if (lightShape.z < 0.5 || color.a <= 0.0) { gl_FragColor = color; return; }

                // Premultiplied texture: light the straight colour, then re-premultiply.
                vec3 rgb = color.rgb / color.a;
                // Grade shadows/midtones toward the scene colour; bright skin keeps its natural tone.
                float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
                float grade = lightAmbient.a * (1.0 - smoothstep(0.3, 0.85, luma));
                rgb *= mix(vec3(1.0), lightAmbient.rgb, grade) * lightShape.x;
                // Gentle wash across the figure: brighter on the side facing the light.
                float side = clamp(dot((uv - vec2(0.5, 0.45)) * 2.0, lightDirection.xy), -1.0, 1.0);
                rgb *= 1.0 + lightShape.y * side;
                // Rim: how open the silhouette is toward the light (clamped edges count as opaque,
                // so the portrait's cropped bottom/sides never receive a rim).
                vec2 stepUv = lightDirection.xy * (lightDirection.z / 1024.0);
                float open = (1.0 - texture2D(source, uv + stepUv * 0.3).a) * 0.45
                    + (1.0 - texture2D(source, uv + stepUv * 0.65).a) * 0.35
                    + (1.0 - texture2D(source, uv + stepUv).a) * 0.2;
                // Screen blend: lifts toward the light's colour without clipping hair and skin to white.
                rgb = clamp(rgb, 0.0, 1.0);
                rgb = 1.0 - (1.0 - rgb) * (1.0 - clamp(lightKey.rgb * (lightKey.a * open), 0.0, 1.0));
                gl_FragColor = vec4(rgb * color.a, color.a);
            }
        `;
        function initialize() {
            if (failed || disposed) return false;
            if (gl) { if (gl.isContextLost()) failed = true; return !failed; }
            const shaders = [];
            try {
                gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true,
                    antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
                if (!gl) throw new Error('WebGL unavailable');
                const compile = (kind, source) => {
                    const shader = gl.createShader(kind); shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
                    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Motion shader compilation failed');
                    return shader;
                };
                const vertex = compile(gl.VERTEX_SHADER, vertexSource), fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
                program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
                if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Motion shader linking failed');
                gl.useProgram(program);
                buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
                const position = gl.getAttribLocation(program, 'position');
                gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
                texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
                gl.disable(gl.BLEND);
                uniforms = Object.fromEntries(['source','resolution','head','secondary','headRig','clothingX','clothingY','jawRig','jawShape','jawTaper','cheekRig','cheekLips','cheekMotion',
                    'hairX[0]','hairY[0]','hairVector[0]','lightKey','lightAmbient','lightDirection','lightShape']
                    .map(name => [name, gl.getUniformLocation(program, name)]));
                gl.uniform1i(uniforms.source, 0);
                return true;
            } catch {
                failed = true;
                releaseResources();
                return false;
            } finally {
                for (const shader of shaders) if (shader) gl.deleteShader(shader);
            }
        }
        const bounded = (value, limit) => Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : 0;
        // light: { key: [r,g,b], rim, ambient: [r,g,b], tint, direction: [x,y], rimWidth, exposure, gradient }
        function validLight(light) {
            const triple = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
            return !!light && triple(light.key) && triple(light.ambient) && Array.isArray(light.direction) &&
                light.direction.length === 2 && light.direction.every(Number.isFinite) &&
                [light.rim, light.tint, light.rimWidth, light.exposure, light.gradient].every(Number.isFinite);
        }
        function render(sourceCanvas, destinationCanvas, pose = {}, rig, light) {
            const context = destinationCanvas.getContext('2d');
            if (!context || sourceCanvas === destinationCanvas) return false;
            const width = sourceCanvas.width, height = sourceCanvas.height;
            if (destinationCanvas.width !== width) destinationCanvas.width = width;
            if (destinationCanvas.height !== height) destinationCanvas.height = height;
            const copy = () => { context.clearRect(0, 0, width, height); if (width && height) context.drawImage(sourceCanvas, 0, 0); return false; };
            const angle = bounded(pose.angle, Math.PI / 120), x = bounded(pose.x, 6), y = bounded(pose.y, 6);
            const scale = 1 + bounded(Number.isFinite(pose.scale) ? pose.scale - 1 : 0, .008);
            const hair = bounded(pose.hair, 3), cloth = bounded(pose.cloth, 2);
            const lit = validLight(light), config = normalizeRig(rig);
            const jaw = config.jaw ? Math.max(0, Math.min(1, Number.isFinite(pose.jaw) ? pose.jaw : 0)) : 0;
            const cheeks = config.cheeks, unitRange = value => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
            const stretch = cheeks ? cheeks.stretch * unitRange(pose.cheekStretch) : 0;
            const push = cheeks ? cheeks.push * Math.max(0, unitRange(pose.lipPush)) : 0;
            if (disposed || !width || !height || (!angle && !x && !y && scale === 1 && !hair && !cloth && !jaw && !stretch && !push && !lit) ||
                !initialize()) return copy();
            try {
                if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
                gl.viewport(0, 0, width, height);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
                gl.uniform2f(uniforms.resolution, width, height);
                gl.uniform4f(uniforms.head, angle, x, y, scale);
                gl.uniform3f(uniforms.secondary, hair, cloth, 0);
                const zones = [...config.hair];
                while (zones.length < 3) zones.push({ x: [-100, -1, 1024, 1100], y: [-100, -1, 1024, 1100], vector: [0, 0] });
                gl.uniform4f(uniforms.headRig, ...config.head.pivot, config.head.rigidUntil, config.head.anchoredFrom);
                gl.uniform4fv(uniforms['hairX[0]'], zones.flatMap(zone => zone.x));
                gl.uniform4fv(uniforms['hairY[0]'], zones.flatMap(zone => zone.y));
                gl.uniform2fv(uniforms['hairVector[0]'], zones.flatMap(zone => zone.vector));
                gl.uniform4f(uniforms.clothingX, ...config.clothing.left, ...config.clothing.right);
                gl.uniform4fv(uniforms.clothingY, config.clothing.y);
                const j = config.jaw;
                gl.uniform4f(uniforms.jawRig, j ? j.center : 0, j ? j.top : 0, j ? j.full : 1, j ? j.chin : 1);
                gl.uniform4f(uniforms.jawShape, j ? j.neck : 2, j ? j.inner : 0, j ? j.outer : 1, j ? j.drop * jaw : 0);
                gl.uniform1f(uniforms.jawTaper, j ? j.taper : 1);
                gl.uniform4f(uniforms.cheekRig, cheeks ? cheeks.x : 0, cheeks ? cheeks.y : 0, cheeks ? cheeks.radiusX : 1, cheeks ? cheeks.up : 1);
                gl.uniform4f(uniforms.cheekLips, cheeks ? cheeks.down : 1, cheeks ? cheeks.lipsX : 1, cheeks ? cheeks.lipsY : 1, 0);
                gl.uniform2f(uniforms.cheekMotion, stretch, push);
                const unit = value => Math.max(0, Math.min(1, value));
                if (lit) {
                    const length = Math.hypot(...light.direction) || 1;
                    gl.uniform4f(uniforms.lightKey, ...light.key.map(unit), Math.max(0, Math.min(1.5, light.rim)));
                    gl.uniform4f(uniforms.lightAmbient, ...light.ambient.map(unit), unit(light.tint));
                    gl.uniform3f(uniforms.lightDirection, light.direction[0] / length, light.direction[1] / length,
                        Math.max(0, Math.min(48, light.rimWidth)));
                    gl.uniform3f(uniforms.lightShape, Math.max(.5, Math.min(1.2, light.exposure)), Math.max(0, Math.min(.2, light.gradient)), 1);
                } else gl.uniform3f(uniforms.lightShape, 1, 0, 0);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
                context.clearRect(0, 0, width, height); context.drawImage(canvas, 0, 0);
                return true;
            } catch {
                failed = true;
                return copy();
            }
        }
        function warmup() {
            if (warmed || failed || disposed) return warmed && !failed && !disposed;
            const source = document.createElement('canvas'), destination = document.createElement('canvas');
            source.width = 1024; source.height = 1024;
            // Exercise shader, texture allocation and presentation before the first visible reaction.
            warmed = render(source, destination, { hair: .001 });
            if (warmed) gl.finish();
            source.width = 0; source.height = 0; destination.width = 0; destination.height = 0;
            return warmed;
        }
        function releaseResources() {
            if (gl) { gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); }
            texture = null; buffer = null; program = null;
        }
        function dispose() {
            if (disposed) return;
            disposed = true;
            releaseResources();
            canvas.removeEventListener('webglcontextlost', contextLost);
            canvas.removeEventListener('webglcontextrestored', contextRestored);
            // Releasing textures does not release the browser's context slot. A studio can
            // inspect dozens of poses in quick succession, well before garbage collection.
            gl?.getExtension('WEBGL_lose_context')?.loseContext();
            canvas.width = 0; canvas.height = 0;
        }
        return { render, warmup, dispose, getStatus: () => ({ available: !!gl && !failed && !disposed && !gl.isContextLost(), warmed, disposed }) };
    }

    // One WebGL context and compiled shader serve every portrait. Creating and destroying a context per
    // speaker change blocked the main thread for tens of milliseconds at each switch.
    let claims = 0;
    function shared() {
        const status = cachedRenderer?.getStatus();
        if (!cachedRenderer || status.disposed || (status.warmed && !status.available)) {
            if (cachedRenderer && !claims) cachedRenderer.dispose();
            cachedRenderer = createRenderer();
        }
        cachedRenderer.warmup();
        return cachedRenderer;
    }
    function preload() { return shared().getStatus().available; }
    // Each portrait gets a handle; releasing it leaves the shared renderer for the next portrait.
    function create() {
        const renderer = shared();
        let released = false;
        claims++;
        return {
            // A released handle only copies the approved source, exactly like an unavailable GPU.
            render: (source, destination, pose, rig, light) => released
                ? renderer.render(source, destination, {}, rig) && false
                : renderer.render(source, destination, pose, rig, light),
            warmup: () => !released && renderer.warmup(),
            dispose: () => { if (!released) { released = true; claims = Math.max(0, claims - 1); } },
            getStatus: () => released ? { available: false, warmed: renderer.getStatus().warmed, disposed: true } : renderer.getStatus()
        };
    }
    // Page teardown: release the shared context once no portrait holds it.
    function disposePreload() { if (!claims) { cachedRenderer?.dispose(); cachedRenderer = null; } }
    return { create, preload, disposePreload };
})();
