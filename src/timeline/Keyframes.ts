import type { TrackOpacityKeyframe, CameraKeyframe } from '../theme/types';

/**
 * Compute the active opacity for one track at a given time, given a flat list
 * of keyframes (any track index, any order). Returns 1.0 when no keyframes
 * exist for this track — preserves default "full opacity" behaviour.
 *
 * Interpolation uses smoothstep between consecutive keyframes; clamped at the
 * endpoints (no extrapolation).
 */
export function trackOpacityAt(
  keyframes: TrackOpacityKeyframe[],
  trackIdx: number,
  time: number,
): number {
  // Filter + sort per call. Cheap for the typical N<50 keyframe budget;
  // promote to a cached per-track structure if profile shows otherwise.
  const kfs = keyframes.filter(k => k.trackIdx === trackIdx).sort((a, b) => a.time - b.time);
  if (kfs.length === 0) return 1;
  if (time <= kfs[0].time) return kfs[0].opacity;
  const last = kfs[kfs.length - 1];
  if (time >= last.time) return last.opacity;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (time >= a.time && time <= b.time) {
      const t = (time - a.time) / (b.time - a.time);
      const eased = t * t * (3 - 2 * t); // smoothstep
      return a.opacity + (b.opacity - a.opacity) * eased;
    }
  }
  return 1;
}

/** Returns true if any keyframe exists for the given track. */
export function trackHasKeyframes(keyframes: TrackOpacityKeyframe[], trackIdx: number): boolean {
  for (const k of keyframes) if (k.trackIdx === trackIdx) return true;
  return false;
}

/**
 * Interpolate a camera state from a list of keyframes at the given time.
 * Returns null when the list is empty.
 */
export function cameraStateAt(keyframes: CameraKeyframe[], time: number): CameraKeyframe | null {
  if (keyframes.length === 0) return null;
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (time <= sorted[0].time) return sorted[0];
  const last = sorted[sorted.length - 1];
  if (time >= last.time) return last;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (time >= a.time && time <= b.time) {
      const t = (time - a.time) / (b.time - a.time);
      const eased = t * t * (3 - 2 * t);
      return {
        time,
        theta: lerp(a.theta, b.theta, eased),
        phi: lerp(a.phi, b.phi, eased),
        radius: lerp(a.radius, b.radius, eased),
        lookAt: [
          lerp(a.lookAt[0], b.lookAt[0], eased),
          lerp(a.lookAt[1], b.lookAt[1], eased),
          lerp(a.lookAt[2], b.lookAt[2], eased),
        ],
      };
    }
  }
  return last;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
