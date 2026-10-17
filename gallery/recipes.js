// Procedural motifs for the gallery, drawn on a canvas. They avoid photo rights questions and
// make every gallery work reproducible from this repository: `npm run gallery`.

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

export const RECIPES = {
  /** Sun setting over the sea. */
  sunset() {
    const [c, g] = canvas(800, 1000);
    const sky = g.createLinearGradient(0, 0, 0, 620);
    sky.addColorStop(0, '#1d1b4f'); sky.addColorStop(0.45, '#8a3b78'); sky.addColorStop(0.8, '#f0743e'); sky.addColorStop(1, '#ffc46b');
    g.fillStyle = sky; g.fillRect(0, 0, 800, 620);
    const sun = g.createRadialGradient(400, 560, 10, 400, 560, 170);
    sun.addColorStop(0, '#fffbe6'); sun.addColorStop(0.55, '#ffd36b'); sun.addColorStop(1, 'rgba(255,170,80,0)');
    g.fillStyle = sun; g.beginPath(); g.arc(400, 560, 170, 0, 7); g.fill();
    const sea = g.createLinearGradient(0, 620, 0, 1000);
    sea.addColorStop(0, '#d0603a'); sea.addColorStop(0.3, '#4a2f5c'); sea.addColorStop(1, '#0d1030');
    g.fillStyle = sea; g.fillRect(0, 620, 800, 380);
    g.fillStyle = 'rgba(255,214,140,0.75)';
    for (let i = 0; i < 26; i++) {
      const y = 630 + i * 13, w = 230 - i * 7 + (i % 3) * 18;
      g.fillRect(400 - w / 2 + Math.sin(i * 1.7) * 20, y, w, 4);
    }
    return c;
  },

  /** Crescent moon over dark hills. */
  moonNight() {
    const [c, g] = canvas(800, 1000);
    const sky = g.createLinearGradient(0, 0, 0, 1000);
    sky.addColorStop(0, '#04060f'); sky.addColorStop(0.7, '#14244a'); sky.addColorStop(1, '#1f3560');
    g.fillStyle = sky; g.fillRect(0, 0, 800, 1000);
    const halo = g.createRadialGradient(540, 300, 60, 540, 300, 330);
    halo.addColorStop(0, 'rgba(180,200,255,0.45)'); halo.addColorStop(1, 'rgba(180,200,255,0)');
    g.fillStyle = halo; g.fillRect(0, 0, 800, 800);
    g.fillStyle = '#f4f1dc'; g.beginPath(); g.arc(540, 300, 130, 0, 7); g.fill();
    g.fillStyle = '#0a1024'; g.beginPath(); g.arc(590, 260, 118, 0, 7); g.fill();
    g.fillStyle = '#05070d';
    g.beginPath(); g.moveTo(0, 820);
    for (let x = 0; x <= 800; x += 20) g.lineTo(x, 790 - 70 * Math.sin(x / 140) - 30 * Math.sin(x / 47));
    g.lineTo(800, 1000); g.lineTo(0, 1000); g.fill();
    return c;
  },

  /** Rays of light breaking out of the dark. */
  lightBurst() {
    const [c, g] = canvas(900, 900);
    g.fillStyle = '#000'; g.fillRect(0, 0, 900, 900);
    g.save(); g.translate(450, 450);
    for (let i = 0; i < 36; i++) {
      g.rotate((Math.PI * 2) / 36);
      const ray = g.createLinearGradient(0, 0, 0, -640);
      ray.addColorStop(0, 'rgba(255,255,255,0.9)'); ray.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = ray;
      g.beginPath(); g.moveTo(-6, 0); g.lineTo(6, 0); g.lineTo(i % 2 ? 26 : 46, -640); g.lineTo(i % 2 ? -26 : -46, -640); g.fill();
    }
    g.restore();
    const core = g.createRadialGradient(450, 450, 0, 450, 450, 240);
    core.addColorStop(0, '#fff'); core.addColorStop(0.35, 'rgba(255,255,255,0.85)'); core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core; g.fillRect(0, 0, 900, 900);
    return c;
  },

  /** A blue-green globe. */
  globe() {
    const [c, g] = canvas(900, 900);
    g.fillStyle = '#f6f4ee'; g.fillRect(0, 0, 900, 900);
    g.save(); g.beginPath(); g.arc(450, 450, 340, 0, 7); g.clip();
    const sea = g.createRadialGradient(330, 320, 20, 450, 450, 360);
    sea.addColorStop(0, '#7fc4f0'); sea.addColorStop(0.6, '#1f6fb0'); sea.addColorStop(1, '#0a2850');
    g.fillStyle = sea; g.fillRect(0, 0, 900, 900);
    g.fillStyle = '#3f8f48';
    const blobs = [[330, 300, 120, 80, 0.4], [420, 430, 90, 150, -0.3], [600, 360, 110, 70, 0.8], [560, 590, 140, 70, 0.2], [270, 560, 70, 110, -0.6]];
    for (const [x, y, rx, ry, rot] of blobs) { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, 7); g.fill(); }
    const shade = g.createRadialGradient(330, 300, 100, 450, 450, 380);
    shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,20,0.6)');
    g.fillStyle = shade; g.fillRect(0, 0, 900, 900);
    g.restore();
    return c;
  },

  /** Interfering sine waves. */
  waves() {
    const [c, g] = canvas(1000, 700);
    const img = g.createImageData(1000, 700);
    for (let y = 0; y < 700; y++) for (let x = 0; x < 1000; x++) {
      const v = Math.sin(x / 38 + Math.sin(y / 90) * 2.2) * 0.5 + Math.sin(Math.hypot(x - 700, y - 200) / 30) * 0.5;
      const k = Math.round(128 + 127 * v), p = (y * 1000 + x) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = k; img.data[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  },
};
