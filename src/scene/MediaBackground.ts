import * as THREE from 'three';

export interface MediaConfig {
  enabled: boolean;
  type: 'image' | 'video';
  src: string;
  fit: 'cover' | 'contain' | 'stretch';
  opacity: number;
  blur: number;
}

/**
 * Optional image/video plane rendered just in front of the gradient background.
 * Aspect-aware fit modes are computed once when the media or canvas resizes
 * and pushed as a UV transform uniform — the shader stays simple.
 *
 * Video plays back via `HTMLVideoElement`; sync to the clock is approximate
 * (within ±0.5 s) — exact frame-accurate sync would require a `VideoDecoder`.
 */
export class MediaBackground {
  private scene: THREE.Scene;
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private currentSrc: string | null = null;
  private currentType: 'image' | 'video' | null = null;
  private texture: THREE.Texture | null = null;
  private video: HTMLVideoElement | null = null;
  private mediaAspect = 1;
  private fit: 'cover' | 'contain' | 'stretch' = 'cover';
  private sceneW = 1;
  private sceneH = 1;

  constructor(scene: THREE.Scene, sceneW: number, sceneH: number) {
    this.scene = scene;
    this.sceneW = sceneW;
    this.sceneH = sceneH;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tex: { value: null },
        hasTex: { value: 0 },
        uvScale: { value: new THREE.Vector2(1, 1) },
        uvOffset: { value: new THREE.Vector2(0, 0) },
        opacity: { value: 1 },
        blurRadius: { value: 0 },
        texSize: { value: new THREE.Vector2(1920, 1080) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: `
        uniform sampler2D tex;
        uniform float hasTex;
        uniform vec2 uvScale;
        uniform vec2 uvOffset;
        uniform float opacity;
        uniform float blurRadius;
        uniform vec2 texSize;
        varying vec2 vUv;

        vec4 sampleClamped(vec2 uv) {
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
          return texture2D(tex, uv);
        }

        void main() {
          if (hasTex < 0.5) discard;
          vec2 uv = vUv * uvScale + uvOffset;
          vec4 c;
          if (blurRadius < 0.5) {
            c = sampleClamped(uv);
          } else {
            // 5x5 weighted box blur (cheap, plenty for a background plane).
            vec4 sum = vec4(0.0);
            float wsum = 0.0;
            for (int dx = -2; dx <= 2; dx++) {
              for (int dy = -2; dy <= 2; dy++) {
                vec2 off = vec2(float(dx), float(dy)) * blurRadius / texSize;
                float w = 1.0 / (1.0 + float(dx*dx + dy*dy));
                sum += sampleClamped(uv + off) * w;
                wsum += w;
              }
            }
            c = sum / wsum;
          }
          if (c.a < 0.01) discard;
          gl_FragColor = vec4(c.rgb, c.a * opacity);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    const geo = new THREE.PlaneGeometry(sceneW * 2.5, sceneH * 2.5);
    this.mesh = new THREE.Mesh(geo, this.material);
    // Just in front of the gradient bg plane (z=-50), behind everything else.
    this.mesh.position.set(sceneW / 2, sceneH / 2, -49);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setSize(w: number, h: number) {
    this.sceneW = w; this.sceneH = h;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(w * 2.5, h * 2.5);
    this.mesh.position.set(w / 2, h / 2, -49);
    this._recomputeUV();
  }

  apply(cfg: MediaConfig | null | undefined) {
    if (!cfg || !cfg.enabled || !cfg.src) {
      this.mesh.visible = false;
      return;
    }
    if (cfg.src !== this.currentSrc || cfg.type !== this.currentType) {
      this._loadMedia(cfg.type, cfg.src);
      this.currentSrc = cfg.src;
      this.currentType = cfg.type;
    }
    this.fit = cfg.fit;
    this.mesh.visible = true;
    this.material.uniforms.opacity.value = cfg.opacity;
    this.material.uniforms.blurRadius.value = cfg.blur;
    this._recomputeUV();
  }

  /** Also draw on `layer`, so glass can see the media behind it. */
  enableLayer(layer: number) { this.mesh.layers.enable(layer); }

  setVisible(visible: boolean) { this.mesh.visible = visible && this.material.uniforms.hasTex.value > 0; }

  /** Keep the video element roughly in sync with the playback clock. */
  syncToTime(currentTime: number, playing: boolean) {
    if (!this.video) return;
    if (playing && this.video.paused) {
      this.video.play().catch(() => { /* user-gesture rejection — ignore */ });
    } else if (!playing && !this.video.paused) {
      this.video.pause();
    }
    if (Math.abs(this.video.currentTime - currentTime) > 0.5) {
      try { this.video.currentTime = currentTime; } catch { /* ignore seek errors */ }
    }
  }

  private _loadMedia(type: 'image' | 'video', src: string) {
    this._disposeTexture();
    if (type === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.mediaAspect = img.naturalWidth / img.naturalHeight;
        this.material.uniforms.texSize.value.set(img.naturalWidth, img.naturalHeight);
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        this.material.uniforms.tex.value = tex;
        this.material.uniforms.hasTex.value = 1;
        this.texture = tex;
        this._recomputeUV();
      };
      img.onerror = () => console.warn('[MediaBackground] image failed to load');
      img.src = src;
    } else {
      const video = document.createElement('video');
      video.src = src;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.onloadedmetadata = () => {
        this.mediaAspect = video.videoWidth / video.videoHeight;
        this.material.uniforms.texSize.value.set(video.videoWidth, video.videoHeight);
        const tex = new THREE.VideoTexture(video);
        tex.colorSpace = THREE.SRGBColorSpace;
        this.material.uniforms.tex.value = tex;
        this.material.uniforms.hasTex.value = 1;
        this.texture = tex;
        this.video = video;
        this._recomputeUV();
        video.play().catch(() => { /* awaits user gesture */ });
      };
      video.onerror = () => console.warn('[MediaBackground] video failed to load');
      video.load();
    }
  }

  /**
   * Compute the UV scale + offset for the current fit mode, given that the
   * plane shares its aspect with the screen. Result lets the shader sample
   * the texture so it covers / contains / stretches the visible area.
   */
  private _recomputeUV() {
    if (this.mediaAspect <= 0) return;
    const canvasAspect = this.sceneW / this.sceneH;
    let su = 1, sv = 1, ou = 0, ov = 0;
    if (this.fit === 'cover') {
      if (this.mediaAspect > canvasAspect) {
        su = canvasAspect / this.mediaAspect;
        ou = (1 - su) / 2;
      } else {
        sv = this.mediaAspect / canvasAspect;
        ov = (1 - sv) / 2;
      }
    } else if (this.fit === 'contain') {
      if (this.mediaAspect > canvasAspect) {
        sv = canvasAspect / this.mediaAspect;
        ov = (1 - sv) / 2;
      } else {
        su = this.mediaAspect / canvasAspect;
        ou = (1 - su) / 2;
      }
    }
    // 'stretch' leaves su=sv=1, no offsets
    this.material.uniforms.uvScale.value.set(su, sv);
    this.material.uniforms.uvOffset.value.set(ou, ov);
  }

  private _disposeTexture() {
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
    if (this.video) {
      try { this.video.pause(); } catch { /* */ }
      this.video.src = '';
      this.video = null;
    }
    this.material.uniforms.tex.value = null;
    this.material.uniforms.hasTex.value = 0;
    this.currentSrc = null;
    this.currentType = null;
  }

  dispose() {
    this._disposeTexture();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.mesh);
  }
}
