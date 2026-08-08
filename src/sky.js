import * as THREE from 'three';

// Sky presentation (wishlist #10): a vertical-gradient background, a sun and
// moon disc riding the day cycle, and a night starfield. Pure presentation —
// nothing here is read by the simulation.

function discTexture(inner, outer, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.12, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.55, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Sky {
  constructor(scene) {
    this.scene = scene;

    // sky dome: inverted sphere with a vertical-gradient canvas texture —
    // renders predictably everywhere (scene.background equirect caching does
    // not re-convert reliably on per-frame canvas updates)
    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.width = 1;
    this.bgCanvas.height = 256;
    this.bgTex = new THREE.CanvasTexture(this.bgCanvas);
    this.bgTex.colorSpace = THREE.SRGBColorSpace;
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(240, 24, 16),
      new THREE.MeshBasicMaterial({ map: this.bgTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.dome.renderOrder = -3;
    this.dome.frustumCulled = false;
    scene.add(this.dome);
    this._lastHorizon = null;

    const spriteMat = (tex, scale) => {
      const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
      const s = new THREE.Sprite(m);
      s.scale.setScalar(scale);
      s.renderOrder = -1;
      return s;
    };
    this.sunDisc = spriteMat(discTexture('rgba(255,244,214,1)', 'rgba(255,196,110,0.85)'), 26);
    this.moonDisc = spriteMat(discTexture('rgba(214,226,238,0.95)', 'rgba(150,170,195,0.5)'), 15);
    scene.add(this.sunDisc, this.moonDisc);

    // starfield: fixed points on the upper hemisphere, faded in by night
    const N = 450;
    const pos = new Float32Array(N * 3);
    let seed = 1337;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < N; i++) {
      const az = rnd() * Math.PI * 2;
      const el2 = Math.asin(rnd() * 0.95 + 0.05); // keep off the horizon line
      const r = 150;
      pos[i * 3] = Math.cos(az) * Math.cos(el2) * r;
      pos[i * 3 + 1] = Math.sin(el2) * r;
      pos[i * 3 + 2] = Math.sin(az) * Math.cos(el2) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xdde8f2, size: 1.4, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, fog: false,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.renderOrder = -2;
    scene.add(this.stars);
  }

  setVisible(v) {
    this.sunDisc.visible = this.moonDisc.visible = this.stars.visible = v;
    this.dome.visible = v;
    if (!v) this._lastHorizon = null; // force a gradient redraw on re-enable
  }

  // horizon: THREE.Color (also the fog color); daylight: 0..1; sunAngle: rad
  update(camera, sunAngle, daylight, horizon) {
    this.setVisible(true);
    // redraw the gradient only when the horizon color actually moved.
    // SphereGeometry v runs 0 at the top pole → 1 at the bottom, and the
    // canvas is drawn y-down, so canvas row 0 = zenith, row 255 = nadir;
    // the horizon band sits at the sphere's equator (canvas middle).
    const key = horizon.getHex();
    if (key !== this._lastHorizon) {
      this._lastHorizon = key;
      const zen = horizon.clone().multiplyScalar(0.45).lerp(new THREE.Color(0x06090f), 0.25);
      const ctx = this.bgCanvas.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, '#' + zen.getHexString());
      g.addColorStop(0.38, '#' + horizon.clone().lerp(zen, 0.5).getHexString());
      g.addColorStop(0.5, '#' + horizon.getHexString());
      g.addColorStop(1, '#' + horizon.getHexString());
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1, 256);
      this.bgTex.needsUpdate = true;
    }
    this.dome.position.copy(camera.position);

    // discs ride a dome centered on the camera so they never parallax
    const r = 140;
    const dir = new THREE.Vector3(Math.cos(sunAngle), Math.sin(sunAngle), 0.32).normalize();
    this.sunDisc.position.copy(camera.position).addScaledVector(dir, r);
    this.moonDisc.position.copy(camera.position).addScaledVector(dir, -r);
    this.sunDisc.material.opacity = Math.min(1, Math.max(0, dir.y + 0.12) * 4);
    this.moonDisc.material.opacity = Math.min(0.9, Math.max(0, -dir.y + 0.12) * 3.2);

    this.stars.position.copy(camera.position);
    this.starMat.opacity = Math.max(0, 1 - daylight * 2.4) * 0.9;
  }
}
