/**
 * @file SoundEngine.ts
 * @description Hybrid Web Audio API sound engine for VoxelCraft.
 * Supports optional decoded Minecraft 1.21 Resource Pack .ogg audio buffers with
 * automatic zero-asset procedural Web Audio synthesis fallback and per-category volume buses.
 */

export type SoundGroup =
  | 'grass'
  | 'dirt'
  | 'stone'
  | 'wood'
  | 'sand'
  | 'glass'
  | 'snow'
  | 'leaves'
  | 'metal'
  | 'wool'
  | 'water'
  | string;

export type AudioCategory = 'blocks' | 'mobs' | 'ambient' | 'ui';

export interface AudioCategoryVolumes {
  master: number;
  blocks: number;
  mobs: number;
  ambient: number;
  ui: number;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private masterGain: GainNode | null = null;
  private categoryGains: Record<AudioCategory, GainNode | null> = {
    blocks: null,
    mobs: null,
    ambient: null,
    ui: null,
  };
  private volumes: AudioCategoryVolumes = {
    master: 0.6,
    blocks: 0.9,
    mobs: 0.9,
    ambient: 0.75,
    ui: 0.85,
  };

  private packBlobs: Record<string, Blob> = {};
  private decodedPackBuffers = new Map<string, AudioBuffer>();
  private decodingInFlight = new Set<string>();

  private lastStepAt = 0;
  private lastTickAt = 0;
  private unlocked = false;
  private disposed = false;
  private readonly pendingTimers = new Set<number>();

  private scheduleTimer(fn: () => void, ms: number): void {
    if (this.disposed || typeof window === 'undefined') return;
    const id = window.setTimeout(() => {
      this.pendingTimers.delete(id);
      if (!this.disposed) fn();
    }, ms);
    this.pendingTimers.add(id);
  }

