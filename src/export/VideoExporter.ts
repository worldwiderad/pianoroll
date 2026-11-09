import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  duration: number;     // seconds
  startTime?: number;   // seconds offset (default 0)
  bitrate?: number;     // video bits/sec, default = width*height*0.1
  audio?: AudioBuffer;  // optional audio track
  audioBitrate?: number; // default 320 kbps (transparent for AAC LC)
  onProgress?: (frameIdx: number, totalFrames: number) => void;
  onCancel?: () => boolean;
}

/**
 * Drives frame-by-frame offline rendering and encodes to MP4 via WebCodecs.
 *
 * The caller (App) provides a `renderFrameAt(time)` callback that:
 *   - sets the clock to `time` and updates every scene object
 *   - calls `composer.render()` with the export-sized framebuffer
 * The renderer is expected to be in "export mode" (resized + paused rAF)
 * during the call to `export()`.
 */
export class VideoExporter {
  private canvas: HTMLCanvasElement;
  private renderFrameAt: (time: number) => void;

  constructor(canvas: HTMLCanvasElement, renderFrameAt: (time: number) => void) {
    this.canvas = canvas;
    this.renderFrameAt = renderFrameAt;
  }

  static isSupported(): boolean {
    return typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder === 'function';
  }

  async export(opts: ExportOptions): Promise<Blob> {
    if (!VideoExporter.isSupported()) {
      throw new Error('VideoEncoder (WebCodecs) is not available in this browser.');
    }

    const { width, height, fps, duration, startTime = 0 } = opts;
    const bitrate = opts.bitrate ?? Math.round(width * height * 0.1);
    const totalFrames = Math.max(1, Math.round(duration * fps));
    const frameDurationUs = 1_000_000 / fps;
    const hasAudio = !!opts.audio && opts.audio.length > 0;

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width,
        height,
        frameRate: fps,
      },
      audio: hasAudio ? {
        codec: 'aac',
        sampleRate: opts.audio!.sampleRate,
        numberOfChannels: opts.audio!.numberOfChannels,
      } : undefined,
      fastStart: 'in-memory',
    });

    let encoderError: Error | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { encoderError = e instanceof Error ? e : new Error(String(e)); },
    });

    encoder.configure({
      codec: VideoExporter._pickH264Profile(width, height),
      width,
      height,
      framerate: fps,
      bitrate,
      // Reasonable real-time-friendly defaults
      bitrateMode: 'variable',
      latencyMode: 'quality',
    });

    // GOP ≈ 2 seconds — balances seekability vs file size.
    const gop = Math.max(fps * 2, 30);

    for (let i = 0; i < totalFrames; i++) {
      if (opts.onCancel?.()) {
        encoder.close();
        throw new Error('cancelled');
      }
      const t = startTime + i / fps;
      this.renderFrameAt(t);

      const frame = new VideoFrame(this.canvas, {
        timestamp: Math.round(i * frameDurationUs),
        duration: Math.round(frameDurationUs),
      });
      encoder.encode(frame, { keyFrame: i % gop === 0 });
      frame.close();

      // Yield to the UI thread every few frames so progress UI can repaint.
      if (i % 4 === 0) await new Promise(r => setTimeout(r, 0));
      opts.onProgress?.(i + 1, totalFrames);

      if (encoderError) throw encoderError;
    }

    await encoder.flush();
    encoder.close();
    if (encoderError) throw encoderError;

    if (hasAudio) {
      await this._encodeAudio(muxer, opts.audio!, opts.audioBitrate ?? 320_000, duration, startTime);
    }

    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  }

  /**
   * Encode an `AudioBuffer` as AAC and add each chunk to the muxer.
   * `f32-planar` is the native AudioBuffer layout — zero-copy per channel.
   */
  private async _encodeAudio(
    muxer: Muxer<ArrayBufferTarget>,
    buffer: AudioBuffer,
    bitrate: number,
    duration: number,
    startTime: number,
  ) {
    const sampleRate = buffer.sampleRate;
    const channels = buffer.numberOfChannels;
    const startSample = Math.max(0, Math.floor(startTime * sampleRate));
    const endSample = Math.min(buffer.length, Math.ceil((startTime + duration) * sampleRate));
    const totalFrames = Math.max(0, endSample - startSample);
    if (totalFrames === 0) return;

    let encErr: Error | null = null;
    const enc = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => { encErr = e instanceof Error ? e : new Error(String(e)); },
    });
    enc.configure({
      codec: 'mp4a.40.2', // AAC LC
      sampleRate,
      numberOfChannels: channels,
      bitrate,
    });

    const CHUNK = 1024;
    // Pre-allocate the planar buffer; reused per chunk.
    const planar = new Float32Array(CHUNK * channels);

    let off = startSample;
    let emittedFrames = 0;
    while (off < endSample) {
      const frames = Math.min(CHUNK, endSample - off);
      // Planar layout: [ch0 samples..., ch1 samples...]
      for (let c = 0; c < channels; c++) {
        const src = buffer.getChannelData(c).subarray(off, off + frames);
        planar.set(src, c * frames);
      }
      // Slice if last partial chunk
      const data = frames === CHUNK ? planar : planar.subarray(0, frames * channels);

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: frames,
        numberOfChannels: channels,
        timestamp: Math.round((emittedFrames / sampleRate) * 1_000_000),
        data,
      });
      enc.encode(audioData);
      audioData.close();
      emittedFrames += frames;
      off += frames;
      if (encErr) throw encErr;
    }

    await enc.flush();
    enc.close();
    if (encErr) throw encErr;
  }

  /** Pick an H.264 profile-level codec string that matches the resolution. */
  private static _pickH264Profile(w: number, h: number): string {
    // Profile constants: 42 = Baseline, 4D = Main, 64 = High. We use High.
    const pixels = w * h;
    let level = '1F'; // 3.1 (up to 1280×720 @ 30)
    if (pixels > 1280 * 720) level = '28';  // 4.0 (up to 1920×1080 @ 30)
    if (pixels > 1920 * 1080) level = '32'; // 5.0 (up to 2560×1920)
    if (pixels > 2560 * 1920) level = '33'; // 5.1 (up to 4096×2304)
    return `avc1.6400${level}`;
  }
}
