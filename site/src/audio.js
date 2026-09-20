const SOUND_NAMES = ['wing', 'point', 'hit', 'die', 'swooshing'];
const DEFAULT_DIAGNOSTIC_LIMIT = 250;
const RESUME_TIMEOUT_MS = 700;

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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class Audio {
  constructor({ version = null, diagnosticLimit = DEFAULT_DIAGNOSTIC_LIMIT, resumeTimeoutMs = RESUME_TIMEOUT_MS } = {}) {
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
    this.resumeAttempt = 0;
    this.contextGeneration = 0;
    this.hardRecoveryNeeded = false;
    this.recoveryPromise = null;
    this.pendingSound = null;
    this.resumeTimeoutMs = resumeTimeoutMs;

    this.note('AUDIO_CREATED');
  }

  _state(extra = {}) {
    return {
      context: this.context?.state ?? 'none',
      muted: this.muted,
      rawLoaded: this.raw.size,
      buffersLoaded: this.buffers.size,
      decoding: Boolean(this.decoding),
      hardRecoveryNeeded: this.hardRecoveryNeeded,
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

  _audioContextType() {
    return window.AudioContext || window.webkitAudioContext || null;
  }

  _bindContextDiagnostics(context, generation) {
    context?.addEventListener?.('statechange', () => {
      this.note('AUDIO_STATECHANGE', {
        generation,
        contextState: context.state,
        active: context === this.context,
      });
    });
  }

  _primeContext(context, origin) {
    try {
      if (!context?.createBuffer || !context?.createBufferSource) return false;
      const buffer = context.createBuffer(1, 1, context.sampleRate || 48000);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(0);
      this.note('UNLOCK_PULSE', { origin });
      return true;
    } catch (error) {
      this.note('UNLOCK_PULSE_ERROR', { origin, message: error.message });
      return false;
    }
  }

  _decodeContext(context, generation, origin) {
    const decoded = new Map();

    this.note('DECODE_START', { origin, generation });

    const promise = Promise.all(
      [...this.raw].map(async ([name, raw]) => {
        const buffer = await context.decodeAudioData(raw.slice(0));
        decoded.set(name, buffer);
      }),
    )
      .then(() => {
        if (context !== this.context || generation !== this.contextGeneration) {
          this.note('DECODE_DISCARDED', { origin, generation });
          return false;
        }

        this.buffers = decoded;
        this.note('DECODE_OK', { origin, generation, names: [...this.buffers.keys()] });
        this._flushPendingSound(`decode-${origin}`);
        return true;
      })
      .catch(error => {
        if (context === this.context && generation === this.contextGeneration) {
          this.error = error.message;
        }
        this.note('DECODE_ERROR', { origin, generation, message: error.message });
        return false;
      })
      .finally(() => {
        if (this.decoding === promise) {
          this.decoding = null;
        }
      });

    this.decoding = promise;
    return promise;
  }

  _createContext(origin, { replacing = false } = {}) {
    const AudioContextType = this._audioContextType();

    if (!AudioContextType) {
      this.error = 'Web Audio indisponible';
      this.note('AUDIO_UNAVAILABLE', { origin });
      return null;
    }

    try {
      const context = new AudioContextType();
      const generation = ++this.contextGeneration;
      this.context = context;
      this.buffers = new Map();
      this.hardRecoveryNeeded = false;

      this.note(replacing ? 'CONTEXT_RECREATED' : 'CONTEXT_CREATED', {
        origin,
        generation,
        sampleRate: context.sampleRate,
      });

      this._bindContextDiagnostics(context, generation);
      this._primeContext(context, origin);
      this._decodeContext(context, generation, origin);
      return context;
    } catch (error) {
      this.error = error.message;
      this.note(replacing ? 'CONTEXT_RECREATE_ERROR' : 'CONTEXT_CREATE_ERROR', {
        origin,
        message: error.message,
      });
      return null;
    }
  }

  _hardRecover(origin = 'user-gesture') {
    if (this.recoveryPromise) {
      this.note('HARD_RECOVERY_PENDING', { origin });
      return false;
    }

    const previous = this.context;
    const previousState = previous?.state ?? 'none';
    this.note('HARD_RECOVERY_REQUEST', { origin, previousState });

    // Invalidate any resume attempt tied to the old context. A Safari resume()
    // promise may stay pending indefinitely after device lock.
    this.resumeAttempt += 1;
    this.resumePromise = null;

    const context = this._createContext(origin, { replacing: Boolean(previous) });
    if (!context) {
      this.hardRecoveryNeeded = true;
      return false;
    }

    if (previous && previous !== context) {
      try {
        Promise.resolve(previous.close?.()).catch(error => {
          this.note('OLD_CONTEXT_CLOSE_ERROR', { origin, message: error.message });
        });
      } catch (error) {
        this.note('OLD_CONTEXT_CLOSE_ERROR', { origin, message: error.message });
      }
    }

    // The replacement context is created synchronously from a user gesture.
    // Ask it to run immediately, before the gesture stack unwinds.
    this._requestResume(`${origin}-recreated`);

    const decodePromise = this.decoding ?? Promise.resolve(true);
    this.recoveryPromise = Promise.resolve(decodePromise)
      .then(() => {
        if (this.context !== context) return false;

        if (context.state === 'running') {
          this.hardRecoveryNeeded = false;
          this.note('HARD_RECOVERY_OK', { origin, state: context.state });
          this._flushPendingSound(`hard-recovery-${origin}`);
          return true;
        }

        this.hardRecoveryNeeded = true;
        this.note('HARD_RECOVERY_WAITING_FOR_GESTURE', { origin, state: context.state });
        return false;
      })
      .finally(() => {
        this.recoveryPromise = null;
      });

    return false;
  }

  unlock(origin = 'unknown') {
    this.note('UNLOCK_REQUEST', { origin });

    if (!this.context) {
      if (!this._createContext(origin)) return;
      this._requestResume(origin);
      return;
    }

    // A context left in WebKit's `interrupted` state after device lock is not
    // reliably recoverable with resume() alone. On a real user gesture, replace
    // it entirely and re-decode the five tiny SFX buffers.
    if (this.context.state === 'interrupted' || this.hardRecoveryNeeded) {
      this._hardRecover(origin);
      return;
    }

    this._requestResume(origin);
  }

  _requestResume(origin = 'unknown') {
    if (!this.context) return false;

    const context = this.context;
    const from = context.state;

    if (from === 'running') {
      this.hardRecoveryNeeded = false;
      this._flushPendingSound(`resume-${origin}`);
      return true;
    }

    if (from === 'closed') {
      this.hardRecoveryNeeded = true;
      this.note('RESUME_SKIPPED', { origin, from, reason: 'context-closed' });
      return false;
    }

    if (this.resumePromise) {
      this.note('RESUME_PENDING', { origin, from });
      return false;
    }

    const attempt = ++this.resumeAttempt;
    this.note('RESUME_REQUEST', { origin, from, attempt });

    try {
      const result = context.resume();
      const completion = Promise.resolve(result).then(() => 'resolved');
      // Safari can leave resume() pending forever not only from the non-standard
      // `interrupted` state, but also from a freshly-created `suspended` context.
      // Bound every non-running resume attempt so a later user gesture can
      // trigger hard recovery instead of being blocked by RESUME_PENDING forever.
      const guarded = Promise.race([
        completion,
        delay(this.resumeTimeoutMs).then(() => 'timeout'),
      ]);

      const promise = guarded
        .then(outcome => {
          if (attempt !== this.resumeAttempt || context !== this.context) return;

          const to = context.state;
          if (to === 'running') {
            this.hardRecoveryNeeded = false;
            this.note('RESUME_OK', { origin, from, to, attempt, outcome });
            this._flushPendingSound(`resume-${origin}`);
            return;
          }

          this.hardRecoveryNeeded = true;
          this.note(outcome === 'timeout' ? 'RESUME_TIMEOUT' : 'RESUME_STUCK', {
            origin,
            from,
            to,
            attempt,
          });
        })
        .catch(error => {
          if (attempt !== this.resumeAttempt || context !== this.context) return;
          this.error = error.message;
          this.hardRecoveryNeeded = true;
          this.note('RESUME_ERROR', { origin, from, attempt, message: error.message });
        })
        .finally(() => {
          if (attempt === this.resumeAttempt && this.resumePromise === promise) {
            this.resumePromise = null;
          }
        });

      this.resumePromise = promise;
    } catch (error) {
      this.error = error.message;
      this.hardRecoveryNeeded = true;
      this.note('RESUME_ERROR', { origin, from, message: error.message });
      this.resumePromise = null;
    }

    return false;
  }

  recover(origin = 'foreground') {
    this.note('RECOVERY_REQUEST', { origin });
    return this._requestResume(origin);
  }

  _startSound(name, { flushedFrom = null } = {}) {
    const buffer = this.buffers.get(name);
    if (!buffer || !this.context || this.context.state !== 'running') return false;

    try {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context.destination);
      source.start();
      this.lastSoundResult = 'started';
      this.note(flushedFrom ? 'SFX_FLUSHED' : 'SFX_STARTED', {
        name,
        ...(flushedFrom ? { from: flushedFrom } : {}),
      });
      return true;
    } catch (error) {
      this.error = error.message;
      this.lastSoundResult = 'error';
      this.note('SFX_ERROR', { name, message: error.message });
      return false;
    }
  }

  _queueSound(name, reason) {
    // Keep only the most recent requested sound. This avoids a burst of stale
    // flap sounds if decoding takes a few milliseconds after lock recovery.
    this.pendingSound = name;
    this.lastSoundResult = `queued-${reason}`;
    this.note('SFX_QUEUED', { name, reason });
  }

  _flushPendingSound(origin) {
    if (!this.pendingSound || this.muted) return false;
    if (!this.context || this.context.state !== 'running') return false;
    if (!this.buffers.has(this.pendingSound)) return false;

    const name = this.pendingSound;
    this.pendingSound = null;
    return this._startSound(name, { flushedFrom: origin });
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
      if (state === 'interrupted') this.hardRecoveryNeeded = true;
      this._queueSound(name, `context-${state}`);
      this._requestResume(`sfx-${name}`);
      return;
    }

    if (!this.buffers.has(name)) {
      if (this.decoding || this.recoveryPromise) {
        this._queueSound(name, 'buffer-decoding');
        return;
      }

      this.lastSoundResult = 'buffer-missing';
      this.note('SFX_SKIPPED', { name, reason: 'buffer-missing' });
      return;
    }

    this._startSound(name);
  }

  summary() {
    return {
      version: this.version,
      context: this.context?.state ?? 'none',
      muted: this.muted,
      rawLoaded: this.raw.size,
      buffersLoaded: this.buffers.size,
      hardRecoveryNeeded: this.hardRecoveryNeeded,
      recoveryPending: Boolean(this.recoveryPromise),
      pendingSound: this.pendingSound,
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
      schema: 'flappy13-audio-diagnostics-v2',
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
