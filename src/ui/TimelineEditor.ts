import type { ThemeManager } from '../theme/ThemeManager';
import type { MidiTrack } from '../midi/MidiLoader';
import type { TrackOpacityKeyframe, CameraKeyframe } from '../theme/types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ROW_HEIGHT = 56;
const CAM_ROW_HEIGHT = 36;
const KEY_RADIUS = 7;

/**
 * Timeline editor with two stacked sections:
 *   - Opacity: one row per track (Y = opacity, X = time)
 *   - Camera: single row, dots = camera keyframes along time
 *
 * Both write back to `theme.timeline.*` via the ThemeManager; the App's
 * per-frame interpolation picks the new state up immediately.
 */
export class TimelineEditor {
  private opacityContainer: HTMLElement;
  private cameraContainer: HTMLElement;
  private tm: ThemeManager;
  private tracks: MidiTrack[] = [];
  private duration = 0;
  private playheads: SVGLineElement[] = [];

  constructor(opacityContainer: HTMLElement, cameraContainer: HTMLElement, tm: ThemeManager) {
    this.opacityContainer = opacityContainer;
    this.cameraContainer = cameraContainer;
    this.tm = tm;
  }

  setTracks(tracks: MidiTrack[], duration: number) {
    this.tracks = tracks;
    this.duration = Math.max(duration, 1);
    this.render();
  }

  updatePlayhead(time: number) {
    if (this.duration <= 0) return;
    const x = (time / this.duration) * 100;
    for (const p of this.playheads) {
      p.setAttribute('x1', `${x}%`);
      p.setAttribute('x2', `${x}%`);
    }
  }

  clearOpacity() {
    this.tm.apply({ timeline: { ...this.tm.current.timeline, trackOpacityKeyframes: [] } });
    this.render();
  }

  clearCamera() {
    this.tm.apply({ timeline: { ...this.tm.current.timeline, cameraKeyframes: [] } });
    this.render();
  }

  /** Add a camera keyframe at the given time, replacing any keyframe at the same time. */
  saveCameraKeyframe(time: number, snapshot: { theta: number; phi: number; radius: number; lookAt: [number, number, number] }) {
    const tol = 0.05;
    const filtered = this.tm.current.timeline.cameraKeyframes.filter(k => Math.abs(k.time - time) > tol);
    const kf: CameraKeyframe = { time, ...snapshot };
    this.tm.apply({ timeline: { ...this.tm.current.timeline, cameraKeyframes: [...filtered, kf] } });
    this.render();
  }

  render() {
    this.opacityContainer.innerHTML = '';
    this.cameraContainer.innerHTML = '';
    this.playheads = [];

    if (this.tracks.length === 0) {
      const msg = document.createElement('div');
      msg.style.color = 'rgba(255,255,255,0.4)';
      msg.style.fontSize = '0.78rem';
      msg.style.padding = '12px 0';
      msg.textContent = 'Load a MIDI file to edit the timeline.';
      this.opacityContainer.appendChild(msg);
      return;
    }

    this.tracks.forEach((track, idx) => this.opacityContainer.appendChild(this._buildOpacityRow(track, idx)));
    this.cameraContainer.appendChild(this._buildCameraLane());
  }

  // ── Opacity rows ──

  private _buildOpacityRow(track: MidiTrack, idx: number): HTMLElement {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.marginBottom = '6px';

    const label = document.createElement('span');
    label.style.width = '64px';
    label.style.fontSize = '0.72rem';
    label.style.color = 'rgba(255,255,255,0.55)';
    label.style.flexShrink = '0';
    label.style.overflow = 'hidden';
    label.style.whiteSpace = 'nowrap';
    label.style.textOverflow = 'ellipsis';
    label.textContent = track.name || `Track ${idx + 1}`;

    const svg = this._makeLaneSvg(ROW_HEIGHT);

    // 0.5-opacity reference line
    const mid = document.createElementNS(SVG_NS, 'line');
    mid.setAttribute('x1', '0'); mid.setAttribute('x2', '100%');
    mid.setAttribute('y1', String(ROW_HEIGHT / 2)); mid.setAttribute('y2', String(ROW_HEIGHT / 2));
    mid.setAttribute('stroke', 'rgba(255,255,255,0.06)');
    mid.setAttribute('stroke-dasharray', '2 4');
    svg.appendChild(mid);

    const polyline = document.createElementNS(SVG_NS, 'polyline');
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', 'var(--accent, #7c6dfa)');
    polyline.setAttribute('stroke-width', '1.4');
    polyline.setAttribute('opacity', '0.7');
    svg.appendChild(polyline);

    const playhead = this._appendPlayhead(svg, ROW_HEIGHT);
    this.playheads.push(playhead);

    this._drawOpacityKeyframes(svg, polyline, idx);
    this._wireOpacityRow(svg, idx);

    row.append(label, svg);
    return row;
  }

  private _drawOpacityKeyframes(svg: SVGSVGElement, polyline: SVGPolylineElement, idx: number) {
    svg.querySelectorAll('circle').forEach(c => c.remove());
    const kfs = this.tm.current.timeline.trackOpacityKeyframes
      .filter(k => k.trackIdx === idx)
      .sort((a, b) => a.time - b.time);
    const rect = svg.getBoundingClientRect();
    const width = rect.width || 200;
    const points: string[] = [];
    if (kfs.length > 0) {
      points.push(`0,${(1 - kfs[0].opacity) * ROW_HEIGHT}`);
      for (const k of kfs) {
        const x = (k.time / this.duration) * width;
        const y = (1 - k.opacity) * ROW_HEIGHT;
        points.push(`${x},${y}`);
      }
      points.push(`${width},${(1 - kfs[kfs.length - 1].opacity) * ROW_HEIGHT}`);
    }
    polyline.setAttribute('points', points.join(' '));

    for (const k of kfs) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', `${(k.time / this.duration) * 100}%`);
      c.setAttribute('cy', String((1 - k.opacity) * ROW_HEIGHT));
      c.setAttribute('r', String(KEY_RADIUS));
      c.setAttribute('fill', 'var(--accent, #7c6dfa)');
      c.setAttribute('stroke', '#fff');
      c.setAttribute('stroke-width', '1.5');
      c.style.cursor = 'grab';
      svg.appendChild(c);
    }
  }

