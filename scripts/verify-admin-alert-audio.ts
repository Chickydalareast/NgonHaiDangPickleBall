import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = process.cwd();

function readText(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(source: string, marker: string, message: string): void {
  assert(source.includes(marker), message);
}

function main(): void {
  const runtime = readText('apps/web/src/components/admin-alert-runtime.tsx');
  const engine = readText('apps/web/src/features/admin-alert/admin-alert-audio.ts');
  const styles = readText('apps/web/src/styles.css');
  const rootPackage = JSON.parse(readText('package.json')) as {
    scripts?: Record<string, string>;
  };

  assertIncludes(
    runtime,
    "const AUDIO_PREFERENCE_KEY = 'nhdp-admin-alert-audio-preference-v1';",
    'Audio preference key is missing.',
  );
  assertIncludes(
    runtime,
    'return { desired: true };',
    'Audio must default to desired on a new device.',
  );
  assertIncludes(
    runtime,
    "window.addEventListener('pointerdown', unlockAudio",
    'Pointer interaction recovery is missing.',
  );
  assertIncludes(
    runtime,
    "window.addEventListener('keydown', unlockAudio",
    'Keyboard interaction recovery is missing.',
  );
  assertIncludes(
    runtime,
    "engine.context.addEventListener('statechange', handleStateChange);",
    'AudioContext statechange recovery is missing.',
  );
  assertIncludes(
    runtime,
    "document.addEventListener('visibilitychange', recoverAudio);",
    'Visibility recovery is missing.',
  );
  assertIncludes(
    runtime,
    "window.addEventListener('focus', recoverAudio);",
    'Window focus recovery is missing.',
  );
  assertIncludes(
    runtime,
    'const ownershipActive =',
    'Single-tab side-effect ownership must remain explicit.',
  );
  assertIncludes(runtime, "audioStatus === 'ready'", 'Ready-state gating is missing.');
  assertIncludes(
    runtime,
    'Order C và chuông Dual ring đã sẵn sàng',
    'Locked sound names are missing from the runtime UI.',
  );
  assert(
    !runtime.includes('Bật âm thanh cảnh báo'),
    'The old mandatory per-session sound button is still present.',
  );
  assert(
    !runtime.includes('const [alertsEnabled, setAlertsEnabled]'),
    'The old ephemeral alertsEnabled state is still present.',
  );

  const activateStart = runtime.indexOf('const activateAudio =');
  const notificationStart = runtime.indexOf('const requestNotificationPermission =');
  assert(
    activateStart >= 0 && notificationStart > activateStart,
    'Audio and notification callbacks were not found in the expected order.',
  );
  assert(
    !runtime.slice(activateStart, notificationStart).includes('Notification.requestPermission'),
    'Audio activation must not request notification permission.',
  );
  assertIncludes(
    runtime.slice(notificationStart),
    'Notification.requestPermission()',
    'Notification permission must remain available as a separate action.',
  );

  assertIncludes(engine, "order: 'order-c-fast-rise'", 'ORDER sound must remain Order C.');
  assertIncludes(
    engine,
    "serviceRequest: 'staff-a-dual-ring'",
    'CALL_STAFF sound must remain Dual ring A.',
  );
  assertIncludes(
    engine,
    'const orderRepeatDelays = [1_500, 1_300, 1_100] as const;',
    'ORDER repeat escalation changed unexpectedly.',
  );
  assertIncludes(
    engine,
    'const serviceRequestRepeatDelays = [1_600, 1_400, 1_250] as const;',
    'CALL_STAFF repeat escalation changed unexpectedly.',
  );

  for (const marker of [
    'frequencies: [660]',
    'frequencies: [990]',
    'frequencies: [1_320]',
    'frequencies: [1_760]',
    'frequencies: [520, 680]',
    'compressor.threshold.value = -18;',
    'compressor.ratio.value = 5;',
  ]) {
    assertIncludes(engine, marker, `Sound engine marker missing: ${marker}`);
  }

  assertIncludes(styles, '.admin-alert-audio-status', 'Audio health status styles are missing.');
  assertIncludes(styles, '.admin-alert-audio-controls', 'Audio control panel styles are missing.');

  assert(
    rootPackage.scripts?.['audio:verify'] === 'tsx scripts/verify-admin-alert-audio.ts',
    'Root audio:verify script is missing or incorrect.',
  );

  console.log('ADMIN_ALERT_AUDIO_SOURCE_VERIFY_PASS');
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
}
