# scripts/ci-api-env.sh
#
# Bangun apps/api/.dev.vars dari output `supabase status -o env` agar job
# e2e CI tidak menaruh placeholder value ke runtime. Workaround untuk
# problem audit 2026-08-25 (GAP 5): CI lama melakukan `cp .env.example
# .dev.vars` yang menyalin placeholder kosong (NFC_MASTER_KEY="",
# SUPABASE_SERVICE_ROLE_KEY="your-...-here") — bila ada route yang butuh
# master key (verify-nfc) atau service-role (RPC admin), e2e akan merah
# dengan pesan keliru (auth/network) bukan deterministik.
#
# Cara pakai dari .github/workflows/ci.yml:
#   npx supabase start
#   ./scripts/ci-api-env.sh . > apps/api/.dev.vars
#   cd apps/api && (pnpm dev:node || pnpm dev) &
#
# Format output `supabase status -o env` (key=value per baris).

set -euo pipefail

OUT="${1:-.}"  # path file tujuan; default "." artinya stdout

# Ambil status, format env. Field yang relevan: API URL, anon key, service
# role key. Field DB URL/URL_DIFF tidak dipakai API — supabase-js cukup
# dengan URL + service-role key untuk melewati RLS & SECURITY DEFINER.
STATUS_ENV="$(npx supabase status -o env 2>/dev/null || true)"

# Beberapa versi CLI menulis key dengan nama berbeda; normalisasi via grep.
API_URL="$(printf '%s\n' "$STATUS_ENV" | grep -E '^API_URL=' | head -n1 | cut -d= -f2-)"
ANON_KEY="$(printf '%s\n' "$STATUS_ENV" | grep -E '^ANON_KEY=' | head -n1 | cut -d= -f2-)"
SERVICE_ROLE_KEY="$(printf '%s\n' "$STATUS_ENV" | grep -E '^SERVICE_ROLE_KEY=' | head -n1 | cut -d= -f2-)"

if [[ -z "$API_URL" || -z "$ANON_KEY" || -z "$SERVICE_ROLE_KEY" ]]; then
  echo "::error::gagal baca supabase status (URL='$API_URL' anon=${#ANON_KEY} service=${#SERVICE_ROLE_KEY}) — pastikan 'npx supabase start' sudah jalan" >&2
  exit 1
fi

# Tulis env dengan format yang dipahami wrangler dev / dotenv (KEY=VALUE
# per baris, komentar Opsional). Hanya field WAJIB untuk e2e dasar — tests
# yang butuh NFC_MASTER_KEY/MIDTRANS_* lewati (e2e setup menandai test
# tersebut @skip jika env kosong).
cat <<EOF > "$OUT"
ENV=development
SUPABASE_URL=$API_URL
SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
EMAIL_ENABLED=false
EOF

echo "Wrote $OUT with values from supabase status (length anon=${#ANON_KEY} service=${#SERVICE_ROLE_KEY})" >&2