  private _wireOpacityRow(svg: SVGSVGElement, idx: number) {
    let dragging: { kf: TrackOpacityKeyframe; circle: SVGCircleElement } | null = null;
    let moveHandler: ((e: MouseEvent) => void) | null = null;
    let upHandler: (() => void) | null = null;

    const xyToTimeOpacity = (e: MouseEvent) => {
      const rect = svg.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      return { time: (x / rect.width) * this.duration, opacity: 1 - y / rect.height };
    };

    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    svg.addEventListener('mousedown', (e) => {
      const { time, opacity } = xyToTimeOpacity(e);
      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const kfs = this.tm.current.timeline.trackOpacityKeyframes;
      let hitIdx = -1;
      for (let i = 0; i < kfs.length; i++) {
        const k = kfs[i];
        if (k.trackIdx !== idx) continue;
        const kx = (k.time / this.duration) * rect.width;
        const ky = (1 - k.opacity) * rect.height;
        if (Math.hypot(x - kx, y - ky) <= KEY_RADIUS * 1.6) { hitIdx = i; break; }
      }
      if (hitIdx >= 0 && e.button === 2) {
        this._removeOpacityAt(hitIdx);
        return;
      }
      if (hitIdx >= 0 && e.button === 0) {
        const kf = kfs[hitIdx];
        const sorted = this.tm.current.timeline.trackOpacityKeyframes
          .filter(k => k.trackIdx === idx)
          .sort((a, b) => a.time - b.time);
        const circle = svg.querySelectorAll('circle')[sorted.indexOf(kf)] as SVGCircleElement | undefined;
        if (!circle) return;
        dragging = { kf, circle };
        moveHandler = (mv) => {
          if (!dragging) return;
          const { time: t2, opacity: o2 } = xyToTimeOpacity(mv);
          dragging.kf.time = Math.max(0, Math.min(this.duration, t2));
          dragging.kf.opacity = Math.max(0, Math.min(1, o2));
          dragging.circle.setAttribute('cx', `${(dragging.kf.time / this.duration) * 100}%`);
          dragging.circle.setAttribute('cy', String((1 - dragging.kf.opacity) * ROW_HEIGHT));
        };
        upHandler = () => {
          dragging = null;
          if (moveHandler) document.removeEventListener('mousemove', moveHandler);
          if (upHandler) document.removeEventListener('mouseup', upHandler);
          this.tm.apply({ timeline: { ...this.tm.current.timeline, trackOpacityKeyframes: [...this.tm.current.timeline.trackOpacityKeyframes] } });
          this.render();
        };
        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('mouseup', upHandler);
        return;
      }
      if (e.button === 0) {
        const kf: TrackOpacityKeyframe = {
          trackIdx: idx,
          time: Math.max(0, Math.min(this.duration, time)),
          opacity: Math.max(0, Math.min(1, opacity)),
        };
        const next = [...this.tm.current.timeline.trackOpacityKeyframes, kf];
        this.tm.apply({ timeline: { ...this.tm.current.timeline, trackOpacityKeyframes: next } });
        this.render();
      }
    });
  }

  private _removeOpacityAt(flatIdx: number) {
    const next = this.tm.current.timeline.trackOpacityKeyframes.filter((_, i) => i !== flatIdx);
    this.tm.apply({ timeline: { ...this.tm.current.timeline, trackOpacityKeyframes: next } });
    this.render();
  }

  // ── Camera lane ──

