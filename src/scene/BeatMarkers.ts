import * as THREE from 'three';
import type { Theme } from '../theme/types';

const MAX_MARKERS = 256;
const SCROLL_PX_PER_SEC = 120; // must match NoteRain

/**
 * Horizontal beat + bar lines that scroll with the falling notes.
 * Two InstancedMeshes, one for beats (thin) and one for bars (thicker).
 * Both at z = 0.5, just below the note bars at z = 2.
 */
export class BeatMarkers {
  private scene: THREE.Scene;
  private beatMesh: THREE.InstancedMesh;
  private barMesh: THREE.InstancedMesh;
  private beatMat: THREE.MeshBasicMaterial;
  private barMat: THREE.MeshBasicMaterial;
  private dummy = new THREE.Object3D();
  private bpm = 120;
  private duration = 0;
  private pianoTop = 0;
  private sceneH = 0;
  private sceneW = 0;
  /** Beats-per-bar (time-signature numerator). Defaults to 4. */
  private beatsPerBar = 4;
  private beatsEnabled = false;
  private barsEnabled = false;
  private barThickness = 2;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const beatGeo = new THREE.PlaneGeometry(1, 1);
    this.beatMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false });
    this.beatMesh = new THREE.InstancedMesh(beatGeo, this.beatMat, MAX_MARKERS);
    this.beatMesh.frustumCulled = false;
    this.beatMesh.count = 0;
    this.beatMesh.visible = false;
    scene.add(this.beatMesh);

    const barGeo = new THREE.PlaneGeometry(1, 1);
    this.barMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false });
    this.barMesh = new THREE.InstancedMesh(barGeo, this.barMat, MAX_MARKERS);
    this.barMesh.frustumCulled = false;
    this.barMesh.count = 0;
    this.barMesh.visible = false;
    scene.add(this.barMesh);
  }

  configure(bpm: number, duration: number, sceneW: number, sceneH: number, pianoTop: number) {
    this.bpm = Math.max(20, bpm);
    this.duration = duration;
    this.sceneW = sceneW;
    this.sceneH = sceneH;
    this.pianoTop = pianoTop;
  }

  applyTheme(theme: Theme) {
    this.beatsEnabled = theme.markers.beats.enabled;
    this.barsEnabled = theme.markers.bars.enabled;
    this.beatMat.color.set(theme.markers.beats.color);
    this.beatMat.opacity = theme.markers.beats.opacity;
    this.barMat.color.set(theme.markers.bars.color);
    this.barMat.opacity = theme.markers.bars.opacity;
    this.barThickness = theme.markers.bars.thickness;
    this.beatsPerBar = Math.max(1, Math.floor(theme.markers.beatsPerBar));
  }

  setVisible(visible: boolean) {
    this.beatMesh.visible = visible && this.beatsEnabled;
    this.barMesh.visible = visible && this.barsEnabled;
  }

  update(currentTime: number) {
    if (!this.beatsEnabled && !this.barsEnabled) {
      this.beatMesh.count = 0;
      this.barMesh.count = 0;
      return;
    }
    const beatInterval = 60 / this.bpm;
    // Visible time range: from pianoTop (current) up to end of viewport.
    const lookAhead = ((this.sceneH * 3) / SCROLL_PX_PER_SEC) + 1; // matches TOP_CULL_FACTOR=3 in NoteRain
    const startTime = currentTime;
    const endTime = currentTime + lookAhead;
    const firstBeat = Math.max(0, Math.ceil(startTime / beatInterval));
    const lastBeat = Math.min(Math.floor(this.duration / beatInterval), Math.floor(endTime / beatInterval));

    let beatCount = 0, barCount = 0;
    const d = this.dummy;
    for (let b = firstBeat; b <= lastBeat; b++) {
      const t = b * beatInterval;
      const y = this.pianoTop + (t - currentTime) * SCROLL_PX_PER_SEC;
      const isBar = b % this.beatsPerBar === 0;
      if (isBar && this.barsEnabled && barCount < MAX_MARKERS) {
        d.position.set(this.sceneW / 2, y, 0.5);
        d.scale.set(this.sceneW, this.barThickness, 1);
        d.updateMatrix();
        this.barMesh.setMatrixAt(barCount++, d.matrix);
      } else if (!isBar && this.beatsEnabled && beatCount < MAX_MARKERS) {
        d.position.set(this.sceneW / 2, y, 0.5);
        d.scale.set(this.sceneW, 1, 1);
        d.updateMatrix();
        this.beatMesh.setMatrixAt(beatCount++, d.matrix);
      }
    }
    this.beatMesh.count = beatCount;
    this.barMesh.count = barCount;
    if (beatCount > 0) this.beatMesh.instanceMatrix.needsUpdate = true;
    if (barCount > 0) this.barMesh.instanceMatrix.needsUpdate = true;
    this.beatMesh.visible = this.beatsEnabled && beatCount > 0;
    this.barMesh.visible = this.barsEnabled && barCount > 0;
  }

  dispose() {
    this.beatMesh.geometry.dispose();
    this.beatMat.dispose();
    this.scene.remove(this.beatMesh);
    this.barMesh.geometry.dispose();
    this.barMat.dispose();
    this.scene.remove(this.barMesh);
  }
}
