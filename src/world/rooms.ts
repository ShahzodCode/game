import * as THREE from 'three';
import { buildWeaponShopProps } from './shopProps';

/**
 * The rooms around the arena, laid out along +z behind the arena's south wall:
 *
 *   arena (z < 60)  --gate 2--  airlock with candles (z 60..80)  --gate 1--  safe room with the weapon shop (z 80..107)
 *
 * The player starts in the safe room, walks through the open gate 1 into the airlock, gate 1 seals behind them
 * (the level loads while it is shut), then gate 2 opens onto the arena. Coming back, the same happens in reverse.
 */
export const ARENA_GATE_Z = 60;
export const GATE1_Z = 80;
const GATE_WIDTH = 10;
const GATE_HEIGHT = 6.2;
const ROOM_HEIGHT = 7.5;

const STONE_ARENA = 0x8d8577;
const STONE_DARK = 0x4a4640;
const STONE_LIGHT = 0xb5ad9c;
const ease = (t: number) => t * t * (3 - 2 * t);

/** A huge two-panel sliding door. The panels are solid (player collision) while closed. */
export class Door {
  readonly collision: THREE.Box3[] = [new THREE.Box3(), new THREE.Box3()];
  private panels: THREE.Mesh[] = [];
  private amount = 0; // 0 = closed, 1 = open
  private target = 0;
  /** Called when the doors start moving (used for the rumble sound). */
  onStart?: () => void;

  constructor(scene: THREE.Scene, boxes: THREE.Box3[], blockers: THREE.Object3D[], readonly x: number, readonly z: number) {
    const w = GATE_WIDTH / 2;
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.7 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xb8913c, roughness: 0.4, metalness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 0.6, metalness: 0.6 });
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? -1 : 1;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w, GATE_HEIGHT, 0.6), mat);
      panel.castShadow = false;
      // reinforcing ribs and a golden band so the doors read as a massive vault door
      for (const rx of [-0.34, 0, 0.34]) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.28, GATE_HEIGHT - 0.5, 0.12), dark);
        rib.position.set(rx * w, 0, 0.34);
        panel.add(rib);
        const rib2 = rib.clone();
        rib2.position.z = -0.34;
        panel.add(rib2);
      }
      for (const by of [-2.2, 0, 2.2]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.22, 0.14), trim);
        band.position.set(0, by, 0.34);
        panel.add(band);
        const band2 = band.clone();
        band2.position.z = -0.34;
        panel.add(band2);
      }
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 16), trim);
      knob.rotation.x = Math.PI / 2;
      knob.position.set(-sign * (w / 2 - 0.45), 0, 0.4);
      panel.add(knob);
      panel.position.set(x + sign * (w / 2), GATE_HEIGHT / 2, z);
      scene.add(panel);
      blockers.push(panel);
      boxes.push(this.collision[i]);
      this.panels.push(panel);
    }
    this.apply();
  }

  setOpen(open: boolean, instant = false) {
    const t = open ? 1 : 0;
    if (t !== this.target && !instant) this.onStart?.();
    this.target = t;
    if (instant) {
      this.amount = t;
      this.apply();
    }
  }
  get isOpen() {
    return this.amount >= 0.999;
  }
  get isClosed() {
    return this.amount <= 0.001;
  }
  get wantsOpen() {
    return this.target === 1;
  }

  update(dt: number) {
    if (this.amount === this.target) return;
    const step = dt / 1.8; // takes 1.8 s
    this.amount = this.amount < this.target ? Math.min(this.target, this.amount + step) : Math.max(this.target, this.amount - step);
    this.apply();
  }

  private apply() {
    const w = GATE_WIDTH / 2;
    const e = ease(this.amount);
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? -1 : 1;
      const cx = this.x + sign * (w / 2 + w * e); // slides sideways into the wall pocket
      this.panels[i].position.x = cx;
      this.collision[i].min.set(cx - w / 2, 0, this.z - 0.3);
      this.collision[i].max.set(cx + w / 2, GATE_HEIGHT, this.z + 0.3);
    }
  }
}