  private ensureContext(allowCreate = false): AudioContext | null {
    if (this.disposed || typeof window === 'undefined') return null;
    if (!this.unlocked && !allowCreate) return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volumes.master;
      this.masterGain.connect(this.ctx.destination);

      (['blocks', 'mobs', 'ambient', 'ui'] as AudioCategory[]).forEach((cat) => {
        const g = this.ctx!.createGain();
        g.gain.value = this.volumes[cat];
        g.connect(this.masterGain!);
        this.categoryGains[cat] = g;
      });

      this.noiseBuffer = this.createWhiteNoiseBuffer(this.ctx, 1.5);
    }
    if (this.ctx.state === 'suspended') {
      if (allowCreate) {
        this.ctx.resume().catch(() => {});
      } else {
        return null;
      }
    }
    return this.ctx;
  }

  private getCategoryNode(category: AudioCategory): GainNode | null {
    const ctx = this.ensureContext();
    if (!ctx) return null;
    return this.categoryGains[category] || this.masterGain;
  }

  private createWhiteNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  public unlock(): void {
    if (this.disposed) return;
    this.unlocked = true;
    this.ensureContext(true);
    // Warm-decode any queued pack blobs once audio context is unlocked
    if (Object.keys(this.packBlobs).length > 0 && this.decodedPackBuffers.size === 0) {
      void this._decodeQueuedBlobs();
    }
  }

  public setVolume(v: number): void {
    this.volumes.master = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volumes.master, this.ctx.currentTime, 0.015);
    }
  }

  public getVolume(): number {
    return this.volumes.master;
  }

  public setCategoryVolumes(next: Partial<AudioCategoryVolumes>): void {
    if (next.master !== undefined) this.setVolume(next.master);
    (['blocks', 'mobs', 'ambient', 'ui'] as AudioCategory[]).forEach((cat) => {
      if (next[cat] !== undefined) {
        this.volumes[cat] = Math.max(0, Math.min(1, next[cat]!));
        const node = this.categoryGains[cat];
        if (node && this.ctx) {
          node.gain.setTargetAtTime(this.volumes[cat], this.ctx.currentTime, 0.015);
        }
      }
    });
  }

  public getCategoryVolumes(): AudioCategoryVolumes {
    return { ...this.volumes };
  }

  /**
   * Loads matched sound blobs from an imported 1.21 Resource Pack.
   */
  public async loadSoundPack(soundBlobs: Record<string, Blob>): Promise<number> {
    this.clearSoundPack();
    this.packBlobs = { ...(soundBlobs || {}) };
    if (this.ctx) {
      await this._decodeQueuedBlobs();
    }
    return Object.keys(this.packBlobs).length;
  }

  public clearSoundPack(): void {
    this.packBlobs = {};
    this.decodedPackBuffers.clear();
    this.decodingInFlight.clear();
  }

  private async _decodeQueuedBlobs(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const [key, blob] of Object.entries(this.packBlobs)) {
      if (this.decodedPackBuffers.has(key) || this.decodingInFlight.has(key)) continue;
      this.decodingInFlight.add(key);
      try {
        const arr = await blob.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arr.slice(0));
        if (!this.disposed) {
          this.decodedPackBuffers.set(key, decoded);
        }
      } catch {
        // Browser couldn't decode this .ogg variant -> keep procedural fallback
      } finally {
        this.decodingInFlight.delete(key);
      }
    }
  }

  /**
   * Plays a decoded 1.21 Resource Pack buffer if loaded. Returns true if played, false to use fallback.
   */
  private playPackSound(
    key: string,
    category: AudioCategory,
    gainVal = 0.7,
    playbackRate = 1.0
  ): boolean {
    const ctx = this.ensureContext();
    const out = this.getCategoryNode(category);
    if (!ctx || !out || this.volumes.master <= 0.001) return false;

    const buffer = this.decodedPackBuffers.get(key);
    if (!buffer) {
      // Trigger lazy decode if blob exists
      if (this.packBlobs[key] && !this.decodingInFlight.has(key)) {
        void this._decodeQueuedBlobs();
      }
      return false;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = Math.max(0.5, Math.min(2.0, playbackRate));

    const g = ctx.createGain();
    g.gain.value = gainVal;
    src.connect(g);
    g.connect(out);
    src.start(ctx.currentTime);
    return true;
  }

  private playFilteredNoise(
    duration: number,
    freq: number,
    q: number,
    gainPeak: number,
    filterType: BiquadFilterType = 'bandpass',
    freqEnd?: number,
    category: AudioCategory = 'blocks'
  ): void {
    const ctx = this.ensureContext();
    const out = this.getCategoryNode(category);
    if (!ctx || !this.noiseBuffer || !out || this.volumes.master <= 0.001) return;

    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, now);
    if (freqEnd !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + duration);
    }
    filter.Q.value = q;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(out);

    const offset = Math.random() * Math.max(0.05, this.noiseBuffer.duration - duration - 0.05);
    src.start(now, offset, duration + 0.02);
  }

  private playTone(
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    duration: number,
    gainPeak: number,
    category: AudioCategory = 'blocks'
  ): void {
    const ctx = this.ensureContext();
    const out = this.getCategoryNode(category);
    if (!ctx || !out || this.volumes.master <= 0.001) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(25, endFreq), now + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private materialProfile(group: SoundGroup): { freq: number; q: number; tone: number; packKey: string } {
    switch (group) {
      case 'grass':
      case 'leaves':
        return { freq: 1200, q: 1.4, tone: 145, packKey: 'grass' };
      case 'dirt':
      case 'sand':
      case 'snow':
        return { freq: 820, q: 1.2, tone: 120, packKey: 'sand' };
      case 'wood':
        return { freq: 620, q: 2.2, tone: 210, packKey: 'wood' };
      case 'glass':
        return { freq: 3400, q: 3.5, tone: 1350, packKey: 'glass' };
      case 'metal':
        return { freq: 1850, q: 4.0, tone: 520, packKey: 'stone' };
      case 'wool':
        return { freq: 480, q: 0.9, tone: 100, packKey: 'grass' };
      case 'water':
        return { freq: 950, q: 2.4, tone: 280, packKey: 'grass' };
      case 'stone':
      default:
        return { freq: 980, q: 2.8, tone: 175, packKey: 'stone' };
    }
  }

  public playStep(group: SoundGroup = 'grass'): void {
    const now = performance.now();
    if (now - this.lastStepAt < 260) return;
    this.lastStepAt = now;
    const p = this.materialProfile(group);
    const jitter = 0.88 + Math.random() * 0.24;
    if (this.playPackSound(`step_${p.packKey}`, 'blocks', 0.35, jitter)) return;
    this.playFilteredNoise(0.065, p.freq * jitter, p.q, 0.14, 'bandpass', undefined, 'blocks');
    this.playTone('triangle', p.tone * jitter, p.tone * 0.55, 0.055, 0.08, 'blocks');
  }

  public playMineTick(group: SoundGroup = 'stone'): void {
    const now = performance.now();
    if (now - this.lastTickAt < 135) return;
    this.lastTickAt = now;
    const p = this.materialProfile(group);
    const jitter = 0.85 + Math.random() * 0.3;
    if (this.playPackSound(`step_${p.packKey}`, 'blocks', 0.42, jitter * 0.95)) return;
    this.playFilteredNoise(0.055, p.freq * jitter * 1.1, p.q, 0.18, 'bandpass', undefined, 'blocks');
    this.playTone('square', p.tone * jitter * 1.1, p.tone * 0.65, 0.045, 0.06, 'blocks');
  }

  public playBlockBreak(group: SoundGroup = 'stone'): void {
    const p = this.materialProfile(group);
    const jitter = 0.9 + Math.random() * 0.2;
    if (this.playPackSound(`break_${p.packKey}`, 'blocks', 0.72, jitter)) return;
    if (group === 'glass') {
      this.playFilteredNoise(0.18, 4200 * jitter, 2.2, 0.32, 'highpass', undefined, 'blocks');
      this.playTone('sine', 2200 * jitter, 1100, 0.12, 0.14, 'blocks');
      this.playTone('triangle', 3100 * jitter, 1750, 0.09, 0.11, 'blocks');
      return;
    }
    this.playFilteredNoise(0.13, p.freq * jitter, p.q * 0.85, 0.32, 'bandpass', undefined, 'blocks');
    this.playTone('triangle', p.tone * jitter, p.tone * 0.42, 0.11, 0.2, 'blocks');
  }

  public playBlockPlace(group: SoundGroup = 'stone'): void {
    const p = this.materialProfile(group);
    const jitter = 0.92 + Math.random() * 0.16;
    if (this.playPackSound(`break_${p.packKey}`, 'blocks', 0.56, jitter * 0.86)) return;
    this.playFilteredNoise(0.085, p.freq * 0.9 * jitter, p.q, 0.24, 'bandpass', undefined, 'blocks');
    this.playTone('triangle', p.tone * 1.25 * jitter, p.tone * 0.72, 0.085, 0.18, 'blocks');
  }

  public playHit(): void {
    if (this.playPackSound('hurt', 'mobs', 0.65, 1.1 + Math.random() * 0.15)) return;
    this.playFilteredNoise(0.08, 720, 1.4, 0.26, 'bandpass', undefined, 'mobs');
    this.playTone('sawtooth', 260, 95, 0.09, 0.16, 'mobs');
  }

  public playHurt(): void {
    if (this.playPackSound('hurt', 'mobs', 0.78, 0.9 + Math.random() * 0.15)) return;
    this.playFilteredNoise(0.11, 520, 1.2, 0.3, 'bandpass', undefined, 'mobs');
    this.playTone('sawtooth', 195, 82, 0.15, 0.22, 'mobs');
  }

  public playEatChomp(): void {
    const jitter = 0.86 + Math.random() * 0.28;
    if (this.playPackSound('eat', 'mobs', 0.55, jitter)) return;
    this.playFilteredNoise(0.075, 1280 * jitter, 1.5, 0.22, 'bandpass', undefined, 'mobs');
  }

  public playEat(): void {
    if (this.playPackSound('eat', 'mobs', 0.65, 1.0)) return;
    this.playFilteredNoise(0.09, 1350, 1.5, 0.24, 'bandpass', undefined, 'mobs');
    this.scheduleTimer(() => this.playFilteredNoise(0.08, 1100, 1.4, 0.2, 'bandpass', undefined, 'mobs'), 95);
  }

  public playXpPickup(pitchScale = 1.0): void {
    const pitch = Math.max(0.7, Math.min(1.65, pitchScale));
    if (this.playPackSound('xp', 'ui', 0.45, pitch)) return;
    this.playTone('sine', 740 * pitch, 1180 * pitch, 0.085, 0.14, 'ui');
  }

  public playLevelUp(): void {
    if (this.playPackSound('levelup', 'ui', 0.7, 1.0)) return;
    this.playTone('triangle', 523.25, 659.25, 0.14, 0.18, 'ui');
    this.scheduleTimer(() => this.playTone('triangle', 659.25, 783.99, 0.16, 0.2, 'ui'), 110);
    this.scheduleTimer(() => this.playTone('triangle', 783.99, 1046.5, 0.24, 0.22, 'ui'), 220);
  }

  public playFlintAndSteel(): void {
    if (this.playPackSound('flint_and_steel', 'blocks', 0.65, 0.95 + Math.random() * 0.12)) return;
    this.playFilteredNoise(0.08, 3600, 3.2, 0.28, 'highpass', 1800, 'blocks');
    this.playTone('square', 1420, 680, 0.055, 0.1, 'blocks');
  }

  public playPortalTravel(): void {
    if (this.playPackSound('portal_travel', 'ambient', 0.75, 1.0)) return;
    this.playTone('sine', 160, 420, 0.7, 0.22, 'ambient');
    this.playTone('triangle', 240, 110, 0.85, 0.18, 'ambient');
    this.playFilteredNoise(0.85, 920, 2.2, 0.2, 'bandpass', 320, 'ambient');
  }

  public playEndermanTeleport(): void {
    if (this.playPackSound('enderman_teleport', 'mobs', 0.75, 0.95 + Math.random() * 0.15)) return;
    this.playTone('sawtooth', 520, 140, 0.22, 0.18, 'mobs');
    this.playFilteredNoise(0.18, 1900, 2.4, 0.24, 'bandpass', 540, 'mobs');
  }

  public playShear(): void {
    if (this.playPackSound('shear', 'mobs', 0.65, 1.0)) return;
    this.playFilteredNoise(0.06, 3100, 2.6, 0.24, 'highpass', undefined, 'mobs');
    this.scheduleTimer(() => this.playFilteredNoise(0.05, 2600, 2.4, 0.18, 'highpass', undefined, 'mobs'), 55);
  }

  public playBowRelease(): void {
    if (this.playPackSound('bow', 'mobs', 0.65, 0.95 + Math.random() * 0.15)) return;
    this.playTone('triangle', 460, 165, 0.14, 0.18, 'mobs');
    this.playFilteredNoise(0.09, 2400, 2.2, 0.15, 'bandpass', undefined, 'mobs');
  }

  public playArrowHit(): void {
    if (this.playPackSound('arrow_hit', 'mobs', 0.6, 1.0)) return;
    this.playTone('sine', 780, 320, 0.09, 0.15, 'mobs');
    this.playFilteredNoise(0.05, 1600, 2.4, 0.14, 'bandpass', undefined, 'mobs');
  }

  public playFuse(): void {
    if (this.playPackSound('fuse', 'blocks', 0.65, 1.0)) return;
    this.playFilteredNoise(0.55, 2900, 1.8, 0.22, 'highpass', 1700, 'blocks');
  }

  public playExplosion(): void {
    if (this.playPackSound('explode', 'blocks', 0.85, 0.9 + Math.random() * 0.15)) return;
    this.playFilteredNoise(0.75, 220, 0.8, 0.65, 'lowpass', 55, 'blocks');
    this.playTone('sawtooth', 120, 26, 0.6, 0.45, 'blocks');
    this.playTone('sine', 85, 22, 0.72, 0.42, 'blocks');
  }

  public playDoor(): void {
    if (this.playPackSound('door', 'blocks', 0.6, 0.95 + Math.random() * 0.1)) return;
    this.playTone('square', 220, 145, 0.07, 0.14, 'blocks');
    this.scheduleTimer(() => this.playTone('triangle', 175, 120, 0.08, 0.12, 'blocks'), 45);
  }

  public playSplash(): void {
    if (this.playPackSound('splash', 'ambient', 0.65, 0.95 + Math.random() * 0.1)) return;
    this.playFilteredNoise(0.24, 1100, 1.1, 0.28, 'bandpass', 450, 'ambient');
  }

  public playToolBreak(): void {
    if (this.playPackSound('tool_break', 'ui', 0.75, 1.0)) return;
    this.playFilteredNoise(0.18, 1750, 2.0, 0.34, 'bandpass', undefined, 'ui');
    this.playTone('sawtooth', 420, 110, 0.18, 0.24, 'ui');
  }

  public playUiClick(): void {
    if (this.playPackSound('ui_click', 'ui', 0.5, 1.0)) return;
    this.playTone('square', 680, 520, 0.032, 0.09, 'ui');
  }

  public dispose(): void {
    this.disposed = true;
    for (const id of this.pendingTimers) {
      window.clearTimeout(id);
    }
    this.pendingTimers.clear();
    this.clearSoundPack();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
      this.masterGain = null;
      this.noiseBuffer = null;
      this.categoryGains = { blocks: null, mobs: null, ambient: null, ui: null };
    }
  }
}
