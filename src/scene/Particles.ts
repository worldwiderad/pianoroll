import * as THREE from 'three';
import type { Theme } from '../theme/types';
import { ParticleLayer, type SpawnEntry } from './particles/ParticleLayer';
import { ImpactBurst } from './particles/ImpactBurst';

/**
 * Movie-quality particle system: three independently-simulated GPU layers
 * composited over the scene.
 *
 *   - Sparks  — short-lived, hot, velocity-stretched billboards, additive.
 *               Bloom-targeted (HDR ramp >1) so each note hit pops.
 *   - Embers  — medium-life glowing dots that rise on buoyant curl drift.
 *   - Ambient — many-many tiny drifters across the whole scene; the "alive
 *               atmosphere" hum. No explicit emit; continuously respawns.
 *
 * Each layer runs as a self-contained `ParticleLayer` with its own ping-pong
 * MRT, curl-noise sim, and HDR colour ramp. Adding/removing layers is just
 * adding another `ParticleLayer` here.
 */
export class Particles {
  enabled = true;
  private visible = true;
  private scene: THREE.Scene;
  private sparks: ParticleLayer;
  private embers: ParticleLayer;
  private ambient: ParticleLayer;
  private impact: ImpactBurst;
  private ambientRegion = { x: 0, y: 0, w: 1000, h: 1000 };
  private ambientReseedClock = 0;
  /** Configured target — actual rate decays inside _seedAmbient based on density. */
  private ambientTargetPerSecond = 600;
  private globalDensity = 1;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sparks = new ParticleLayer({
      name: 'sparks',
      texSize: 64,           // 4096 slots
      curl: 22,              // less swirl — sparks should fly straight then curve
      curlScale: 0.018,
      gravity: -460,         // heavier — sparks arc and fall
      drag: 2.1,             // fast falloff so streaks shorten as they slow
      size: 5,
      stretch: 3.0,          // long thin streaks — the "fast" tell
      softness: 2.4,
      ramp: [
        new THREE.Color(3.2, 2.8, 2.3),   // blue-white hot core (HDR)
        new THREE.Color(2.2, 1.05, 0.35), // orange flare
        new THREE.Color(0.25, 0.05, 0.02), // deep red coal
      ],
      blending: THREE.AdditiveBlending,
      renderOrder: 110,
    });
    this.embers = new ParticleLayer({
      name: 'embers',
      texSize: 48,           // 2304 slots
      curl: 22,
      curlScale: 0.006,
      gravity: 35,           // positive Y = upward in screen space (ortho cam)
      drag: 0.4,
      size: 5,
      stretch: 0.2,
      softness: 1.4,
      ramp: [
        new THREE.Color(1.6, 1.1, 0.55),
        new THREE.Color(1.1, 0.45, 0.18),
        new THREE.Color(0.08, 0.02, 0.01),
      ],
      blending: THREE.AdditiveBlending,
      renderOrder: 105,
    });
    this.ambient = new ParticleLayer({
      name: 'ambient',
      texSize: 64,           // 4096 slots
      curl: 14,
      curlScale: 0.003,
      gravity: 0,
      drag: 0.05,
      size: 2.8,
      stretch: 0,
      softness: 2.2,
      ramp: [
        new THREE.Color(0.85, 0.95, 1.4),
        new THREE.Color(0.45, 0.6, 1.1),
        new THREE.Color(0.0, 0.0, 0.0),
      ],
      blending: THREE.AdditiveBlending,
      renderOrder: 100,
    });
    this.impact = new ImpactBurst();
    scene.add(this.ambient.mesh, this.embers.mesh, this.sparks.mesh, this.impact.ringMesh, this.impact.flashMesh);
  }

  // ─────────────────────────────────────────────
  //  Emission
  // ─────────────────────────────────────────────

  /**
   * Burst emit on a note hit. `(x, y)` is the hit point in world space; `color`
   * is the note's tint; `velocity` is the MIDI velocity ∈ [0, 1] (0.8 is a
   * sensible default if you don't have it).
   *
   * Anatomy of a single hit:
   *   t=0     — flash sprite pops (peaks at ~25 ms, fades by ~120 ms)
   *   t=0     — ring expands (fades by ~280 ms)
   *   t=0     — N sparks emit upward in a tight 40° cone
   *   t=0     — M embers emit in a wider cone, longer-lived
   *   t≈life  — sparks die, ambient drift / curl carries embers
   */
  emit(x: number, y: number, color: THREE.Color, velocity = 0.8) {
    if (!this.enabled) return;

    const v01 = Math.max(0, Math.min(1, velocity));
    // Velocity → magnitude: power curve. Soft notes still pop a little.
    const vMag = 0.3 + 0.85 * Math.pow(v01, 0.7);
    const density = this.globalDensity * vMag;

    // Flash + ring fire first (instant feedback).
    this.impact.spawn(x, y, color, velocity);

    // Sparks: tight upward cone, lognormal-ish speed distribution → a few
    // fast lead sparks plus a base of slower ones.
    if (this.sparks.enabled) {
      const sparkN = Math.round(28 * density);
      const coneHalfRad = 0.35;   // ±20° around +Y
      for (let i = 0; i < sparkN; i++) {
        // Tighter upward bias by squaring the radial term.
        const phi = (Math.random() * 2 - 1) * coneHalfRad;
        const lateral = Math.sin(phi);
        const upward = Math.cos(phi);
        // Heavy-tail speed: a handful of very fast sparks.
        const r = Math.random();
        const speed = r < 0.15
          ? 380 + Math.random() * 280   // long-tail flyers
          : 160 + Math.random() * 200;  // bulk of the burst
        const jitter = (Math.random() - 0.5) * 10;
        this.sparks.emit({
          pos: [x + jitter, y + Math.random() * 3, 6],
          vel: [lateral * speed + (Math.random() - 0.5) * 25, upward * speed, 0],
          // Faster, brighter notes burn longer.
          lifetime: 0.35 + 0.5 * vMag + Math.random() * 0.25,
          color: [color.r, color.g, color.b],
          seed: Math.random(),
        });
      }
    }

    // Embers: wider cone, slower, longer-lived; drift upward via positive
    // gravity + curl.
    if (this.embers.enabled) {
      const emberN = Math.round(14 * density);
      for (let i = 0; i < emberN; i++) {
        const phi = Math.random() * Math.PI * 2;
        const speed = 40 + Math.random() * 80;
        this.embers.emit({
          pos: [x + (Math.random() - 0.5) * 20, y + 4, 4],
          vel: [Math.cos(phi) * speed * 0.7, Math.abs(Math.sin(phi)) * speed + 50, 0],
          lifetime: 1.8 + Math.random() * 1.6,
          color: [color.r * 0.9 + 0.2, color.g * 0.7 + 0.18, color.b * 0.55 + 0.05],
          seed: Math.random(),
        });
      }
    }
  }

  /** Define the rectangular region (world space) where ambient drifters respawn. */
  setAmbientRegion(x: number, y: number, w: number, h: number) {
    this.ambientRegion = { x, y, w, h };
  }

  /** Toggle the whole system (used by view-mode switches). */
  setVisible(v: boolean) {
    this.visible = v;
    this.sparks.setVisible(v && this.sparks.enabled);
    this.embers.setVisible(v && this.embers.enabled);
    this.ambient.setVisible(v && this.ambient.enabled);
    this.impact.setVisible(v);
  }

  // ─────────────────────────────────────────────
  //  Frame update
  // ─────────────────────────────────────────────

  update(dt: number, renderer: THREE.WebGLRenderer) {
    if (!this.enabled || !this.visible) return;

    // Continuously top up the ambient layer: spawn N this frame so the layer
    // stays full as old slots age out.
    if (this.ambient.enabled) this._seedAmbient(dt);

    this.sparks.update(dt, renderer);
    this.embers.update(dt, renderer);
    this.ambient.update(dt, renderer);
    this.impact.update(dt);
  }

  private _seedAmbient(dt: number) {
    this.ambientReseedClock += dt * this.ambientTargetPerSecond * this.globalDensity;
    const n = Math.floor(this.ambientReseedClock);
    if (n === 0) return;
    this.ambientReseedClock -= n;
    const r = this.ambientRegion;
    for (let i = 0; i < n; i++) {
      const speed = 4 + Math.random() * 18;
      const ang = Math.random() * Math.PI * 2;
      this.ambient.emit({
        pos: [r.x + Math.random() * r.w, r.y + Math.random() * r.h, 1],
        vel: [Math.cos(ang) * speed, Math.sin(ang) * speed, 0],
        lifetime: 4 + Math.random() * 6,
        color: [0.8 + Math.random() * 0.2, 0.85 + Math.random() * 0.1, 1.0],
        seed: Math.random(),
      } satisfies SpawnEntry);
    }
  }

  // ─────────────────────────────────────────────
  //  Theme
  // ─────────────────────────────────────────────

  applyTheme(theme: Theme) {
    const fx = theme.effects;
    this.enabled = fx.particles;
    this.globalDensity = Math.max(0.05, fx.particleDensity);

    const glow = fx.particleGlow;
    this.sparks.setIntensity(glow);
    this.embers.setIntensity(glow * 0.85);
    this.ambient.setIntensity(glow * 0.6);
    this.impact.setIntensityMultiplier(glow);

    // Per-layer enables (use legacy single-toggle when sub-toggles absent).
    const layers = fx.particleLayers;
    this.sparks.setEnabled(this.enabled && layers.sparks);
    this.embers.setEnabled(this.enabled && layers.embers);
    this.ambient.setEnabled(this.enabled && layers.ambient);

    // Curl + gravity globals — tuned per layer relative to the theme value.
    const curl = fx.particleCurl;
    this.sparks.setCurl(38 * curl);
    this.embers.setCurl(22 * curl);
    this.ambient.setCurl(14 * curl);
  }

  // ─────────────────────────────────────────────
  //  Lifecycle
  // ─────────────────────────────────────────────

  dispose() {
    this.sparks.dispose();
    this.embers.dispose();
    this.ambient.dispose();
    this.impact.dispose();
    this.scene.remove(this.sparks.mesh, this.embers.mesh, this.ambient.mesh, this.impact.flashMesh, this.impact.ringMesh);
  }
}
