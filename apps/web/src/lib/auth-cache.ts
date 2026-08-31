// apps/web/src/lib/auth-cache.ts
//
// Aturan murni invalidasi cache saat ganti viewer (P3): payload viewer-scoped
// (owner.isOwner, activeBid.isMine) tidak boleh dilayani ke user lain ketika
// OTP/magic-link login berganti akun di tab yang sama. Token REFRESH user yang
// sama tidak boleh meng-clear cache (menjaga UX), jadi keputusannya murni
// perbandingan id viewer sebelumnya vs baru.

/**
 * `previousUserId: undefined` berarti observasi pertama (initial session load)
 * — hanya mengisi tracker, bukan pergantian viewer, jadi tidak pernah clear.
 */
export function shouldClearCache(previousUserId: string | null | undefined, nextUserId: string | null): boolean {
  if (previousUserId === undefined) return false;
  return nextUserId != null && nextUserId !== previousUserId;
}