  private _buildCameraLane(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '8px';
    wrap.style.marginTop = '4px';

    const label = document.createElement('span');
    label.style.width = '64px';
    label.style.fontSize = '0.72rem';
    label.style.color = 'rgba(255,255,255,0.55)';
    label.style.flexShrink = '0';
    label.textContent = 'Camera';

    const svg = this._makeLaneSvg(CAM_ROW_HEIGHT);

    const baseLine = document.createElementNS(SVG_NS, 'line');
    baseLine.setAttribute('x1', '0'); baseLine.setAttribute('x2', '100%');
    baseLine.setAttribute('y1', String(CAM_ROW_HEIGHT / 2)); baseLine.setAttribute('y2', String(CAM_ROW_HEIGHT / 2));
    baseLine.setAttribute('stroke', 'rgba(255,255,255,0.1)');
    svg.appendChild(baseLine);

    const playhead = this._appendPlayhead(svg, CAM_ROW_HEIGHT);
    this.playheads.push(playhead);

    this._drawCameraKeyframes(svg);
    this._wireCameraLane(svg);

    wrap.append(label, svg);
    return wrap;
  }

  private _drawCameraKeyframes(svg: SVGSVGElement) {
    svg.querySelectorAll('circle').forEach(c => c.remove());
    const kfs = [...this.tm.current.timeline.cameraKeyframes].sort((a, b) => a.time - b.time);
    for (const k of kfs) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', `${(k.time / this.duration) * 100}%`);
      c.setAttribute('cy', String(CAM_ROW_HEIGHT / 2));
      c.setAttribute('r', String(KEY_RADIUS));
      c.setAttribute('fill', '#f9a8d4');
      c.setAttribute('stroke', '#fff');
      c.setAttribute('stroke-width', '1.5');
      c.style.cursor = 'grab';
      svg.appendChild(c);
    }
  }

  private _wireCameraLane(svg: SVGSVGElement) {
    let dragging: { kf: CameraKeyframe; circle: SVGCircleElement } | null = null;
    let moveHandler: ((e: MouseEvent) => void) | null = null;
    let upHandler: (() => void) | null = null;

    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    svg.addEventListener('mousedown', (e) => {
      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const kfs = this.tm.current.timeline.cameraKeyframes;
      let hitIdx = -1;
      for (let i = 0; i < kfs.length; i++) {
        const k = kfs[i];
        const kx = (k.time / this.duration) * rect.width;
        const ky = CAM_ROW_HEIGHT / 2;
        if (Math.hypot(x - kx, y - ky) <= KEY_RADIUS * 1.8) { hitIdx = i; break; }
      }
      if (hitIdx >= 0 && e.button === 2) {
        const next = this.tm.current.timeline.cameraKeyframes.filter((_, i) => i !== hitIdx);
        this.tm.apply({ timeline: { ...this.tm.current.timeline, cameraKeyframes: next } });
        this.render();
        return;
      }
      if (hitIdx >= 0 && e.button === 0) {
        const kf = kfs[hitIdx];
        const sorted = [...this.tm.current.timeline.cameraKeyframes].sort((a, b) => a.time - b.time);
        const circle = svg.querySelectorAll('circle')[sorted.indexOf(kf)] as SVGCircleElement | undefined;
        if (!circle) return;
        dragging = { kf, circle };
        moveHandler = (mv) => {
          if (!dragging) return;
          const rect2 = svg.getBoundingClientRect();
          const x2 = Math.max(0, Math.min(rect2.width, mv.clientX - rect2.left));
          dragging.kf.time = Math.max(0, Math.min(this.duration, (x2 / rect2.width) * this.duration));
          dragging.circle.setAttribute('cx', `${(dragging.kf.time / this.duration) * 100}%`);
        };
        upHandler = () => {
          dragging = null;
          if (moveHandler) document.removeEventListener('mousemove', moveHandler);
          if (upHandler) document.removeEventListener('mouseup', upHandler);
          this.tm.apply({ timeline: { ...this.tm.current.timeline, cameraKeyframes: [...this.tm.current.timeline.cameraKeyframes] } });
          this.render();
        };
        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('mouseup', upHandler);
      }
    });
  }

  // ── helpers ──

  private _makeLaneSvg(height: number): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', String(height));
    svg.style.background = 'rgba(255,255,255,0.04)';
    svg.style.borderRadius = '6px';
    svg.style.flex = '1';
    svg.style.cursor = 'crosshair';
    svg.style.overflow = 'visible';
    return svg;
  }

  private _appendPlayhead(svg: SVGSVGElement, height: number): SVGLineElement {
    const playhead = document.createElementNS(SVG_NS, 'line');
    playhead.setAttribute('x1', '0%'); playhead.setAttribute('x2', '0%');
    playhead.setAttribute('y1', '0'); playhead.setAttribute('y2', String(height));
    playhead.setAttribute('stroke', 'rgba(255,255,255,0.35)');
    playhead.setAttribute('stroke-width', '1');
    svg.appendChild(playhead);
    return playhead;
  }
}
