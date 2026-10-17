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

  // ---- Moby-Dick demonstrator: one motif per part, landscape panels (about 2:1) ----

  /** Part I: a harbour town at dusk, a three-masted ship at the quay. */
  harbour() {
    const [c, g] = canvas(1600, 800);
    const sky = g.createLinearGradient(0, 0, 0, 520);
    sky.addColorStop(0, '#0d1a3a'); sky.addColorStop(0.55, '#3b4a7a'); sky.addColorStop(0.85, '#d98a4e'); sky.addColorStop(1, '#f2c27a');
    g.fillStyle = sky; g.fillRect(0, 0, 1600, 520);
    g.fillStyle = 'rgba(255,240,210,0.8)'; // a few early stars
    for (let i = 0; i < 70; i++) { const x = (i * 397) % 1600, y = (i * 211) % 260; g.fillRect(x, y, 2, 2); }
    // town on the left: houses with lit windows, a steeple
    g.fillStyle = '#0b0f1c';
    const houses = [[0, 360, 120], [110, 390, 90], [195, 340, 110], [300, 400, 80], [375, 370, 100], [470, 410, 70]];
    for (const [x, top, w] of houses) {
      g.fillRect(x, top, w, 520 - top);
      g.beginPath(); g.moveTo(x - 6, top); g.lineTo(x + w / 2, top - 46); g.lineTo(x + w + 6, top); g.fill();
    }
    g.fillRect(250, 230, 34, 120); g.beginPath(); g.moveTo(244, 232); g.lineTo(267, 120); g.lineTo(290, 232); g.fill();
    g.fillStyle = '#ffcf6e';
    for (const [x, top, w] of houses) for (let wy = top + 22; wy < 500; wy += 38) for (let wx = x + 14; wx < x + w - 14; wx += 30) if ((wx * 7 + wy * 3) % 5 < 3) g.fillRect(wx, wy, 11, 15);
    // quay
    g.fillStyle = '#141826'; g.fillRect(0, 505, 640, 30);
    // the ship: hull, three masts, yards, furled and set sails
    const hx = 760, hy = 520;
    g.fillStyle = '#05070d';
    g.beginPath(); g.moveTo(hx, hy - 40); g.lineTo(hx + 640, hy - 52); g.quadraticCurveTo(hx + 660, hy - 20, hx + 600, hy + 18); g.lineTo(hx + 60, hy + 18); g.quadraticCurveTo(hx + 10, hy - 6, hx, hy - 40); g.fill();
    g.strokeStyle = '#05070d'; g.lineWidth = 7;
    const masts = [[hx + 150, 300], [hx + 330, 340], [hx + 500, 320]];
    for (const [mx, h] of masts) {
      g.beginPath(); g.moveTo(mx, hy - 40); g.lineTo(mx, hy - 40 - h); g.stroke();
      for (let k = 0; k < 3; k++) {
        const yy = hy - 80 - k * (h / 3.4), ww = 120 - k * 26;
        g.lineWidth = 4; g.beginPath(); g.moveTo(mx - ww / 2, yy); g.lineTo(mx + ww / 2, yy); g.stroke();
        g.fillStyle = 'rgba(232,214,180,0.92)';
        g.beginPath(); g.moveTo(mx - ww / 2 + 4, yy + 3); g.lineTo(mx + ww / 2 - 4, yy + 3);
        g.quadraticCurveTo(mx + ww / 2 + 6, yy + h / 3.4 * 0.55, mx + ww / 2 - 10, yy + h / 3.4 - 10);
        g.lineTo(mx - ww / 2 + 10, yy + h / 3.4 - 10); g.quadraticCurveTo(mx - ww / 2 - 6, yy + h / 3.4 * 0.55, mx - ww / 2 + 4, yy + 3); g.fill();
      }
      g.lineWidth = 7;
    }
    g.lineWidth = 2; g.strokeStyle = 'rgba(5,7,13,0.8)'; // rigging
    for (const [mx, h] of masts) { g.beginPath(); g.moveTo(mx, hy - 40 - h); g.lineTo(hx + 20, hy - 44); g.moveTo(mx, hy - 40 - h); g.lineTo(hx + 640, hy - 54); g.stroke(); }
    g.beginPath(); g.moveTo(hx + 640, hy - 52); g.lineTo(hx + 790, hy - 150); g.stroke(); // bowsprit
    // water with reflections
    const sea = g.createLinearGradient(0, 520, 0, 800);
    sea.addColorStop(0, '#2a2f4a'); sea.addColorStop(1, '#070a14');
    g.fillStyle = sea; g.fillRect(0, 535, 1600, 265);
    g.fillStyle = 'rgba(255,200,120,0.55)';
    for (let i = 0; i < 40; i++) { const y = 545 + i * 6.4, w = 60 + ((i * 37) % 90); g.fillRect(((i * 173) % 560) + 20, y, w, 2.5); }
    g.fillStyle = 'rgba(242,194,122,0.5)';
    for (let i = 0; i < 30; i++) { const y = 540 + i * 8, w = 300 - i * 8; g.fillRect(1180 - w / 2 + Math.sin(i) * 30, y, w, 3); }
    return c;
  },

  /** Part II: whaleboats chasing spouting whales under a heavy sky, the ship on the horizon. */
  hunt() {
    const [c, g] = canvas(1600, 800);
    const sky = g.createLinearGradient(0, 0, 0, 380);
    sky.addColorStop(0, '#4b5866'); sky.addColorStop(0.6, '#9aa7b0'); sky.addColorStop(1, '#d8dcd6');
    g.fillStyle = sky; g.fillRect(0, 0, 1600, 380);
    g.fillStyle = 'rgba(60,70,82,0.55)'; // cloud banks
    for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(120 + i * 180, 70 + (i % 3) * 40, 230, 46, 0, 0, 7); g.fill(); }
    const sea = g.createLinearGradient(0, 380, 0, 800);
    sea.addColorStop(0, '#5c7180'); sea.addColorStop(0.4, '#2c4352'); sea.addColorStop(1, '#0c1820');
    g.fillStyle = sea; g.fillRect(0, 380, 1600, 420);
    g.strokeStyle = 'rgba(225,235,238,0.55)'; g.lineWidth = 3; // wave crests
    for (let r = 0; r < 26; r++) {
      const y = 395 + r * r * 0.62, amp = 3 + r * 0.7, len = 40 + r * 9;
      g.beginPath();
      for (let x = -50; x < 1650; x += len) { g.moveTo(x + ((r * 61) % len), y); g.quadraticCurveTo(x + len * 0.3 + ((r * 61) % len), y - amp, x + len * 0.6 + ((r * 61) % len), y); }
      g.stroke();
    }
    // the ship far away
    g.fillStyle = '#26323b'; g.fillRect(1240, 360, 120, 14);
    g.strokeStyle = '#26323b'; g.lineWidth = 3;
    for (const mx of [1265, 1300, 1335]) { g.beginPath(); g.moveTo(mx, 362); g.lineTo(mx, 290); g.stroke(); }
    g.fillStyle = 'rgba(226,222,208,0.9)'; for (const mx of [1265, 1300, 1335]) g.fillRect(mx - 14, 300, 28, 44);
    // whales: dark backs and spouts
    const whale = (x, y, s) => {
      g.fillStyle = '#10181e';
      g.beginPath(); g.ellipse(x, y, 120 * s, 26 * s, 0, Math.PI, 0); g.fill();
      g.fillStyle = 'rgba(240,244,244,0.85)';
      for (let k = 0; k < 18; k++) { g.beginPath(); g.ellipse(x - 70 * s + Math.sin(k) * 14 * s, y - 40 * s - k * 9 * s, (10 + k * 1.6) * s, (8 + k) * s, 0.3, 0, 7); g.fill(); }
    };
    whale(1020, 470, 1.1); whale(560, 430, 0.7); whale(1380, 445, 0.6);
    // whaleboats with oars and crews
    const boat = (x, y, s, dir) => {
      g.fillStyle = '#e8e1cf';
      g.beginPath(); g.moveTo(x - 110 * s, y); g.quadraticCurveTo(x, y + 34 * s, x + 110 * s, y); g.lineTo(x + 96 * s, y + 6 * s); g.quadraticCurveTo(x, y + 26 * s, x - 96 * s, y + 6 * s); g.fill();
      g.strokeStyle = '#1b1b1b'; g.lineWidth = 4 * s;
      for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(x + k * 32 * s, y + 6 * s); g.lineTo(x + k * 32 * s - dir * 46 * s, y + 46 * s); g.stroke(); }
      g.fillStyle = '#1b1b1b';
      for (let k = -2; k <= 2; k++) { g.beginPath(); g.arc(x + k * 32 * s, y - 14 * s, 8 * s, 0, 7); g.fill(); g.fillRect(x + k * 32 * s - 6 * s, y - 8 * s, 12 * s, 14 * s); }
      g.fillRect(x + dir * 112 * s, y - 40 * s, 7 * s, 40 * s); // harpooneer standing
      g.beginPath(); g.moveTo(x + dir * 116 * s, y - 36 * s); g.lineTo(x + dir * 200 * s, y - 70 * s); g.lineWidth = 3 * s; g.stroke();
    };
    boat(760, 560, 1.25, 1); boat(330, 620, 1.0, 1); boat(1260, 640, 0.9, -1);
    return c;
  },

  /** Part III: the white whale breaching from a dark sea at night, a broken boat in the spray. */
  whiteWhale() {
    const [c, g] = canvas(1600, 800);
    const sky = g.createLinearGradient(0, 0, 0, 800);
    sky.addColorStop(0, '#02040a'); sky.addColorStop(0.55, '#0d1a2a'); sky.addColorStop(1, '#020509');
    g.fillStyle = sky; g.fillRect(0, 0, 1600, 800);
    const moon = g.createRadialGradient(1340, 140, 10, 1340, 140, 260);
    moon.addColorStop(0, 'rgba(200,215,235,0.55)'); moon.addColorStop(1, 'rgba(200,215,235,0)');
    g.fillStyle = moon; g.fillRect(900, 0, 700, 450);
    // the whale: blunt, square head rising to the upper left, body sweeping down into the sea
    g.save(); g.translate(820, 430); g.rotate(0.5);
    const body = g.createLinearGradient(-420, -120, 420, 120);
    body.addColorStop(0, '#ffffff'); body.addColorStop(0.55, '#e4e8ea'); body.addColorStop(1, '#9fa8ad');
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(-430, -95); // top of the square head
    g.quadraticCurveTo(-470, -90, -470, -30); // blunt front
    g.lineTo(-468, 60);
    g.quadraticCurveTo(-455, 100, -390, 108); // lower jaw line
    g.quadraticCurveTo(-60, 150, 260, 70);
    g.quadraticCurveTo(420, 30, 520, 10); // tail stock
    g.lineTo(520, -10);
    g.quadraticCurveTo(300, -60, 60, -110);
    g.quadraticCurveTo(-200, -140, -430, -95);
    g.fill();
    g.strokeStyle = 'rgba(80,90,96,0.6)'; g.lineWidth = 6; // jaw
    g.beginPath(); g.moveTo(-462, 70); g.quadraticCurveTo(-340, 100, -220, 96); g.stroke();
    g.fillStyle = '#20262a'; g.beginPath(); g.ellipse(-300, 30, 9, 6, 0, 0, 7); g.fill(); // eye
    g.fillStyle = '#c7cfd3'; // pectoral fin
    g.beginPath(); g.moveTo(-250, 100); g.quadraticCurveTo(-190, 190, -120, 205); g.quadraticCurveTo(-150, 150, -170, 108); g.fill();
    g.strokeStyle = 'rgba(120,128,134,0.5)'; g.lineWidth = 3; // scars
    for (let k = 0; k < 9; k++) { g.beginPath(); g.moveTo(-160 + k * 55, -80 + (k % 3) * 18); g.lineTo(-110 + k * 55, -60 + (k % 2) * 30); g.stroke(); }
    g.restore();
    // sea surface cutting the body, white water and spray
    const sea = g.createLinearGradient(0, 560, 0, 800);
    sea.addColorStop(0, '#0e2233'); sea.addColorStop(1, '#01060b');
    g.fillStyle = sea;
    g.beginPath(); g.moveTo(0, 600);
    for (let x = 0; x <= 1600; x += 40) g.lineTo(x, 590 + Math.sin(x / 70) * 14 + Math.sin(x / 23) * 6);
    g.lineTo(1600, 800); g.lineTo(0, 800); g.fill();
    g.fillStyle = 'rgba(235,242,245,0.85)';
    for (let k = 0; k < 160; k++) {
      const a = (k * 2.39996) % (Math.PI * 2), r = 30 + ((k * 53) % 260);
      g.beginPath(); g.arc(1110 + Math.cos(a) * r * 1.3, 590 - Math.abs(Math.sin(a)) * r * 0.75, 4 + (k % 5) * 3, 0, 7); g.fill();
    }
    // splintered boat and oars
    g.fillStyle = '#c9bea6';
    g.save(); g.translate(330, 600); g.rotate(0.5);
    g.beginPath(); g.moveTo(-90, 0); g.quadraticCurveTo(0, 30, 70, 2); g.lineTo(60, 10); g.quadraticCurveTo(0, 26, -80, 8); g.fill(); g.restore();
    g.strokeStyle = '#c9bea6'; g.lineWidth = 5;
    for (const [x, y, a] of [[420, 560, 0.9], [250, 640, -0.4], [480, 630, 0.2]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 90, y + Math.sin(a) * 90); g.stroke(); }
    return c;
  },
};
