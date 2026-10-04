export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  if (path === '/') {
    // v1.4.11 — cold start lands on the settings tab (IP-status card lives
    // there) instead of the scanner. v1.4.10 tried to do this with an
    // in-app router.replace after mount, which crashed the app at startup.
    return '/settings';
  }
  return path;
}
