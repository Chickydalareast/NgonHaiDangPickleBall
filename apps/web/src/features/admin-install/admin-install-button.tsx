import { useState, useSyncExternalStore } from 'react';

type InstallOutcome = 'accepted' | 'dismissed';

interface InstallChoice {
  outcome: InstallOutcome;
  platform?: string;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<InstallChoice | void>;
  readonly userChoice: Promise<InstallChoice>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = isStandaloneMode();
let snapshotVersion = 0;

const listeners = new Set<() => void>();

function isStandaloneMode(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const iosNavigator = navigator as Navigator & { standalone?: boolean };

  return (
    window.matchMedia('(display-mode: standalone)').matches || iosNavigator.standalone === true
  );
}

function isAdminPath(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
}

function publish(): void {
  snapshotVersion += 1;

  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function getSnapshotVersion(): number {
  return snapshotVersion;
}

function canInstall(): boolean {
  return !installed && deferredPrompt !== null;
}

async function promptAdminInstall(): Promise<InstallOutcome | null> {
  const promptEvent = deferredPrompt;

  if (!promptEvent) {
    return null;
  }

  deferredPrompt = null;
  publish();

  const promptResult = await promptEvent.prompt();

  if (promptResult && typeof promptResult === 'object' && 'outcome' in promptResult) {
    return promptResult.outcome;
  }

  const choice = await promptEvent.userChoice;
  return choice.outcome;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    if (!isAdminPath() || installed) {
      return;
    }

    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    publish();
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    publish();
  });

  const displayMode = window.matchMedia('(display-mode: standalone)');

  displayMode.addEventListener('change', (event) => {
    installed = event.matches;

    if (installed) {
      deferredPrompt = null;
    }

    publish();
  });
}

function InstallIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 4h10a2 2 0 0 1 2 2v7" />
      <path d="M5 13V6a2 2 0 0 1 2-2" />
      <path d="M4 17h16" />
      <path d="M9 21h6" />
      <path d="M12 7v7" />
      <path d="m9.5 11.5 2.5 2.5 2.5-2.5" />
    </svg>
  );
}

export function AdminInstallButton() {
  useSyncExternalStore(subscribe, getSnapshotVersion, getSnapshotVersion);
  const [promptPending, setPromptPending] = useState(false);

  if (!canInstall()) {
    return null;
  }

  const handleInstall = async (): Promise<void> => {
    setPromptPending(true);

    try {
      await promptAdminInstall();
    } finally {
      setPromptPending(false);
    }
  };

  return (
    <button
      type="button"
      className="admin-page-install"
      aria-label={promptPending ? 'Đang mở hộp thoại cài đặt' : 'Cài ứng dụng quản trị'}
      title="Cài Ngọn Hải Đăng Admin vào máy"
      disabled={promptPending}
      onClick={() => void handleInstall()}
    >
      <InstallIcon />
      <span>{promptPending ? 'Đang mở…' : 'Cài ứng dụng'}</span>
    </button>
  );
}
