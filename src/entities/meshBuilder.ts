import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Builds one mesh out of many small shapes (spheres, tapered cylinders, boxes...), each with its own
 * colour, by merging them into a single geometry with vertex colours. A character can then have dozens
 * of tiny details (buttons, eyes, straps) while a body part is still just one draw call and one
 * hit-testable mesh.
 */
type V3 = [number, number, number];
export interface Xf {
  p?: V3; // position
  r?: V3; // rotation (radians, x y z)
  s?: V3 | number; // scale
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const triple = (s: V3 | number | undefined): V3 => (s === undefined ? [1, 1, 1] : typeof s === 'number' ? [s, s, s] : s);

// shared unit shapes (cloned and transformed per use)
// Spheres come in three detail levels: tiny details (buttons, fingers) do not need many polygons.
const UNIT = {
  ballHi: new THREE.SphereGeometry(1, 14, 10),
  ballMid: new THREE.SphereGeometry(1, 9, 6),
  ballLow: new THREE.SphereGeometry(1, 6, 4),
  cube: new THREE.BoxGeometry(1, 1, 1),
};

export class MeshBuilder {
  private geos: THREE.BufferGeometry[] = [];

  /** Add a geometry. `own` = the geometry was created just for this call, so it need not be cloned. */
  geo(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, xf: Xf = {}, own = false) {
    const geo = own ? g : g.clone();
    const sc = triple(xf.s);
    const rot = xf.r ?? [0, 0, 0];
    const pos = xf.p ?? [0, 0, 0];
    _e.set(rot[0], rot[1], rot[2]);
    _q.setFromEuler(_e);
    _p.set(pos[0], pos[1], pos[2]);
    _s.set(sc[0], sc[1], sc[2]);
    _m.compose(_p, _q, _s);
    geo.applyMatrix4(_m);

    _c.set(color);
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(geo.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') geo.deleteAttribute(k);
    }
    this.geos.push(geo);
    return this;
  }

  /** Ellipsoid: radius `r`, stretched by xf.s. */
  ball(color: THREE.ColorRepresentation, r: number, xf: Xf = {}) {
    const s = triple(xf.s);
    const size = r * Math.max(s[0], s[1], s[2]);
    const base = size < 0.02 ? UNIT.ballLow : size < 0.05 ? UNIT.ballMid : UNIT.ballHi;
    return this.geo(base, color, { ...xf, s: [s[0] * r, s[1] * r, s[2] * r] });
  }
  box(color: THREE.ColorRepresentation, w: number, h: number, d: number, xf: Xf = {}) {
    const s = triple(xf.s);
    return this.geo(UNIT.cube, color, { ...xf, s: [s[0] * w, s[1] * h, s[2] * d] });
  }
  /** Tapered cylinder (top radius, bottom radius, height). */
  cyl(color: THREE.ColorRepresentation, rTop: number, rBottom: number, h: number, xf: Xf = {}, seg?: number) {
    const r = Math.max(rTop, rBottom);
    const n = seg ?? (r < 0.03 ? 5 : r < 0.075 ? 8 : 12);
    return this.geo(new THREE.CylinderGeometry(rTop, rBottom, h, n, 1), color, xf, true);
  }
  cone(color: THREE.ColorRepresentation, r: number, h: number, xf: Xf = {}, seg = 6) {
    return this.geo(new THREE.ConeGeometry(r, h, seg, 1), color, xf, true);
  }
  /** Ring: radius R, tube thickness t. Lies in the XY plane unless rotated (r: [PI/2,0,0] makes it horizontal). */
  torus(color: THREE.ColorRepresentation, R: number, t: number, xf: Xf = {}) {
    const s = triple(xf.s);
    const around = R < 0.05 ? 8 : R < 0.12 ? 12 : 16;
    return this.geo(new THREE.TorusGeometry(R, t, 4, around), color, { ...xf, s }, true);
  }
  /** Upper part of a sphere (hair caps, hats). theta = how far down it reaches, in radians (PI/2 = half). */
  dome(color: THREE.ColorRepresentation, r: number, xf: Xf = {}, theta = Math.PI / 2) {
    const s = triple(xf.s);
    return this.geo(new THREE.SphereGeometry(r, r < 0.05 ? 7 : 12, 6, 0, Math.PI * 2, 0, theta), color, { ...xf, s }, true);
  }
  /** Surface of revolution from [radius, y] points (torsos, hats). */
  lathe(color: THREE.ColorRepresentation, pts: [number, number][], xf: Xf = {}, seg = 16) {
    return this.geo(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), color, xf, true);
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.geos, false);
    for (const g of this.geos) g.dispose();
    this.geos = [];
    if (!merged) throw new Error('MeshBuilder: nothing to build (or incompatible geometries)');
    return merged;
  }
}
