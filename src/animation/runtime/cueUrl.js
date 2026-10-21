/** Chapter audio/cues may live in a different local pack from the portrait. */
export function isLocalChapterCue(url, baseUrl) {
    if (typeof url !== 'string') return false;
    try {
        const base = new URL(baseUrl), parsed = new URL(url, base);
        return parsed.origin === base.origin && !parsed.username && !parsed.password &&
            !parsed.search && !parsed.hash &&
            /^\/local-packs\/[a-zA-Z0-9_-]{1,96}\/cues\/[a-zA-Z0-9_-]{1,96}\.json$/.test(parsed.pathname);
    } catch { return false; }
}
