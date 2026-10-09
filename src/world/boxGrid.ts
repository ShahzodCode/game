import * as THREE from 'three';

/**
 * Uniform grid over the collision boxes (x/z cells), so collision and projectile code only looks at the handful of
 * boxes near a point instead of all ~700. A box that spans several cells is listed in each of them. Boxes are kept
 * by reference, so a door that empties / refills its box keeps working.
 */
export class BoxGrid {
  private cells = new Map<number, THREE.Box3[]>();
  private stamp = new Map<THREE.Box3, number>();
  private query = 0;
  constructor(boxes: THREE.Box3[], private cell = 6) {
    for (const b of boxes) {
      if (b.isEmpty()) continue;
      const i0 = Math.floor(b.min.x / cell), i1 = Math.floor(b.max.x / cell);
      const j0 = Math.floor(b.min.z / cell), j1 = Math.floor(b.max.z / cell);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = this.key(i, j);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(b);
        }
      }
    }
  }
  private key(i: number, j: number) {
    return (i + 512) * 1024 + (j + 512);
  }
  /** Boxes whose cells touch the square of half-size `r` around (x, z). A fresh array every call (safe to nest). */
  near(x: number, z: number, r: number): THREE.Box3[] {
    const c = this.cell;
    const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c);
    const j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
    const out: THREE.Box3[] = [];
    const q = ++this.query;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const b of list) {
          if (this.stamp.get(b) === q) continue;
          this.stamp.set(b, q);
          out.push(b);
        }
      }
    }
    return out;
  }
}
