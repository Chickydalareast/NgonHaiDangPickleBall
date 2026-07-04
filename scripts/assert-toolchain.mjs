import { execSync } from 'node:child_process';

const [major, minor, patch] = process.versions.node.split('.').map(Number);

const nodePass = major === 24 && (minor > 17 || (minor === 17 && patch >= 0));

if (!nodePass) {
  console.error(
    `Expected Node.js >=24.17.0 <25, received ${process.version}. Use the repository-pinned Node.js version.`,
  );
  process.exit(1);
}

function resolvePnpmVersion() {
  const userAgent = process.env.npm_config_user_agent;

  const versionFromUserAgent = userAgent?.match(/\bpnpm\/(\d+\.\d+\.\d+(?:-[^\s]+)?)/)?.[1];

  if (versionFromUserAgent) {
    return versionFromUserAgent;
  }

  try {
    return execSync('pnpm --version', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim();
  } catch (error) {
    console.error(
      'Unable to resolve the active pnpm version. Run this check through pnpm or enable pnpm with Corepack.',
    );

    if (error instanceof Error) {
      console.error(error.message);
    }

    process.exit(1);
  }
}

const pnpmVersion = resolvePnpmVersion();
const pnpmMajor = Number(pnpmVersion.split('.')[0]);

if (pnpmMajor !== 11) {
  console.error(`Expected pnpm 11.x, received ${pnpmVersion}. Run: corepack use pnpm@latest-11`);
  process.exit(1);
}

console.log(`Toolchain OK: Node.js ${process.version}, pnpm ${pnpmVersion}`);
