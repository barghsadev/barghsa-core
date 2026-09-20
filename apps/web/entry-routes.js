/** These pages use the small authentication entry bundle. @param {string} pathname */
export function isAuthEntryPath(pathname) {
  const path = pathname.split('?')[0].split('#')[0];
  if (path === '/auth/index.html') return true;
  return ['/login', '/register', '/forgot-password', '/activate'].some(
    (prefix) => path === prefix || path.startsWith(prefix + '/')
  );
}