export interface Rooms {
  gate1: Door; // safe room <-> airlock
  gate2: Door; // airlock <-> arena
  hubSpawn: THREE.Vector3;
  /** Weapon shop zone inside the safe room. */
  hubShop: { pos: THREE.Vector3; radius: number };
  /** Bright light around the arena gate (shown once the level can be left). */
  setExitLight: (on: boolean) => void;
  update: (dt: number, time: number) => void;
}

function signTexture(text: string) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1d2a3a';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#ffd84a';
  g.lineWidth = 8;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = '#ffd84a';
  g.font = 'bold 66px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Vertical gradient used as an alpha map: opaque at the bottom of a cylinder, smoothly transparent at the top. */
function fadeTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 256; y++) {
    const t = y / 255; // 0 = top of the beam, 1 = bottom
    const a = Math.pow(t, 2.2) * (0.25 + 0.75 * Math.min(1, t * 6 + 0.0)); // soft towards the top, a gentle start at the ground
    const v = Math.round(255 * Math.min(1, a));
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(0, y, 4, 1);
  }
  return new THREE.CanvasTexture(c);
}

/** Soft round dot for the light motes. */
function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,245,210,0.6)');
  grad.addColorStop(1, 'rgba(255,245,210,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** A thin static board with text on its +z face (rotate it to face where customers stand). */
export function makeSignBoard(text: string, w: number, h: number) {
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2a3a, roughness: 0.7 });
  const face = new THREE.MeshBasicMaterial({ map: signTexture(text) });
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), [dark, dark, dark, dark, face, dark]);
}

