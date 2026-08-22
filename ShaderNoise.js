window.addEventListener("load", runSketch);

function runSketch() {
    const canvas = document.getElementById("bg-canvas");

    if (!canvas) {
        return;
    }

    const ctx = canvas.getContext("2d");

    if (!ctx) {
        return;
    }

    let width = 0;
    let height = 0;
    let mouseX = 0.5;
    let mouseY = 0.5;
    let lastMouseX = 0.5;
    let lastMouseY = 0.5;
    let mouseVX = 0;
    let mouseVY = 0;
    let mouseDown = false;
    let clickStrength = 0;
    let inchPx = 96; // fallback, will be measured on resize
    let lastScrollTime = 0;
    let lastScrollY = window.scrollY || 0;
    let lastScrollDelta = 0;
    let drops = [];
    let lastDropTime = 0;
    let visualState = 0;
    let scrollOffset = 0; // accumulates scroll for parallax
    let mouseActive = 0;
    let lastMouseMoveTime = 0;
    let lastFrameTime = 0;
    let frameTimeSmooth = 16;

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        width = canvas.clientWidth;
        height = canvas.clientHeight;

        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Measure CSS pixels per inch so we can support an "inch" radius parameter
        try {
            const ruler = document.createElement("div");
            ruler.style.width = "1in";
            ruler.style.position = "absolute";
            ruler.style.left = "-100%";
            document.body.appendChild(ruler);
            inchPx = Math.max(1, ruler.offsetWidth || inchPx);
            document.body.removeChild(ruler);
        } catch (e) {
            // keep fallback
        }
        // no-op: keep measurements only
    }

    function drawFrame(time) {
        if (!width || !height) {
            resizeCanvas();
        }

        const t = time * 0.0008;
        // frame time measurement for adaptive quality
        const dt = Math.max(0, time - (lastFrameTime || time));
        lastFrameTime = time;
        frameTimeSmooth += (dt - frameTimeSmooth) * 0.04;
        const perfQuality = Math.max(0.35, Math.min(1, 16 / (frameTimeSmooth || 16)));
        const baseStep = Math.max(2, Math.min(width, height) / 140);
        const mx = mouseX * width;
        const my = mouseY * height;
        // radius parameter in inches (user-visible). Change this to tweak size.
        const radiusInches = 0.5; // ~1 inch diameter (adjust as needed)
        const radius = Math.max(8, inchPx * radiusInches);

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "rgba(0, 0, 8, 1)";
        ctx.fillRect(0, 0, width, height);

        const now = performance.now();
        const scrollActive = now - lastScrollTime < 300;
        const scrollStrength = Math.min(1, Math.abs(lastScrollDelta) / 160 + 0.08);
        const mouseTarget = now - lastMouseMoveTime < 300 ? 1 : 0;
        mouseActive += (mouseTarget - mouseActive) * 0.08;
        const mouseInvert = mouseActive * (0.35 + mouseX * 0.45);

        // smooth visual state: 0 = normal (scrolling), 1 = trails (idle)
        const targetState = scrollActive ? 0 : 1;
        visualState += (targetState - visualState) * 0.06; // smoother interpolation

        // speed multiplier increases while actively scrolling
        const speedMultiplier = 1 + Math.min(2.0, Math.abs(lastScrollDelta) / 60);
        const targetClick = mouseDown ? 1 : 0;
        clickStrength += (targetClick - clickStrength) * 0.16;
        const waterPhase = t * 1.6 + (Math.abs(mouseVX) + Math.abs(mouseVY)) * 0.4 + clickStrength * 1.8;
        const gestureStrength = Math.min(1, Math.sqrt(mouseVX * mouseVX + mouseVY * mouseVY) * 1.8 + clickStrength * 0.8);
        const mouseFlowX = (mouseX - 0.5) * 1.2 + mouseVX * 0.9 + clickStrength * 0.9;
        const mouseFlowY = 0.9 + Math.sin(waterPhase * 0.9) * 0.25 + gestureStrength * 0.8 + clickStrength * 0.55;

        // unified rendering: draw base pixels and overlay trails blended by visualState
        const quality = perfQuality;
        // fractional step for sub-pixel movement; increase step (fewer draws) when quality is low
        const step = Math.max(2.5, baseStep * 0.8 * (1 + (1 - quality) * 1.6));
        // increase pixel size during scroll (visualState ~ 0) — keep fractional sizes to avoid jumps
        const baseRect = Math.max(2, baseStep * 0.6);
        // compress extremes: idle pixels stay larger and scroll pixels stay smaller
        const minScale = 0.75;
        const maxScale = 1.35;
        const pixelScale = minScale + (1 - visualState) * (maxScale - minScale);
        const rectSize = baseRect * pixelScale * (0.8 + quality * 0.4);

        const baseAmp = 8;
        const amp = baseAmp * (0.6 + visualState * 1.0) + scrollStrength * 8;
        let trailSteps = Math.min(6, Math.max(1, Math.floor(1 + visualState * 6)));
        // reduce trails when perf is low
        trailSteps = Math.max(1, Math.round(trailSteps * quality));

        const sign = lastScrollDelta >= 0 ? 1 : -1;
        const sinT6 = Math.sin(t * 6 * speedMultiplier);
        const cosT5 = Math.cos(t * 5 * speedMultiplier);

        // parallax: use scrollOffset (decays below) to shift rows; stronger while scrolling
        const parallaxStrength = (1 - visualState) * 0.9;

        // clamp scrollOffset so no row shift will move pixels beyond canvas edges
        let allowedScrollOffset = scrollOffset;
        if (parallaxStrength > 0.01) {
            const maxPerRowUp = rectSize; // topmost row shouldn't go above -rectSize
            const maxPerRowDown = rectSize; // bottommost row shouldn't go below height+rectSize
            const maxPos = maxPerRowDown / parallaxStrength; // max positive scrollOffset
            const maxNeg = maxPerRowUp / (parallaxStrength * 0.1); // max negative (scaled by min rowParallax)
            const globalMax = Math.max(24, height * 0.06);
            allowedScrollOffset = Math.max(-Math.min(maxNeg, globalMax), Math.min(maxPos, globalMax));
        } else {
            allowedScrollOffset = 0;
        }

        const radiusSq = radius * radius;
        const earlyFactor = 1.4; // how much larger than radius we still consider for jitter edges
        const earlyLimitSq = radiusSq * earlyFactor * earlyFactor;
        for (let y = 0; y < height; y += step) {
            const yWave = Math.sin(y * 0.02 + t * 1.8 * speedMultiplier) * 0.9;
            // row-based parallax factor (top moves less than bottom)
            const rowParallax = (y / height) * 0.9 + 0.1;
            const rawRowShift = allowedScrollOffset * parallaxStrength * rowParallax;
            // clamp rowShift to avoid exposing background when extreme scrolls occur
            const maxParallax = Math.max(24, height * 0.06);
            const rowShift = Math.max(-maxParallax, Math.min(maxParallax, rawRowShift));
            for (let x = 0; x < width; x += step) {
                const dx = x - mx;
                const dy = y - my;
                const distSq = dx * dx + dy * dy;
                // cheap path for pixels well outside the interactive radius: draw base noise
                if (distSq > earlyLimitSq) {
                    const nx = x / width * 2 - 1;
                    const ny = y / height * 2 - 1;
                    const noise = Math.sin((nx + 1.3) * 18 + t * 3.4 * speedMultiplier) * 0.5 +
                        Math.cos((ny - 0.8) * 22 - t * 2.2 * speedMultiplier) * 0.35 +
                        Math.sin((nx * ny) * 30 + t * 1.8 * speedMultiplier) * 0.25;
                    const intensity = (noise + 1.1) / 2.2;
                    const centerNorm = Math.min(1, Math.sqrt((x - width * 0.5) ** 2 + (y - height * 0.5) ** 2) / (Math.max(width, height) * 0.72));
                    const brightnessScale = 0.12 + centerNorm * 0.6;
                    const xCenterNorm = Math.abs((x - width * 0.5) / (width * 0.5));
                    const centerShade = 0.15 + xCenterNorm * 0.75;
                    const brightness = Math.max(0.12, (intensity * 0.55 + 0.01) * brightnessScale * centerShade);
                    const varia = Math.sin((x * 12.9898 + y * 78.233) * 0.0003 + t * 0.5) * 43758.5453;
                    const rnd = varia - Math.floor(varia);
                    const baseR = Math.floor(8 + brightness * 120 + rnd * 6);
                    const baseG = Math.floor(14 + brightness * 100 + rnd * 4);
                    const baseB = Math.floor(40 + brightness * 150 + rnd * 6);
                    const baseAlpha = 0.95;
                    ctx.fillStyle = `rgba(${baseR}, ${baseG}, ${baseB}, ${baseAlpha})`;
                    ctx.fillRect(x, y + rowShift, rectSize, rectSize);
                    continue;
                }
                const dist = Math.sqrt(distSq + 0.0001);
                // watery oval shape with moving surface and gesture-driven bulge
                const angle = Math.atan2(dy, dx);
                const shapeNoise = Math.sin(angle * 3.3 + waterPhase * 2.7) * 0.14 + Math.cos(angle * 2.4 - waterPhase * 1.7) * 0.1;
                const dynamicRadius = radius * (1 + shapeNoise * 0.18 + gestureStrength * 0.14 + clickStrength * 0.22 + Math.sin(waterPhase + angle * 1.4) * 0.08);
                const normX = dx / dynamicRadius;
                const normY = dy / (dynamicRadius * (0.58 + 0.1 * clickStrength + gestureStrength * 0.05));
                const ovalDist = Math.sqrt(normX * normX + normY * normY);
                const surfaceWave = Math.sin((x + y) * 0.045 + waterPhase * 2.4) * 0.12;
                const localFall = Math.max(0, 1 - ovalDist);
                const waveSpeed = 1 + gestureStrength * 0.9 + clickStrength * 0.8;
                const edgeJitter = (Math.sin(dist * 0.45 - t * 5.8 * waveSpeed) + Math.cos((x + y) * 0.028 + t * 3.2 * waveSpeed)) * 0.58;
                const waterRidge = Math.cos(angle * 3 + waterPhase * 3.5) * (0.14 + gestureStrength * 0.12 + clickStrength * 0.1);
                const gestureBulge = Math.max(0, gestureStrength * (mouseVX * normX + mouseVY * normY) * 0.98 + clickStrength * 0.18 * Math.sin(angle * 3.5));
                const mask = Math.max(0, Math.min(1, localFall * (0.78 + surfaceWave + gestureBulge + clickStrength * 0.22) + edgeJitter * 0.38 * (1 - localFall) + waterRidge * localFall * 0.32));
                const warp = mask > 0 ? Math.sin(dist * 0.05 - t * 2.5 * speedMultiplier) * 0.14 * mask : 0;
                const noise = Math.sin((x / width * 2 - 1 + 1.3 + warp) * 18 + t * 3.4 * speedMultiplier) * 0.5 +
                    Math.cos((y / height * 2 - 1 - 0.8 + warp * 0.6) * 22 - t * 2.2 * speedMultiplier) * 0.35 +
                    Math.sin((x / width * 2 - 1 * (y / height * 2 - 1)) * 30 + t * 1.8 * speedMultiplier + dist * 0.01) * 0.25;
                const intensity = (noise + 1.1) / 2.2;
                const centerNorm = Math.min(1, Math.sqrt((x - width * 0.5) ** 2 + (y - height * 0.5) ** 2) / (Math.max(width, height) * 0.72));
                const brightnessScale = 0.12 + centerNorm * 0.6;
                const xCenterNorm = Math.abs((x - width * 0.5) / (width * 0.5));
                const centerShade = 0.15 + xCenterNorm * 0.75;
                const brightness = Math.max(0.01, (intensity * 0.55 + 0.01) * brightnessScale * centerShade);

                // deterministic small variation to avoid per-pixel Math.random cost
                const varia = Math.sin((x * 12.9898 + y * 78.233) * 0.0003 + t * 0.5) * 43758.5453;
                const rnd = varia - Math.floor(varia);
                const baseR = Math.floor(8 + brightness * 120 + rnd * 6);
                const baseG = Math.floor(14 + brightness * 100 + rnd * 4);
                const baseB = Math.floor(40 + brightness * 150 + rnd * 6);
                const invR = 255 - baseR;
                const invG = 255 - baseG;
                const invB = 255 - baseB;
                // apply local mask (glitchy) to inversion strength
                const localInvert = mouseInvert * mask;
                const baseInvR = baseR * (1 - localInvert) + invR * localInvert;
                const baseInvG = baseG * (1 - localInvert) + invG * localInvert;
                const baseInvB = baseB * (1 - localInvert) + invB * localInvert;
                const redPulse = 0.5 + 0.5 * Math.sin((x + y) * 0.18 + t * 6.1);
                const greenPulse = 0.5 + 0.5 * Math.sin((x - y) * 0.22 + t * 6.4);
                const purplePulse = 0.5 + 0.5 * Math.cos((x * 0.21 + y * 0.14) + t * 5.8);
                const hoverHueNoise = Math.sin((x + y) * 0.14 + t * 5.4 + shapeNoise * 3.0) * 0.42 +
                    Math.cos((x - y) * 0.17 + t * 4.9 - shapeNoise * 2.1) * 0.28;
                const glitchNoise = (rnd - 0.5) * 130;
                const hueShift = mask * (0.55 + 0.45 * Math.sin(angle * 3.9 + t * 2.4 + noise * 1.3));
                const finalR = Math.max(0, Math.min(255, Math.floor((baseInvR * (1 - mask)) + ((170 + redPulse * 120 + hoverHueNoise * 88 + glitchNoise * 0.85 + hueShift * 45) * mask))));
                const finalG = Math.max(0, Math.min(255, Math.floor((baseInvG * (1 - mask)) + ((80 + greenPulse * 165 + hoverHueNoise * 74 + glitchNoise * 0.65 + hueShift * 32) * mask))));
                const finalB = Math.max(0, Math.min(255, Math.floor((baseInvB * (1 - mask)) + ((108 + purplePulse * 145 + hoverHueNoise * 92 + glitchNoise * 0.72 - hueShift * 18) * mask))));

                // draw base/noise pixel (visibility reduced when visualState -> 1)
                const baseAlpha = 0.95 * (1 - visualState) + 0.08 * visualState;
                // small jitter offsets to break the perfect circular edge and create glitch
                const jitterX = Math.sin(x * 0.17 + y * 0.13 + t * 8) * 4 * mask + (rnd - 0.5) * 2 * mask + mouseFlowX * mask * 2;
                const jitterY = Math.cos(x * 0.11 - y * 0.09 + t * 6) * 3 * mask + mouseFlowY * mask * 1.8;
                ctx.fillStyle = `rgba(${finalR}, ${finalG}, ${finalB}, ${baseAlpha})`;
                ctx.fillRect(x + jitterX, y + rowShift + jitterY + mask * 2.2, rectSize, rectSize);

                // draw trails blended by visualState
                if (visualState > 0.02) {
                    for (let s = 0; s < trailSteps; s++) {
                        const tMul = (s + 1) / trailSteps;
                        const offsetX = sign * amp * tMul * (0.35 + intensity * 0.6) * (yWave + sinT6 * 0.5);
                        const offsetY = amp * 0.16 * tMul * (0.25 + intensity * 0.5) * (Math.cos(x * 0.02 + t * 1.2 * speedMultiplier) * 0.7 + cosT5 * 0.4);
                        const alpha = (0.75) * visualState * (1 - s / trailSteps) * (0.4 + intensity * 0.5);
                        // trail pieces also get small jitter when inside the mask
                        const trailJitterX = (Math.sin((x + s) * 0.23 + t * 6) * 2 + (rnd - 0.5)) * mask * tMul;
                        const trailJitterY = (Math.cos((y + s) * 0.19 - t * 5) * 1.5) * mask * tMul;
                        ctx.fillStyle = `rgba(${finalR}, ${finalG}, ${finalB}, ${Math.max(0.005, alpha)})`;
                        ctx.fillRect(x + offsetX * tMul + trailJitterX, y + rowShift + offsetY * tMul + trailJitterY, rectSize, rectSize);
                    }
                }
            }
        }

        // spawn drops from the watery oval edge
        const dropChance = 0.03 + gestureStrength * 0.16 + clickStrength * 1.0;
        if (now - lastDropTime > 18 && Math.random() < dropChance) {
            const spawnCount = clickStrength > 0.5 ? 2 + Math.floor(Math.random() * 3) : 1;
            for (let s = 0; s < spawnCount; s++) {
                const angle = Math.random() * Math.PI - Math.PI * 0.5;
                const radiusOffset = radius * (0.65 + Math.random() * 0.35 + gestureStrength * 0.2 + clickStrength * 0.18);
                const dropX = mx + Math.cos(angle) * radiusOffset;
                const dropY = my + Math.sin(angle) * radiusOffset * 0.65;
                drops.push({
                    x: dropX,
                    y: dropY,
                    vx: mouseFlowX * 0.9 + (Math.random() - 0.5) * 1.8 + mouseVX * 0.8 + clickStrength * 1.0,
                    vy: 2.2 + Math.random() * 2.8 + gestureStrength * 1.6 + clickStrength * 1.0,
                    size: Math.max(1, Math.min(4, rectSize * (0.4 + Math.random() * 1.2 + clickStrength * 0.25))),
                    alpha: 0.55 + Math.random() * 0.4,
                    hue: 160 + Math.random() * 80 + clickStrength * 40,
                    sat: 70 + Math.random() * 18,
                    light: 54 + Math.random() * 20,
                });
            }
            lastDropTime = now;
        }

        for (let i = drops.length - 1; i >= 0; i--) {
            const drop = drops[i];
            drop.vy += 0.08;
            drop.x += drop.vx;
            drop.y += drop.vy;
            drop.alpha *= 0.996;
            const hue = drop.hue + Math.sin(drop.y * 0.08 + t * 3 + drop.x * 0.03) * 18;
            const sat = Math.max(55, Math.min(90, drop.sat + Math.cos(drop.x * 0.06 + t * 2.5) * 9));
            const light = Math.max(40, Math.min(78, drop.light + Math.sin(drop.x * 0.04 - t * 2.3) * 7));
            ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, ${Math.max(0.05, drop.alpha)})`;
            ctx.fillRect(drop.x, drop.y, drop.size, drop.size * 1.4);
            if (drop.y > height + drop.size || drop.alpha < 0.02) {
                drops.splice(i, 1);
            }
        }

        // decay the scrollOffset and lastScrollDelta to ease out motion smoothly
        scrollOffset *= 0.9;
        lastScrollDelta *= 0.6;

        requestAnimationFrame(drawFrame);
    }

    function updateMousePosition(event) {
        const rect = canvas.getBoundingClientRect();
        const newX = (event.clientX - rect.left) / rect.width;
        const newY = (event.clientY - rect.top) / rect.height;
        mouseVX = (newX - mouseX) * 30;
        mouseVY = (newY - mouseY) * 30;
        mouseX = newX;
        mouseY = newY;
        mouseActive = 1;
        lastMouseMoveTime = performance.now();
    }

    function updateScrollState() {
        const newY = window.scrollY || 0;
        lastScrollDelta = newY - lastScrollY;
        lastScrollY = newY;
        lastScrollTime = performance.now();
        // add to scrollOffset for a quick parallax response
        scrollOffset += lastScrollDelta * 0.35;
    }

    window.addEventListener("mousemove", updateMousePosition);
    window.addEventListener("mousedown", () => {
        mouseDown = true;
        clickStrength = 1;
    });
    window.addEventListener("mouseup", () => {
        mouseDown = false;
    });
    window.addEventListener("mouseleave", () => {
        mouseX = 0.5;
        mouseY = 0.5;
    });
    window.addEventListener("scroll", updateScrollState, { passive: true });

    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();
    requestAnimationFrame(drawFrame);
}
