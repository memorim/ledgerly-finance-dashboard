// Local operator apps have no account boundary; a public reverse proxy must add authentication.
export function operatorBoundary(env = process.env) {
  let configured;
  if (env.APP_PUBLIC_ORIGIN) {
    configured = new URL(env.APP_PUBLIC_ORIGIN);
    if (
      !['https:', 'http:'].includes(configured.protocol) ||
      configured.username ||
      configured.password ||
      configured.pathname !== '/' ||
      configured.search ||
      configured.hash
    )
      throw new Error('APP_PUBLIC_ORIGIN must be an HTTP(S) origin');
  }
  return (req, res, next) => {
    let authority;
    try {
      authority = new URL(`http://${req.get('host') || ''}`);
      if (
        authority.username ||
        authority.password ||
        authority.pathname !== '/' ||
        authority.search ||
        authority.hash
      )
        throw new Error('Invalid host');
    } catch {
      return res.status(403).json({ message: 'Host is not allowed' });
    }
    const allowed = configured
      ? authority.host === configured.host
      : ['localhost', '127.0.0.1', '[::1]'].includes(authority.hostname);
    if (!allowed) return res.status(403).json({ message: 'Host is not allowed' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const expected = configured?.origin || `${req.protocol}://${authority.host}`;
      if (
        req.get('sec-fetch-site') === 'cross-site' ||
        (req.get('origin') && req.get('origin') !== expected)
      )
        return res.status(403).json({ message: 'Cross-origin writes are not allowed' });
    }
    next();
  };
}
