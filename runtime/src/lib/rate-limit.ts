/**
 * Lightweight in-memory rate limiter.
 *
 * Per-IP sliding window. Survives a single Railway instance — for true
 * multi-instance limiting we'd front it with Redis/Upstash, but for the
 * launch-traffic profile (handfuls of formations per hour) this is fine.
 *
 * Bots that try to hammer /api/formations/create get a 429 after 5/min;
 * legitimate users never hit it.
 */

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

// Keep memory bounded — drop ~30% of buckets when we exceed this
const MAX_BUCKETS = 5_000

export interface RateLimitOptions {
  /** key uniquely identifies the caller (IP, user_id, etc.) */
  key: string
  /** max requests in the window */
  limit: number
  /** window length in seconds */
  windowSec: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetInSec: number
}

export function rateLimit(opts: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  const bucket = buckets.get(opts.key)

  if (!bucket || bucket.resetAt < now) {
    // New window
    if (buckets.size > MAX_BUCKETS) prune()
    buckets.set(opts.key, { count: 1, resetAt: now + opts.windowSec * 1000 })
    return { allowed: true, remaining: opts.limit - 1, resetInSec: opts.windowSec }
  }

  bucket.count += 1
  const remaining = Math.max(0, opts.limit - bucket.count)
  const resetInSec = Math.ceil((bucket.resetAt - now) / 1000)

  return {
    allowed: bucket.count <= opts.limit,
    remaining,
    resetInSec,
  }
}

function prune() {
  const now = Date.now()
  const entries = Array.from(buckets.entries())
  // Drop expired first
  for (const [k, b] of entries) {
    if (b.resetAt < now) buckets.delete(k)
  }
  // If still over, drop oldest ~30%
  if (buckets.size > MAX_BUCKETS) {
    const sorted = Array.from(buckets.entries()).sort((a, b) => a[1].resetAt - b[1].resetAt)
    const toDrop = Math.floor(sorted.length * 0.3)
    for (let i = 0; i < toDrop; i++) buckets.delete(sorted[i][0])
  }
}

/**
 * Pull the caller's IP from common proxy headers, falling back to a stub.
 * Works behind Cloudflare, Railway, and direct.
 */
export function clientIp(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-real-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}
