// Interactive header noise texture
(function() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // Configuration
  const config = {
    pixelSize: 1,
    grainIntensity: 0.55,
    noiseSpeed: 1,
    hoverRadius: 120,
    hoverPush: 36,
    singularityRadius: 18,
    baseColor: '#040506'
  };

  let mouseX = 0;
  let mouseY = 0;
  let isHovering = false;

  // Lerped state for smooth transitions when cursor leaves
  let currentSpeed = config.noiseSpeed;
  let currentBrightness = 1.0;
  
  // Initialize canvas
  function initCanvas() {
    const header = document.querySelector('header');
    if (!header) return;
    
    canvas.width = header.offsetWidth || window.innerWidth;
    canvas.height = header.offsetHeight || 100;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '0';
    
    // Make header position relative for absolute positioning to work
    if (getComputedStyle(header).position === 'static') {
      header.style.position = 'relative';
    }
    
    // Adjust z-index of child elements
    Array.from(header.children).forEach(child => {
      if (getComputedStyle(child).position === 'static') {
        child.style.position = 'relative';
      }
      child.style.zIndex = '1';
    });
    
    header.insertBefore(canvas, header.firstChild);
  }
  
  function hashNoise(x, y, seed) {
    let value = x * 374761393 + y * 668265263 + seed * 1442695041;
    value = (value ^ (value >>> 13)) >>> 0;
    value = Math.imul(value, 1274126177) >>> 0;
    value ^= value >>> 16;
    return value / 4294967295;
  }
  
  // Animate and render texture
  function render() {
    if (!ctx) return;
    
    const w = canvas.width;
    const h = canvas.height;
    const pixelSize = config.pixelSize;
    // Smoothly lerp speed and brightness toward target values
    const targetSpeed = isHovering ? config.noiseSpeed : config.noiseSpeed * 0.5;
    const targetBrightness = isHovering ? 1.0 : 0.28;
    const lerpRate = 0.025;
    currentSpeed += (targetSpeed - currentSpeed) * lerpRate;
    currentBrightness += (targetBrightness - currentBrightness) * lerpRate;

    const time = performance.now() * 0.001 * currentSpeed;
    const frameSeed = Math.floor(time * 60);
    
    // Clear canvas
    ctx.fillStyle = config.baseColor;
    ctx.fillRect(0, 0, w, h);
    
    // Film grain: three colored noise planes with irregular random speckles.
    const planes = [
      { seed: 11, tint: [255, 92, 112] },
      { seed: 23, tint: [96, 255, 148] },
      { seed: 37, tint: [98, 142, 255] }
    ];

    ctx.imageSmoothingEnabled = false;

    for (let y = 0; y < h; y += pixelSize) {
      for (let x = 0; x < w; x += pixelSize) {
        const frameMix = frameSeed + x * 13 + y * 17;
        const grain = hashNoise(x, y, frameMix);
        const micro = hashNoise(x + 19, y - 7, frameMix + 101);
        const density = (grain * 0.65 + micro * 0.35);

        if (density < 0.12) continue;

        let drawX = x;
        let drawY = y;
        let alphaScale = 1;

        if (isHovering) {
          const dx = x - mouseX;
          const dy = y - mouseY;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < config.hoverRadius) {
            const field = 1 - distance / config.hoverRadius;
            const repel = config.hoverPush * field * field;
            const awayX = dx / (distance + 0.001);
            const awayY = dy / (distance + 0.001);
            drawX = Math.round(x + awayX * repel);
            drawY = Math.round(y + awayY * repel);

            if (distance < config.singularityRadius) {
              alphaScale = Math.max(0.06, distance / config.singularityRadius);
            } else {
              alphaScale = Math.max(0.25, 1 - field * 0.7);
            }
          }
        }

        for (let i = 0; i < planes.length; i += 1) {
          const plane = planes[i];
          const planeNoise = hashNoise(x + plane.seed, y - plane.seed, frameMix + plane.seed * 7);
          const intensity = Math.max(0, density + planeNoise * 0.34 - 0.08);

          if (intensity < 0.08) continue;

          const alpha = Math.min(0.92, (0.2 + intensity * 1.05 * config.grainIntensity) * alphaScale * currentBrightness);
          const tone = 0.52 + intensity * 0.92;
          const r = Math.max(0, Math.min(255, Math.floor(plane.tint[0] * tone)));
          const g = Math.max(0, Math.min(255, Math.floor(plane.tint[1] * tone)));
          const bVal = Math.max(0, Math.min(255, Math.floor(plane.tint[2] * tone)));

          ctx.fillStyle = `rgba(${r}, ${g}, ${bVal}, ${alpha})`;
          ctx.fillRect(drawX, drawY, pixelSize, pixelSize);
        }
      }
    }
    
    requestAnimationFrame(render);
  }

  function onMouseMove(e) {
    const header = document.querySelector('header');
    if (!header) return;

    const rect = header.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
    isHovering = true;
  }

  function onMouseLeave() {
    isHovering = false;
  }
  
  // Initialize when DOM is ready
  function init() {
    initCanvas();

    const header = document.querySelector('header');
    if (header) {
      header.addEventListener('mousemove', onMouseMove);
      header.addEventListener('mouseleave', onMouseLeave);
    }
    
    // Handle window resize
    window.addEventListener('resize', () => {
      const header = document.querySelector('header');
      if (header) {
        canvas.width = header.offsetWidth;
        canvas.height = header.offsetHeight;
      }
    });
    
    render();
  }
  
  // Wait for DOM if needed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
