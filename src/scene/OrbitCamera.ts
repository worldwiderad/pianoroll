import * as THREE from 'three';

/**
 * Spherical-coords orbit camera. Drag to orbit, shift-drag to pan look-at,
 * scroll to zoom radius. Current values lerp toward targets each frame so the
 * camera glides instead of snapping.
 */
export class OrbitCamera {
  camera: THREE.PerspectiveCamera;
  target = { theta: 0.3, phi: 1.35, radius: 800 };
  current = { theta: 0.3, phi: 1.35, radius: 800 };
  lookAtTarget = new THREE.Vector3(0, 0, 0);
  lookAt = new THREE.Vector3(0, 0, 0);
  /** Set to true while the user is dragging — automation should defer to manual input. */
  userInteracting = false;
  /** Timestamp (performance.now ms) when the last drag/scroll ended. */
  lastInteractionEnd = 0;
  /** Automation grace period after manual interaction (ms). */
  interactionCooldown = 2000;
  private lerp = 0.06;
  private domEl: HTMLElement | null = null;
  private cleanups: Array<() => void> = [];

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 50000);
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setTarget(theta: number, phi: number, radius: number) {
    this.target.theta = theta;
    this.target.phi = phi;
    this.target.radius = radius;
  }

  setLookAtTarget(x: number, y: number, z: number) {
    this.lookAtTarget.set(x, y, z);
  }

  /** True while the user is dragging OR within the interaction cooldown window. */
  get inCooldown(): boolean {
    return this.userInteracting || (performance.now() - this.lastInteractionEnd) < this.interactionCooldown;
  }

  /** Snapshot the current camera state for keyframe save. */
  snapshot() {
    return {
      theta: this.target.theta,
      phi: this.target.phi,
      radius: this.target.radius,
      lookAt: [this.lookAtTarget.x, this.lookAtTarget.y, this.lookAtTarget.z] as [number, number, number],
    };
  }

  /** Snap current state to target (no animation). */
  snap() {
    this.current.theta = this.target.theta;
    this.current.phi = this.target.phi;
    this.current.radius = this.target.radius;
    this.lookAt.copy(this.lookAtTarget);
    this._updateCamera();
  }

  update() {
    this.current.theta += (this.target.theta - this.current.theta) * this.lerp;
    this.current.phi += (this.target.phi - this.current.phi) * this.lerp;
    this.current.radius += (this.target.radius - this.current.radius) * this.lerp;
    this.lookAt.lerp(this.lookAtTarget, this.lerp);
    this._updateCamera();
  }

  private _updateCamera() {
    const r = this.current.radius;
    const sinPhi = Math.sin(this.current.phi);
    const camX = this.lookAt.x + r * sinPhi * Math.sin(this.current.theta);
    const camY = this.lookAt.y + r * Math.cos(this.current.phi);
    const camZ = this.lookAt.z + r * sinPhi * Math.cos(this.current.theta);
    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.lookAt);
  }

  attachControls(domEl: HTMLElement) {
    if (this.domEl) this.detachControls();
    this.domEl = domEl;

    let dragging = false;
    let lastX = 0, lastY = 0;
    let shiftHeld = false;

    const onMouseDown = (e: MouseEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      shiftHeld = e.shiftKey;
      this.userInteracting = true;
      domEl.style.cursor = 'grabbing';
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (shiftHeld || e.shiftKey) {
        const scale = this.current.radius * 0.0015;
        this.lookAtTarget.x -= dx * scale;
        this.lookAtTarget.y += dy * scale;
      } else {
        this.target.theta -= dx * 0.005;
        this.target.phi -= dy * 0.005;
        this.target.phi = Math.max(0.2, Math.min(Math.PI - 0.2, this.target.phi));
      }
    };
    const onMouseUp = () => {
      dragging = false;
      this.userInteracting = false;
      this.lastInteractionEnd = performance.now();
      if (domEl) domEl.style.cursor = 'grab';
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.target.radius *= e.deltaY > 0 ? 1.08 : 0.92;
      this.target.radius = Math.max(60, Math.min(8000, this.target.radius));
      this.lastInteractionEnd = performance.now();
    };
    domEl.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    domEl.addEventListener('wheel', onWheel, { passive: false });

    this.cleanups.push(
      () => domEl.removeEventListener('mousedown', onMouseDown),
      () => document.removeEventListener('mousemove', onMouseMove),
      () => document.removeEventListener('mouseup', onMouseUp),
      () => domEl.removeEventListener('wheel', onWheel),
    );
  }

  detachControls() {
    this.cleanups.forEach(fn => fn());
    this.cleanups = [];
    this.domEl = null;
  }
}
