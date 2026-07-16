import * as THREE from 'three';

// A small pool of point lights reassigned each frame to the nearest active
// emitters. Avoids thousands of lights while still lighting torches, lamps,
// fires and running machines near the player.
export class LightPool {
  constructor(scene, count = 20) {
    this.lights = [];
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 14, 1.6);
      l.visible = false;
      scene.add(l);
      this.lights.push(l);
    }
    this.emitters = new Map(); // key -> {x,y,z,color,intensity,range}
  }

  set(key, x, y, z, color, intensity, range = 12) {
    this.emitters.set(key, { x, y, z, color, intensity, range });
  }
  remove(key) { this.emitters.delete(key); }
  clear() { this.emitters.clear(); }

  update(camPos) {
    const arr = [...this.emitters.values()];
    // sort by distance to camera, keep nearest N
    arr.sort((a, b) =>
      ((a.x - camPos.x) ** 2 + (a.y - camPos.y) ** 2 + (a.z - camPos.z) ** 2) -
      ((b.x - camPos.x) ** 2 + (b.y - camPos.y) ** 2 + (b.z - camPos.z) ** 2));
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const e = arr[i];
      if (e) {
        l.visible = true;
        l.position.set(e.x, e.y, e.z);
        l.color.setHex(e.color);
        l.intensity = e.intensity;
        l.distance = e.range;
      } else {
        l.visible = false;
        l.intensity = 0;
      }
    }
  }
}
