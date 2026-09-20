const SOUND_NAMES = ['wing', 'point', 'hit', 'die', 'swooshing'];
const DEFAULT_DIAGNOSTIC_LIMIT = 250;

function safeFocusState() {
  try {
    return typeof document?.hasFocus === 'function' ? document.hasFocus() : null;
  } catch {
    return null;
  }
}

function safeVisibilityState() {
  try {
    return document?.visibilityState ?? null;
  } catch {
    return null;
  }
}

export class Audio {
  constructor({ version = null, diagnosticLimit = DEFAULT_DIAGNOSTIC_LIMIT } = {}) {
    this.raw = new Map();
    this.buffers = new Map();
    this.context = null;
    this.decoding = null;
    this.muted = false;
    this.error = null;
    this.version = version;
    this.diagnosticLimit = diagnosticLimit;
    this.events = [];
    this.sequence = 0;
    this.lastSound = null;
    this.lastSoundResult = null;
    this.resumePromise = null;

    this.note('AUDIO_CREATED');
  }

  _state(extra = {}) {
    return {
      context: this.context?.state ?? 'none',
      muted: this.muted,
      rawLoaded: this.raw.size,
      buffersLoaded: this.buffers.size,
      decoding: Boolean(this.decoding),
      visibility: safeVisibilityState(),
      focus: safeFocusState(),
      ...extra,
    };
  }

  note(type, detail = {}) {
    const event = {
      seq: ++this.sequence,
      at: new Date().toISOString(),
      monotonicMs: Math.round((globalThis.performance?.now?.() ?? 0) * 1000) / 1000,
      type,
      ...this._state(),
      detail,
    };

    this.events.push(event);

    if (this.events.length > this.diagnosticLimit) {
      this.events.splice(0, this.events.length - this.diagnosticLimit);
    }

    return event;
  }

  async preload() {
    this.note('PRELOAD_START');

    try {
      await Promise.all(
        SOUND_NAMES.map(async name => {
          const url = new URL(`../assets/sounds/sfx_${name}.wav`, import.meta.url);
          const response = await fetch(url);

          if (!response.ok) {
            throw new Error(`Son ${name} : HTTP ${response.status}`);
          }

          this.raw.set(name, await response.arrayBuffer());
        }),
      );
      this.note('PRELOAD_OK', { names: [...this.raw.keys()] });
    } catch (error) {
      this.error = error.message;
      this.note('PRELOAD_ERROR', { message: error.message });
      throw error;
    }
  }

  _bindContextDiagnostics() {
    if (!this.context) {
      return;
    }

    this.context.addEventListener?.('statechange', () => {
      this.note('AUDIO_STATECHANGE');
    });
  }

  unlock(origin = 'unknown') {
    this.note('UNLOCK_REQUEST', { origin });

    if (!this.context) {
      const AudioContextType = window.AudioContext || window.webkitAudioContext;

      if (!AudioContextType) {
        this.error = 'Web Audio indisponible';
        this.note('AUDIO_UNAVAILABLE', { origin });
        return;
      }

      try {
        this.context = new AudioContextType();
        this.note('CONTEXT_CREATED', { origin, sampleRate: this.context.sampleRate });
        this._bindContextDiagnostics();
      } catch (error) {
        this.error = error.message;
        this.note('CONTEXT_CREATE_ERROR', { origin, message: error.message });
        return;
      }

      this.decoding = Promise.all(
        [...this.raw].map(async ([name, raw]) => {
          const buffer = await this.context.decodeAudioData(raw.slice(0));
          this.buffers.set(name, buffer);
        }),
      ).then(() => {
        this.note('DECODE_OK', { names: [...this.buffers.keys()] });
      }).catch(error => {
        this.error = error.message;
        this.note('DECODE_ERROR', { message: error.message });
      });
    }

    // Safari/iOS exposes the non-standard `interrupted` state when audio is
    // taken away from the PWA. It must be treated like `suspended`. Keep this
    // call synchronous with the user gesture whenever unlock() is the caller.
    this._requestResume(origin);
  }

  _requestResume(origin = 'unknown') {
    if (!this.context) {
      return false;
    }

    const from = this.context.state;

    if (from === 'running') {
      return true;
    }

    if (from === 'closed') {
      this.note('RESUME_SKIPPED', { origin, from, reason: 'context-closed' });
      return false;
    }

    if (this.resumePromise) {
      this.note('RESUME_PENDING', { origin, from });
      return false;
    }

    this.note('RESUME_REQUEST', { origin, from });

    try {
      const result = this.context.resume();
      this.resumePromise = Promise.resolve(result)
        .then(() => {
          this.note('RESUME_OK', { origin, from, to: this.context?.state ?? 'none' });
        })
        .catch(error => {
          this.error = error.message;
          this.note('RESUME_ERROR', { origin, from, message: error.message });
        })
        .finally(() => {
          this.resumePromise = null;
        });
    } catch (error) {
      this.error = error.message;
      this.note('RESUME_ERROR', { origin, from, message: error.message });
      this.resumePromise = null;
    }

    return false;
  }

  recover(origin = 'foreground') {
    this.note('RECOVERY_REQUEST', { origin });
    return this._requestResume(origin);
  }

  play(name) {
    this.lastSound = name;
    this.note('SFX_REQUEST', { name });

    if (this.muted) {
      this.lastSoundResult = 'muted';
      this.note('SFX_SKIPPED', { name, reason: 'muted' });
      return;
    }

    if (!this.context) {
      this.lastSoundResult = 'no-context';
      this.note('SFX_SKIPPED', { name, reason: 'no-context' });
      return;
    }

    if (this.context.state !== 'running') {
      const state = this.context.state;
      this._requestResume(`sfx-${name}`);
      this.lastSoundResult = `context-${state}`;
      this.note('SFX_SKIPPED', { name, reason: this.lastSoundResult });
      return;
    }

    const buffer = this.buffers.get(name);

    if (!buffer) {
      this.lastSoundResult = 'buffer-missing';
      this.note('SFX_SKIPPED', { name, reason: 'buffer-missing' });
      return;
    }

    try {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context.destination);
      source.start();
      this.lastSoundResult = 'started';
      this.note('SFX_STARTED', { name });
    } catch (error) {
      this.error = error.message;
      this.lastSoundResult = 'error';
      this.note('SFX_ERROR', { name, message: error.message });
    }
  }

  summary() {
    return {
      version: this.version,
      context: this.context?.state ?? 'none',
      muted: this.muted,
      rawLoaded: this.raw.size,
      buffersLoaded: this.buffers.size,
      lastSound: this.lastSound,
      lastSoundResult: this.lastSoundResult,
      error: this.error,
      visibility: safeVisibilityState(),
      focus: safeFocusState(),
      eventCount: this.events.length,
      lastEvent: this.events.at(-1)?.type ?? null,
    };
  }

  diagnostics(extra = {}) {
    return {
      schema: 'flappy13-audio-diagnostics-v1',
      version: this.version,
      capturedAt: new Date().toISOString(),
      userAgent: globalThis.navigator?.userAgent ?? null,
      platform: globalThis.navigator?.platform ?? null,
      summary: this.summary(),
      extra,
      events: structuredClone(this.events),
    };
  }
}