export function buildRooms(scene: THREE.Scene, boxes: THREE.Box3[], blockers: THREE.Object3D[]): Rooms {
  /** Solid block: visible, stops bullets, and (optionally) blocks the player. */
  const solid = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number, collide = true, rough = 0.9) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0),
      new THREE.MeshStandardMaterial({ color, roughness: rough }),
    );
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.receiveShadow = false;
    scene.add(m);
    blockers.push(m);
    if (collide) boxes.push(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)));
    return m;
  };

  // ---------- gates: huge pillars, a lintel, and sliding doors ----------
  const frame = (z: number) => {
    // pillars on both sides of the opening (x 5..6.6) and a lintel across the top
    solid(-6.6, -5, 0, 8.4, z - 0.9, z + 0.9, 0x6f6a5f);
    solid(5, 6.6, 0, 8.4, z - 0.9, z + 0.9, 0x6f6a5f);
    solid(-6.6, 6.6, GATE_HEIGHT, 8.4, z - 0.9, z + 0.9, 0x6f6a5f);
    // golden caps
    solid(-6.8, -4.8, 8.4, 8.8, z - 1.1, z + 1.1, 0xb8913c, false, 0.4);
    solid(4.8, 6.8, 8.4, 8.8, z - 1.1, z + 1.1, 0xb8913c, false, 0.4);
  };
  frame(ARENA_GATE_Z);
  frame(GATE1_Z);
  const gate2 = new Door(scene, boxes, blockers, 0, ARENA_GATE_Z);
  const gate1 = new Door(scene, boxes, blockers, 0, GATE1_Z);
  gate2.setOpen(false, true);
  gate1.setOpen(true, true);

  // ---------- airlock: a smallish dark room lit by candles ----------
  const AX = 6; // interior half-width
  // NOTE: no two pieces may overlap with the same flat face and different colours, or the graphics card
  // flickers between them (z-fighting). Every piece below therefore only touches its neighbours.
  const AZ0 = ARENA_GATE_Z + 0.5; // the arena's south wall (z 59.5..60.5) closes the airlock on this side
  const AZ1 = GATE1_Z - 0.5; // the hub's gate wall closes it on the other side
  solid(-AX - 1, -AX, 0, ROOM_HEIGHT, AZ0, AZ1, STONE_DARK); // left wall
  solid(AX, AX + 1, 0, ROOM_HEIGHT, AZ0, AZ1, STONE_DARK); // right wall
  // fills the gap above the arena wall (it is only 4 m high) beside the gate
  solid(-AX - 1, -6.6, 4, ROOM_HEIGHT, ARENA_GATE_Z - 0.5, ARENA_GATE_Z + 0.5, STONE_DARK);
  solid(6.6, AX + 1, 4, ROOM_HEIGHT, ARENA_GATE_Z - 0.5, ARENA_GATE_Z + 0.5, STONE_DARK);
  solid(-AX - 1, AX + 1, -0.4, 0, ARENA_GATE_Z, GATE1_Z, 0x2c2a27, false); // floor (starts where the arena terrain ends)
  solid(-AX - 1, AX + 1, ROOM_HEIGHT, ROOM_HEIGHT + 0.5, ARENA_GATE_Z, GATE1_Z, 0x25231f, false); // ceiling
  // worn runner down the middle
  solid(-1.6, 1.6, 0, 0.02, ARENA_GATE_Z + 1, GATE1_Z - 1, 0x4a2020, false, 1);
  // candles on stone pedestals along both walls, plus a few real light sources that flicker
  const wax = new THREE.MeshStandardMaterial({ color: 0xf0e6c8, roughness: 0.8 });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x57524b, roughness: 0.95 });
  const flames: THREE.Mesh[] = [];
  const candleLights: THREE.PointLight[] = [];
  for (let i = 0; i < 5; i++) {
    const z = ARENA_GATE_Z + 3.5 + i * 3.7;
    for (const s of [-1, 1]) {
      const x = s * (AX - 0.7);
      const ped = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.6), stone);
      ped.position.set(x, 0.45, z);
      scene.add(ped);
      boxes.push(new THREE.Box3(new THREE.Vector3(x - 0.3, 0, z - 0.3), new THREE.Vector3(x + 0.3, 0.9, z + 0.3)));
      for (const [dx, dz, h] of [[0, 0, 0.55], [0.13, 0.08, 0.38], [-0.12, -0.07, 0.3]] as [number, number, number][]) {
        const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, h, 10), wax);
        candle.position.set(x + dx, 0.9 + h / 2, z + dz);
        scene.add(candle);
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.13, 8), flameMat);
        flame.position.set(x + dx, 0.9 + h + 0.07, z + dz);
        scene.add(flame);
        flames.push(flame);
      }
      if ((i + (s > 0 ? 1 : 0)) % 2 === 0) {
        const light = new THREE.PointLight(0xff9a45, 30, 15, 2);
        light.position.set(x, 1.8, z);
        scene.add(light);
        candleLights.push(light);
      }
    }
  }
  // a big iron candelabra in the middle of the room
  const iron = new THREE.MeshStandardMaterial({ color: 0x1d1d20, roughness: 0.5, metalness: 0.7 });
  const cand = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 2.2, 8), iron);
  cand.position.set(0, 1.1, ARENA_GATE_Z + 10);
  scene.add(cand);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const cx = Math.cos(a) * 0.45, cz = Math.sin(a) * 0.45;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.4, 8), wax);
    c.position.set(cx, 2.4, ARENA_GATE_Z + 10 + cz);
    scene.add(c);
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 8), flameMat);
    f.position.set(cx, 2.66, ARENA_GATE_Z + 10 + cz);
    scene.add(f);
    flames.push(f);
  }
  boxes.push(new THREE.Box3(new THREE.Vector3(-0.15, 0, ARENA_GATE_Z + 9.85), new THREE.Vector3(0.15, 2.2, ARENA_GATE_Z + 10.15)));
  const centerLight = new THREE.PointLight(0xff9a45, 40, 16, 2);
  centerLight.position.set(0, 2.9, ARENA_GATE_Z + 10);
  scene.add(centerLight);
  candleLights.push(centerLight);

  // ---------- safe room: bright and welcoming, with the weapon shop ----------
  const HX = 13;
  const HZ0 = GATE1_Z + 0.5, HZ1 = 106.5;
  solid(-HX - 1, -HX, 0, ROOM_HEIGHT, GATE1_Z - 0.5, HZ1 + 0.5, STONE_LIGHT); // left wall
  solid(HX, HX + 1, 0, ROOM_HEIGHT, GATE1_Z - 0.5, HZ1 + 0.5, STONE_LIGHT); // right wall
  solid(-HX, HX, 0, ROOM_HEIGHT, HZ1, HZ1 + 0.5, STONE_LIGHT); // back wall (between the side walls)
  solid(-HX, -6.6, 0, ROOM_HEIGHT, GATE1_Z - 0.5, GATE1_Z + 0.5, STONE_LIGHT); // wall around gate 1; the gate pillars (x 5..6.6) fill the rest
  solid(6.6, HX, 0, ROOM_HEIGHT, GATE1_Z - 0.5, GATE1_Z + 0.5, STONE_LIGHT);
  solid(-HX - 1, HX + 1, -0.4, 0, GATE1_Z, HZ1 + 0.5, 0x6b6760, false); // floor (starts exactly where the airlock floor ends)
  solid(-HX - 1, HX + 1, ROOM_HEIGHT, ROOM_HEIGHT + 0.5, GATE1_Z, HZ1 + 0.5, 0xc9c2b2, false); // ceiling
  solid(-3, 3, 0, 0.02, HZ0 + 2, HZ1 - 2, 0x7a2a2a, false, 1); // red rug  // columns and wall panels for some character
  for (const s of [-1, 1]) {
    for (const z of [84, 88.5, 99.5, 104]) {
      solid(s * (HX - 0.6) - 0.4, s * (HX - 0.6) + 0.4, 0, ROOM_HEIGHT, z - 0.4, z + 0.4, 0x9c9484, false);
    }
  }
  // ceiling lamps (glowing panels + real lights)
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1d0 });
  for (const z of [86, 95, 103]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 1.2), lampMat);
    lamp.position.set(0, ROOM_HEIGHT - 0.1, z);
    scene.add(lamp);
    const light = new THREE.PointLight(0xfff0d8, 190, 40, 2);
    light.position.set(0, ROOM_HEIGHT - 1.2, z);
    scene.add(light);
  }

  // weapon shop kiosk against the left wall
  const KX = -HX; // wall surface
  solid(KX + 1.2, KX + 2.2, 0, 1.1, 91.5, 96.5, 0x3b6ea8); // counter
  solid(KX, KX + 0.4, 0, 3.0, 91, 97, 0x2f3b52); // back panel
  // awning, sign, gun racks with the real gun models, display case, lamp: see shopProps.ts
  buildWeaponShopProps(scene, boxes, KX, makeSignBoard);
  const hubShop = { pos: new THREE.Vector3(KX + 4.4, 0, 94), radius: 3.4 };
  const hubSpawn = new THREE.Vector3(0, 0, 98);

  // ---------- exit light (shown when the level can be left) ----------
  const exit = new THREE.Group();
  exit.visible = false;
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xfff2c0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(GATE_WIDTH - 0.4, GATE_HEIGHT), glowMat);
  veil.position.set(0, GATE_HEIGHT / 2, ARENA_GATE_Z - 0.9);
  exit.add(veil);
  // the beam: two nested open cylinders whose opacity fades smoothly to nothing towards the top,
  // so the light dissolves into the sky instead of ending in a hard edge
  const fade = fadeTexture();
  const BEAM_H = 64;
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff6d8, transparent: true, opacity: 0.2, alphaMap: fade, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 5.0, BEAM_H, 36, 1, true), beamMat); // widens as it rises
  beam.position.set(0, BEAM_H / 2, ARENA_GATE_Z - 2.5);
  exit.add(beam);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.22, alphaMap: fade, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 2.6, BEAM_H, 28, 1, true), coreMat);
  core.position.set(0, BEAM_H / 2, ARENA_GATE_Z - 2.5);
  exit.add(core);
  // glowing motes drifting up inside the beam
  const MOTES = 70;
  const motePos = new Float32Array(MOTES * 3);
  const moteCol = new Float32Array(MOTES * 3);
  const moteSpeed = new Float32Array(MOTES);
  const seedMote = (i: number, fromGround: boolean) => {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 4.2;
    motePos[i * 3] = Math.cos(a) * r;
    motePos[i * 3 + 1] = fromGround ? 0 : Math.random() * 30;
    motePos[i * 3 + 2] = ARENA_GATE_Z - 2.5 + Math.sin(a) * r;
    moteSpeed[i] = 0.8 + Math.random() * 1.6;
  };
  for (let i = 0; i < MOTES; i++) seedMote(i, false);
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  moteGeo.setAttribute('color', new THREE.BufferAttribute(moteCol, 3));
  const motes = new THREE.Points(
    moteGeo,
    new THREE.PointsMaterial({
      size: 0.45, map: softDot(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  motes.frustumCulled = false;
  exit.add(motes);
  const frameGlow = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const [x, y, w, h] of [[-5.2, 3.1, 0.25, 6.4], [5.2, 3.1, 0.25, 6.4], [0, 6.3, 10.6, 0.25]] as [number, number, number, number][]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.3), frameGlow);
    bar.position.set(x, y, ARENA_GATE_Z - 1);
    exit.add(bar);
  }
  const exitLight = new THREE.PointLight(0xfff4d0, 900, 70, 2);
  exitLight.position.set(0, 4, ARENA_GATE_Z - 4);
  exit.add(exitLight);
  scene.add(exit);

  return {
    gate1,
    gate2,
    hubSpawn,
    hubShop,
    setExitLight: (on) => {
      exit.visible = on;
    },
    update: (dt, time) => {
      gate1.update(dt);
      gate2.update(dt);
      // candle flames flicker
      flames.forEach((f, i) => {
        const k = 1 + Math.sin(time * 9 + i * 1.7) * 0.18 + Math.sin(time * 23 + i) * 0.1;
        f.scale.set(1 / Math.sqrt(k), k, 1 / Math.sqrt(k));
      });
      candleLights.forEach((l, i) => {
        l.intensity = (i === candleLights.length - 1 ? 40 : 30) * (0.88 + Math.sin(time * 7 + i * 2.3) * 0.08 + Math.sin(time * 19 + i) * 0.05);
      });
      if (exit.visible) {
        const p = 0.5 + 0.5 * Math.sin(time * 3);
        glowMat.opacity = 0.35 + p * 0.25;
        beamMat.opacity = 0.16 + p * 0.08;
        coreMat.opacity = 0.18 + p * 0.1;
        exitLight.intensity = 800 + p * 400;
        // motes rise and brighten/dim: dark = invisible with additive blending, so they fade out with height
        for (let i = 0; i < MOTES; i++) {
          motePos[i * 3 + 1] += moteSpeed[i] * dt;
          if (motePos[i * 3 + 1] > 32) seedMote(i, true);
          const h = 1 - motePos[i * 3 + 1] / 32;
          const b = Math.max(0, h) ** 1.4 * (0.6 + 0.4 * Math.sin(time * 4 + i));
          moteCol[i * 3] = moteCol[i * 3 + 1] = moteCol[i * 3 + 2] = b;
        }
        moteGeo.attributes.position.needsUpdate = true;
        moteGeo.attributes.color.needsUpdate = true;
      }
    },
  };
}
