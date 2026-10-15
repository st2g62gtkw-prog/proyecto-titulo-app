/** Texturas procedurales (CanvasTexture) para materiales de obra. */
import * as THREE from 'three';

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.anisotropy = 8;
  return tx;
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, amount: number, alpha: number) {
  const img = g.getImageData(0, 0, w, h);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    img.data[i + 3] = 255 * alpha + (img.data[i + 3] * (1 - alpha));
  }
  g.putImageData(img, 0, 0);
}

/** Hormigón visto: gris claro con leve moteado y marcas de moldaje cada 2,4 m. */
export function concreteTexture() {
  return canvas(256, 256, (g) => {
    g.fillStyle = '#b9b7b1';
    g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 22, 1);
    g.strokeStyle = 'rgba(80,80,80,0.18)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 0.5); g.lineTo(256, 0.5); g.stroke();
    g.fillStyle = 'rgba(60,60,60,0.22)';
    for (let i = 0; i < 6; i++) g.fillRect(28 + i * 40, 120, 3, 3); // tapones de amarras
  });
}

/** Panel de moldaje metálico: marco perimetral, nervios y placa gris. Un módulo de 1,2 × 2,4 m. */
export function formPanelTexture() {
  return canvas(128, 256, (g) => {
    g.fillStyle = '#8e99a3';
    g.fillRect(0, 0, 128, 256);
    noise(g, 128, 256, 10, 1);
    g.strokeStyle = '#4f5a64';
    g.lineWidth = 7;
    g.strokeRect(3.5, 3.5, 121, 249);
    g.lineWidth = 3;
    for (const y of [64, 128, 192]) { g.beginPath(); g.moveTo(4, y); g.lineTo(124, y); g.stroke(); }
    g.beginPath(); g.moveTo(64, 4); g.lineTo(64, 252); g.stroke();
    g.fillStyle = '#d9a514';
    g.fillRect(10, 10, 14, 6); // etiqueta del proveedor
  });
}

/** Placa fenólica de losa: 2,44 × 1,22 m, café rojizo con juntas. */
export function plywoodTexture() {
  return canvas(256, 128, (g) => {
    g.fillStyle = '#7a4632';
    g.fillRect(0, 0, 256, 128);
    noise(g, 256, 128, 18, 1);
    g.fillStyle = 'rgba(255,220,180,0.06)';
    for (let i = 0; i < 18; i++) g.fillRect(0, i * 7 + 2, 256, 2);
    g.strokeStyle = 'rgba(40,20,10,0.55)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, 254, 126);
  });
}
