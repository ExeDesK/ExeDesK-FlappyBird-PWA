export const FRAME_DRIVER_AUTO = 'auto';
export const FRAME_DRIVER_RAF = 'raf';
export const FRAME_DRIVER_TIMER = 'timer';
export const FRAME_DRIVER_WORKER = 'worker';

const VALID_FRAME_DRIVERS = new Set([
  FRAME_DRIVER_AUTO,
  FRAME_DRIVER_RAF,
  FRAME_DRIVER_TIMER,
  FRAME_DRIVER_WORKER,
]);

export function normalizeFrameDriverPreference(value) {
  return VALID_FRAME_DRIVERS.has(value) ? value : FRAME_DRIVER_AUTO;
}

export function isIOSWebKitEnvironment({
  userAgent = '',
  platform = '',
  maxTouchPoints = 0,
} = {}) {
  const ua = String(userAgent);
  const webkit = /AppleWebKit/i.test(ua);
  const nativeIOS = /iPhone|iPad|iPod/i.test(ua);
  const desktopIPad = platform === 'MacIntel' && Number(maxTouchPoints) > 1;
  return webkit && (nativeIOS || desktopIPad);
}

export function resolveFrameDriver(preference, environment = {}) {
  const normalized = normalizeFrameDriverPreference(preference);
  if (normalized !== FRAME_DRIVER_AUTO) {
    return normalized;
  }
  return isIOSWebKitEnvironment(environment) && environment.workerAvailable !== false
    ? FRAME_DRIVER_WORKER
    : FRAME_DRIVER_RAF;
}
