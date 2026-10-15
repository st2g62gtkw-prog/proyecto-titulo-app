/**
 * Recorridos de camiones dentro de la faena. Un recorrido es una secuencia de tramos;
 * cada tramo es una curva suave y puede hacerse en retroceso.
 */
import * as THREE from 'three';

export interface Pose {
  x: number;
  z: number;
  /** Rumbo del vehículo (hacia dónde apunta la cabina): atan2(dz, dx). */
  heading: number;
}

interface Segment {
  curve: THREE.CatmullRomCurve3;
  length: number;
  reverse: boolean;
}

export class Route {
  private segs: Segment[] = [];
  length = 0;

  /** Agrega un tramo por los puntos [x, z]. En retroceso la cabina mira contra el avance. */
  add(points: [number, number][], reverse = false) {
    const pts = points.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    const length = curve.getLength();
    this.segs.push({ curve, length, reverse });
    this.length += length;
    return this;
  }

  /** Pose a la distancia s (m) desde el inicio. */
  at(s: number): Pose {
    s = Math.min(Math.max(s, 0), this.length);
    for (const seg of this.segs) {
      if (s <= seg.length || seg === this.segs[this.segs.length - 1]) {
        const u = seg.length > 0 ? Math.min(s / seg.length, 1) : 0;
        const p = seg.curve.getPointAt(u);
        const tan = seg.curve.getTangentAt(Math.min(Math.max(u, 0.001), 0.999));
        let heading = Math.atan2(tan.z, tan.x);
        if (seg.reverse) heading += Math.PI;
        return { x: p.x, z: p.z, heading };
      }
      s -= seg.length;
    }
    return { x: 0, z: 0, heading: 0 };
  }
}

/** Avance con aceleración y frenado suaves: u ∈ [0,1] → fracción del recorrido. */
export function easeTravel(u: number) {
  u = Math.min(Math.max(u, 0), 1);
  return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
}
