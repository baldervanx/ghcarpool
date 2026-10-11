import express from 'express';
import { statSync } from 'node:fs';
import path from 'node:path';

const defaultDirectory = path.resolve(__dirname, '../../../frontend/dist');

function safePath(urlPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (decoded.split('/').some(segment => segment.startsWith('.'))) return undefined;
  return decoded;
}

export function frontendMiddleware(directory = defaultDirectory): express.Router {
  const index = path.resolve(directory, 'index.html');
  if (!statSync(index).isFile()) {
    throw new Error(`Frontend index is not a file: ${index}`);
  }

  const router = express.Router();
  // Reserved namespaces must never be served from disk, even if files exist.
  router.use((req, _res, next) => {
    const urlPath = safePath(req.path);
    if (!['GET', 'HEAD'].includes(req.method)
        || !urlPath || /^\/(?:api|health)(?:\/|$)/i.test(urlPath)) {
      return next('router');
    }
    next();
  });
  router.use(express.static(directory, {
    index: false,
    redirect: false,
    dotfiles: 'ignore',
    setHeaders(res, file) {
      const relative = path.relative(directory, file);
      res.setHeader('Cache-Control', relative.startsWith(`assets${path.sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache');
    },
  }));
  router.get('*', (req, res, next) => {
    const urlPath = safePath(req.path);
    if (!urlPath || !/\btext\/html\b/i.test(req.get('Accept') ?? '')
        || !req.accepts('html') || path.posix.extname(urlPath)
        || /^\/assets(?:\/|$)/i.test(urlPath)) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  return router;
}
