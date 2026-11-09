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
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 200;
      background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, system-ui, sans-serif; color: #fff;
    `;
    overlay.innerHTML = `
      <div style="background: #0e0e16; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px;
                  width: 420px; padding: 24px; box-shadow: 0 20px 80px rgba(0,0,0,0.6);">
        <h2 style="font-size: 1.05rem; font-weight: 600; margin-bottom: 18px">Export video</h2>

        <div style="display:flex; flex-direction:column; gap: 12px">
          <label style="display:flex; align-items:center; justify-content:space-between">
            <span style="color: rgba(255,255,255,0.65); font-size: 0.85rem">Resolution</span>
            <select id="exp-res" style="background: rgba(255,255,255,0.06); color: #fff; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 5px 10px; font-size: 0.85rem">
              <option value="1280x720">720p (1280 × 720)</option>
              <option value="1920x1080" selected>1080p (1920 × 1080)</option>
              <option value="2560x1440">1440p (2560 × 1440)</option>
              <option value="3840x2160">4K (3840 × 2160)</option>
            </select>
          </label>
          <label style="display:flex; align-items:center; justify-content:space-between">
            <span style="color: rgba(255,255,255,0.65); font-size: 0.85rem">Frame rate</span>
            <select id="exp-fps" style="background: rgba(255,255,255,0.06); color: #fff; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 5px 10px; font-size: 0.85rem">
              <option value="30">30 fps</option>
              <option value="60" selected>60 fps</option>
            </select>
          </label>
          <div style="display:flex; align-items:center; justify-content:space-between">
            <span style="color: rgba(255,255,255,0.65); font-size: 0.85rem">Duration</span>
            <span style="color: rgba(255,255,255,0.5); font-size: 0.85rem">${formatTime(duration)}</span>
          </div>
          <div style="display:flex; align-items:center; justify-content:space-between">
            <span style="color: rgba(255,255,255,0.65); font-size: 0.85rem">Audio</span>
            <span style="color: rgba(255,255,255,0.5); font-size: 0.85rem">${audio?.label ?? 'None'}</span>
          </div>
        </div>

        <div style="color: rgba(255,255,255,0.4); font-size: 0.72rem; margin-top: 14px; line-height: 1.55">
          Frame-by-frame H.264 video + AAC 320 kbps audio in MP4.<br/>
          Synth audio is rendered offline through Web Audio for sample-accurate output.
        </div>

        <div id="exp-progress" style="display:none; margin-top: 18px">
          <div style="height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden">
            <div id="exp-bar" style="height: 100%; background: var(--accent, #7c6dfa); width: 0%; transition: width 0.1s linear"></div>
          </div>
          <div id="exp-status" style="color: rgba(255,255,255,0.55); font-size: 0.78rem; margin-top: 6px; display: flex; justify-content: space-between">
            <span id="exp-frames">0 / 0 frames</span>
            <span id="exp-eta"></span>
          </div>
        </div>

        <div style="display:flex; gap: 8px; margin-top: 18px; justify-content: flex-end">
          <button id="exp-cancel" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #fff; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 0.85rem">Cancel</button>
          <button id="exp-start" style="background: var(--accent, #7c6dfa); border: none; color: #fff; padding: 8px 20px; border-radius: 8px; cursor: pointer; font-size: 0.88rem; font-weight: 600">Export</button>
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
