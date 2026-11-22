/** The voice's sample rate, end to end (server, avatar, fallback player). */
export const VOICE_RATE = 24000;

// One Spatius avatar on the page, in DIRECT mode: each line is PCM16 mono 24 kHz
// pushed into the controller, so the SDK plays the voice and moves the lips from
// the same audio. The avatar connects to the driving service only around its own
// lines and idles on screen (drawn on this device) the rest of the time.
import { AvatarManager, AvatarSDK, AvatarView, ConnectionState, DrivingServiceMode, FrameStarvationMode, RenderQuality } from '@spatius/avatarkit';

export interface Playback {
  /** performance.now() when the voice actually started */
  started: Promise<number>;
  /** resolves when the line has finished or was interrupted */
  done: Promise<void>;
}

export interface Seat {
  connect: () => Promise<void>;
  disconnect: () => void;
  speak: (pcm: Int16Array, seconds: number) => Playback;
  /** The same, for a voice still arriving. next() gives each chunk, then null. */
  stream: (next: () => Promise<Int16Array | null>) => Playback;
  setVolume: (v: number) => void;
  interrupt: () => void;
  dispose: () => void;
  readonly speaking: boolean;
}

export interface Session {
  appId: string;
  region: string;
  sessionToken: string;
  /** every face the demo can show, by name */
  avatars: Record<string, string>;
}

let ready: Promise<void> | null = null;

/** Can this device draw the face? It needs WebGPU or WebGL2. */
export async function canDraw(): Promise<boolean> {
  const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu && (await gpu.requestAdapter().catch(() => null))) return true;
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export async function getSession(): Promise<Session> {
  const r = await fetch('/api/session');
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not start a Spatius session.');
  return r.json();
}

/** A screen left on all day outlives its token: put a new one in before the next conversation. */
export async function renewToken(): Promise<void> {
  if (!ready) return;
  const s = await getSession();
  await ready;
  AvatarSDK.setSessionToken(s.sessionToken);
}

export function initSdk(s: Session, quality: RenderQuality = RenderQuality.high): Promise<void> {
  if (!ready) ready = AvatarSDK.initialize(s.appId, { region: s.region, drivingServiceMode: DrivingServiceMode.direct, renderQuality: quality });
  return ready.then(() => AvatarSDK.setSessionToken(s.sessionToken));
}

/** Load and draw the avatar now (no click needed); call start() after a click to enable its voice. */
export async function loadSeat(container: HTMLElement, avatarId: string, onProgress?: (f: number) => void): Promise<{ start: () => Promise<Seat>; view: AvatarView }> {
  const avatar = await AvatarManager.shared.load(avatarId, (p) => {
    if (p.progress !== undefined) onProgress?.(p.progress);
  });
  onProgress?.(1);
  container.querySelectorAll('canvas').forEach((el) => el.remove());
  // 24 kHz in: the voice reaches the speaker as the voice service made it, with no down-sampling
  const view = new AvatarView(avatar, container, { audioFormat: { channelCount: 1, sampleRate: VOICE_RATE } });
  const controller = view.controller;
  // strict sync: the voice waits for the lips
  controller.frameStarvationMode = FrameStarvationMode.strictSync;
  let onState: ((state: string) => void) | null = null;
  let finishNow: (() => void) | null = null;
  controller.onConversationState = (state) => onState?.(String(state));
  let disposed = false;
  let link: Promise<void> | null = null;
  let wanted = false;
  let speaking = false;
  // a line is sent only once the service has confirmed the session, or the lips lag the voice
  let confirmed = false;
  let onConfirmed: (() => void) | null = null;
  controller.onConnectionState = (state) => {
    if (state === ConnectionState.connected) {
      confirmed = true;
      onConfirmed?.();
    }
    if (state === ConnectionState.disconnected || state === ConnectionState.failed) {
      confirmed = false;
      link = null;
    }
  };
  const sessionConfirmed = () =>
    confirmed
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const t = window.setTimeout(resolve, 6000);
          onConfirmed = () => {
            window.clearTimeout(t);
            onConfirmed = null;
            resolve();
          };
        });
  const connect = () => {
    wanted = true;
    return (link ??= (async () => {
      await controller.start();
      await sessionConfirmed();
      if (!wanted) {
        link = null;
        controller.close();
      }
    })().catch((err) => {
      link = null;
      throw err;
    }));
  };
  const disconnect = () => {
    const open = wanted || !!link;
    wanted = false;
    link = null;
    if (!open) return;
    try {
      controller.close();
    } catch {
      /* already closed */
    }
  };
  // one line, from whichever way its audio arrives
  const play = (feed: (send: (pcm: Int16Array, end: boolean) => void, finishBy: (seconds: number) => void) => Promise<void>): Playback => {
    let markStarted!: (t: number) => void;
    let markDone!: () => void;
    const started = new Promise<number>((r) => (markStarted = r));
    const done = new Promise<void>((r) => (markDone = r));
    let isStarted = false;
    let finished = false;
    let startCap = 0;
    let endCap = 0;
    const begin = () => {
      if (isStarted) return;
      isStarted = true;
      speaking = true;
      markStarted(performance.now());
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(startCap);
      window.clearTimeout(endCap);
      onState = null;
      finishNow = null;
      begin();
      speaking = false;
      markDone();
    };
    finishNow = finish;
    void (async () => {
      await connect().catch((err) => console.warn('[welcome] could not connect', err));
      if (disposed || finished) return finish();
      startCap = window.setTimeout(begin, 6000);
      onState = (state) => {
        if (state === 'playing') begin();
        else if (state === 'idle' && isStarted) finish();
      };
      controller.setVolume(1);
      await feed(
        (pcm, end) => {
          if (!finished) controller.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer, end);
        },
        (seconds) => {
          if (!finished) endCap = window.setTimeout(finish, seconds * 1000 + 4000);
        },
      ).catch((err) => {
        console.warn('[welcome] the voice stopped', err);
        finish();
      });
    })();
    return { started, done };
  };
  const seat: Seat = {
    connect,
    disconnect,
    get speaking() {
      return speaking;
    },
    speak: (pcm, seconds) =>
      play(async (send, finishBy) => {
        finishBy(seconds);
        send(pcm, true);
      }),
    stream: (next) =>
      play(async (send, finishBy) => {
        let samples = 0;
        let chunk = await next();
        while (chunk && !disposed) {
          const after = await next();
          samples += chunk.length;
          send(chunk, after === null);
          chunk = after;
        }
        finishBy(samples / VOICE_RATE);
      }),
    setVolume: (v) => controller.setVolume(v),
    interrupt: () => {
      try {
        controller.interrupt();
      } catch {
        /* nothing playing */
      }
      finishNow?.();
    },
    dispose: () => {
      disposed = true;
      try {
        controller.interrupt();
      } catch {
        /* nothing playing */
      }
      disconnect();
      finishNow?.();
      view.dispose();
    },
  };
  let started: Promise<Seat> | null = null;
  return {
    view,
    start: () =>
      (started ??= (async () => {
        await controller.initializeAudioContext();
        return seat;
      })()),
  };
}
