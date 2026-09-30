export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  if (path === '/') {
    return '/(tabs)/(home)';
  }
  return path;
}
