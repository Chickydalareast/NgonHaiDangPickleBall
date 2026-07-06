export type AdminAlertSoundKind = 'ORDER' | 'SERVICE_REQUEST';
export type AdminAlertEscalationLevel = 0 | 1 | 2;

interface AlertToneEvent {
  readonly offsetSeconds: number;
  readonly durationSeconds: number;
  readonly frequencies: readonly number[];
  readonly wave: OscillatorType;
  readonly gain: number;
  readonly rough?: boolean;
}

export interface AdminAlertAudioEngine {
  readonly context: AudioContext;
  play: (kind: AdminAlertSoundKind, level: AdminAlertEscalationLevel) => void;
}

export const ADMIN_ALERT_AUDIO_SELECTION = {
  order: 'order-c-fast-rise',
  serviceRequest: 'staff-a-dual-ring',
} as const;

const MASTER_GAIN = 0.82;
const levelGainMultipliers = [0.92, 1, 1.08] as const;
const orderRepeatDelays = [1_500, 1_300, 1_100] as const;
const serviceRequestRepeatDelays = [1_600, 1_400, 1_250] as const;

const orderEvents: readonly AlertToneEvent[] = [
  {
    offsetSeconds: 0,
    durationSeconds: 0.18,
    frequencies: [660],
    wave: 'square',
    gain: 0.5,
  },
  {
    offsetSeconds: 0.16,
    durationSeconds: 0.18,
    frequencies: [990],
    wave: 'square',
    gain: 0.54,
  },
  {
    offsetSeconds: 0.38,
    durationSeconds: 0.15,
    frequencies: [1_320],
    wave: 'square',
    gain: 0.58,
  },
  {
    offsetSeconds: 0.55,
    durationSeconds: 0.15,
    frequencies: [1_320],
    wave: 'square',
    gain: 0.6,
  },
  {
    offsetSeconds: 0.72,
    durationSeconds: 0.2,
    frequencies: [1_760],
    wave: 'sawtooth',
    gain: 0.68,
  },
];

const serviceRequestEvents: readonly AlertToneEvent[] = [0, 0.32, 0.76, 1.08].map(
  (offsetSeconds): AlertToneEvent => ({
    offsetSeconds,
    durationSeconds: 0.23,
    frequencies: [520, 680],
    wave: 'square',
    gain: 0.34,
    rough: true,
  }),
);

function scheduleNoiseAttack(
  context: AudioContext,
  destination: AudioNode,
  startAt: number,
  amount: number,
): void {
  const durationSeconds = 0.025;
  const frameCount = Math.max(1, Math.floor(context.sampleRate * durationSeconds));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let index = 0; index < frameCount; index += 1) {
    const decay = Math.exp(-index / (frameCount * 0.18));
    data[index] = (Math.random() * 2 - 1) * decay;
  }

  const source = context.createBufferSource();
  const gain = context.createGain();

  source.buffer = buffer;
  gain.gain.setValueAtTime(amount, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSeconds);
  source.connect(gain);
  gain.connect(destination);
  source.start(startAt);
  source.stop(startAt + durationSeconds + 0.01);
}

function scheduleTone(
  context: AudioContext,
  destination: AudioNode,
  event: AlertToneEvent,
  startAt: number,
  gainMultiplier: number,
  kind: AdminAlertSoundKind,
): void {
  scheduleNoiseAttack(context, destination, startAt, kind === 'SERVICE_REQUEST' ? 0.16 : 0.11);

  for (const frequency of event.frequencies) {
    const oscillator = context.createOscillator();
    const harmonic = context.createOscillator();
    const oscillatorGain = context.createGain();
    const harmonicGain = context.createGain();
    const peakGain = event.gain * gainMultiplier;

    oscillator.type = event.wave;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    harmonic.type = 'sine';
    harmonic.frequency.setValueAtTime(frequency * 2.01, startAt);

    oscillatorGain.gain.setValueAtTime(0.0001, startAt);
    oscillatorGain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.004);
    oscillatorGain.gain.setValueAtTime(
      peakGain,
      startAt + Math.max(0.006, event.durationSeconds - 0.035),
    );
    oscillatorGain.gain.exponentialRampToValueAtTime(0.0001, startAt + event.durationSeconds);

    harmonicGain.gain.setValueAtTime(0.0001, startAt);
    harmonicGain.gain.exponentialRampToValueAtTime(peakGain * 0.24, startAt + 0.003);
    harmonicGain.gain.exponentialRampToValueAtTime(0.0001, startAt + event.durationSeconds);

    oscillator.connect(oscillatorGain);
    harmonic.connect(harmonicGain);
    oscillatorGain.connect(destination);
    harmonicGain.connect(destination);

    if (event.rough) {
      const modulation = context.createOscillator();
      const modulationGain = context.createGain();

      modulation.frequency.setValueAtTime(19, startAt);
      modulationGain.gain.setValueAtTime(0.06, startAt);
      modulation.connect(modulationGain);
      modulationGain.connect(oscillatorGain.gain);
      modulation.start(startAt);
      modulation.stop(startAt + event.durationSeconds);
    }

    oscillator.start(startAt);
    harmonic.start(startAt);
    oscillator.stop(startAt + event.durationSeconds + 0.02);
    harmonic.stop(startAt + event.durationSeconds + 0.02);
  }
}

export function adminAlertRepeatDelay(
  kind: AdminAlertSoundKind,
  level: AdminAlertEscalationLevel,
): number {
  return kind === 'SERVICE_REQUEST' ? serviceRequestRepeatDelays[level] : orderRepeatDelays[level];
}

export function createAdminAlertAudioEngine(context: AudioContext): AdminAlertAudioEngine {
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();

  master.gain.value = MASTER_GAIN;
  compressor.threshold.value = -18;
  compressor.knee.value = 12;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.16;
  master.connect(compressor);
  compressor.connect(context.destination);

  return {
    context,
    play(kind, level) {
      const startAt = context.currentTime + 0.04;
      const gainMultiplier = levelGainMultipliers[level];
      const events = kind === 'SERVICE_REQUEST' ? serviceRequestEvents : orderEvents;

      for (const event of events) {
        scheduleTone(context, master, event, startAt + event.offsetSeconds, gainMultiplier, kind);
      }
    },
  };
}
