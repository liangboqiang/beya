import * as path from 'node:path'
import { isAllowedFilesystemPath } from './filesystem.js'
import { serveFileWithRange } from './previewFs.js'
import { normalizeDriveRootPathForPlatform } from '../services/windowsDrivePath.js'

const PREFIX = '/files/local/'

/**
 * Reconstruct the absolute filesystem path encoded in a `/files/local/...`
 * request pathname.
 *
 * The request path *after* the `/files/local/` prefix IS the target's absolute
 * path with its leading separator dropped by the prefix slice. We URL-decode
 * each segment (so spaces / unicode names survive) and re-add the root:
 *
 *   - POSIX: `Users/me/page.html`     → `/Users/me/page.html`
 *   - Windows drive: `C:/me/page.html` → `C:/me/page.html` (already rooted)
 *   - Windows drive (with leading `/`, e.g. from `file:///C:/...`):
 *       `C:/me/page.html` arrives the same way once the prefix is sliced.
 *
 * The WHATWG URL parser collapses `..` segments before this handler runs, so a
 * traversal such as `/files/local/../../etc/passwd` arrives with its pathname
 * normalized to `/etc/passwd` — i.e. the `/files/local/` prefix is gone. We
 * treat any request that lost the prefix as a sandbox escape (handled by the
 * caller returning 403); here we only reconstruct, the sandbox check is the
 * `isAllowedFilesystemPath` gate in {@link handleLocalFile}.
 *
 * Returns `null` when the remainder is empty.
 */
export function reconstructAbsolutePath(rest: string): string | null {
  if (!rest) return null

  const decoded = rest
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join('/')

  if (!decoded) return null

  // Windows drive form: `C:/...` or `C:\...` is already absolute.
  if (/^[a-zA-Z]:[\\/]/.test(decoded) || /^[a-zA-Z]:$/.test(decoded)) {
    return decoded
  }

  // POSIX: the leading `/` was consumed by the `/files/local/` prefix slice.
  return `/${decoded}`
}

/**
 * Serve a single ABSOLUTE local file by path so `file://` links and AI-emitted
 * absolute paths can open in the in-app browser.
 *
 * URL shape: `/files/local/<absolute-path>` where the path after the prefix is
 * the on-disk absolute path (its leading separator dropped by the prefix, or a
 * `C:/...` drive form on Windows). This is PATH-based, not query-param based,
 * so relative asset URLs (`./app.css`, `img/logo.png`) inside served HTML
 * resolve against the same `/files/local/...` directory.
 *
 * Security: the resolved path is gated by {@link isAllowedFilesystemPath} — the
 * same `$HOME` / `/tmp` / `/private/tmp` / registered-roots allow-list used by
 * the filesystem image endpoint. Anything outside is rejected with 403, so
 * `/etc/passwd` and friends stay denied. Streaming + byte-range handling is
 * shared with `/files/preview` via {@link serveFileWithRange}, so HTML, CSS, JS,
 * images, fonts, video, and text all serve with the correct `Content-Type`,
 * `Accept-Ranges`, and 206 partial responses.
 */
export async function handleLocalFile(
  url: URL,
  reqHeaders?: Headers,
): Promise<Response> {
  if (!url.pathname.startsWith(PREFIX)) {
    return new Response('forbidden', { status: 403 })
  }

  const rest = url.pathname.slice(PREFIX.length)
  const absPath = reconstructAbsolutePath(rest)
  if (!absPath) return new Response('bad request', { status: 400 })

  const resolved = path.resolve(normalizeDriveRootPathForPlatform(absPath))

  if (!isAllowedFilesystemPath(resolved)) {
    return new Response('forbidden', { status: 403 })
  }

  return serveFileWithRange(resolved, reqHeaders)
}
