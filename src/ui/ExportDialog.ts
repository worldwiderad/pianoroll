export interface DialogResult {
  width: number;
  height: number;
  fps: number;
}

export type RunExport = (opts: DialogResult, onProgress: (p: number) => void, isCancelled: () => boolean) => Promise<Blob>;

export interface AudioSourceInfo {
  /** Human-readable label shown in the dialog. */
  label: string;
}

/**
 * Modal overlay for picking export resolution / fps and watching progress.
 * Created on demand and removed when closed.
 */
export class ExportDialog {
  private overlay: HTMLDivElement | null = null;
  private cancelled = false;

  open(duration: number, runExport: RunExport, audio?: AudioSourceInfo) {
    if (this.overlay) return;
    this.cancelled = false;

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog" role="dialog" aria-label="Export video">
        <h2>Export video</h2>
        <label class="s-row">
          <span class="s-label">Resolution</span>
          <select id="exp-res" class="s-select">
            <option value="1280x720">720p · 1280 × 720</option>
            <option value="1920x1080" selected>1080p · 1920 × 1080</option>
            <option value="2560x1440">1440p · 2560 × 1440</option>
            <option value="3840x2160">4K · 3840 × 2160</option>
          </select>
        </label>
        <label class="s-row">
          <span class="s-label">Frame rate</span>
          <select id="exp-fps" class="s-select">
            <option value="30">30 fps</option>
            <option value="60" selected>60 fps</option>
          </select>
        </label>
        <div class="s-row"><span class="s-label">Length</span><span class="s-value">${formatTime(duration)}</span></div>
        <div class="s-row"><span class="s-label">Sound</span><span class="s-value">${audio?.label ?? 'None'}</span></div>
        <p class="d-note">An MP4 with H.264 video and AAC audio, rendered frame by frame, so it comes out smooth however fast your computer is. The built-in piano is rendered offline for sample-accurate sound.</p>
        <div id="exp-progress" class="d-progress" style="display:none">
          <div class="d-bar"><div id="exp-bar"></div></div>
          <div id="exp-status" class="d-status"><span id="exp-frames">0 / 0 frames</span><span id="exp-eta"></span></div>
        </div>
        <div class="d-actions">
          <button id="exp-cancel" class="btn btn-ghost" type="button">Cancel</button>
          <button id="exp-start" class="btn btn-primary" type="button">Export</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this.overlay = overlay;

    const startBtn = overlay.querySelector('#exp-start') as HTMLButtonElement;
    const cancelBtn = overlay.querySelector('#exp-cancel') as HTMLButtonElement;
    const resSel = overlay.querySelector('#exp-res') as HTMLSelectElement;
    const fpsSel = overlay.querySelector('#exp-fps') as HTMLSelectElement;
    const progressEl = overlay.querySelector('#exp-progress') as HTMLDivElement;
    const barEl = overlay.querySelector('#exp-bar') as HTMLDivElement;
    const framesEl = overlay.querySelector('#exp-frames') as HTMLSpanElement;
    const etaEl = overlay.querySelector('#exp-eta') as HTMLSpanElement;

    cancelBtn.addEventListener('click', () => {
      this.cancelled = true;
      this.close();
    });

    startBtn.addEventListener('click', async () => {
      const [wStr, hStr] = resSel.value.split('x');
      const width = parseInt(wStr, 10);
      const height = parseInt(hStr, 10);
      const fps = parseInt(fpsSel.value, 10);

      startBtn.disabled = true;
      startBtn.textContent = 'Encoding…';
      progressEl.style.display = 'block';

      const startWall = performance.now();
      let lastFrame = 0;

      try {
        const blob = await runExport(
          { width, height, fps },
          (p) => {
            const total = Math.round(p * 100);
            barEl.style.width = `${(p * 100).toFixed(1)}%`;
            const frames = Math.round(p * fps * (duration));
            framesEl.textContent = `${frames} / ${Math.round(fps * duration)} frames`;
            const elapsed = (performance.now() - startWall) / 1000;
            if (p > 0.02) {
              const remaining = elapsed / p - elapsed;
              etaEl.textContent = `~${formatTime(remaining)} remaining`;
            }
            lastFrame = total;
          },
          () => this.cancelled,
        );
        if (!this.cancelled) {
          this._download(blob, `pianoroll-${width}x${height}-${fps}fps.mp4`);
          this.close();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'cancelled') {
          this.close();
        } else {
          startBtn.textContent = 'Failed';
          framesEl.textContent = msg;
          console.error(err);
        }
      }
      void lastFrame;
    });
  }

  private _download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  close() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}
