import { BALANCE_CAP_CCOIN, GEMS_LOCK_HOURS, PAYOUT_FEE_PCT, walletTxTypeLabel } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useConfirm } from "../components/ConfirmProvider";
import { LEGAL_CONSENTS, LegalConsentCheckbox } from "../components/LegalConsentCheckbox";
import { PageHero } from "../components/PageHero";
import { RequireAuth } from "../components/RequireAuth";
import { ApiError, api, formatIdr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ErrorState, LoadingState } from "../lib/QueryStates";
import { useToast } from "../lib/toast";
import "./wallet.css";

// Fallback terakhir untuk error tanpa code-map — jangan render teks server mentah.
const GENERIC_ERROR = "Terjadi kesalahan, coba lagi";
const LEDGER_PAGE_SIZE = 10; // paginasi riwayat — tampil per 10 terbaru

export default function Wallet() {
  return (
    <RequireAuth>
      <WalletInner />
    </RequireAuth>
  );
}

function WalletInner() {
  const { user } = useAuth();
  const { push } = useToast();
  const confirm = useConfirm();
  const location = useLocation();
  const nav = useNavigate();
  const returnTo =
    typeof location.state === "object" &&
    location.state != null &&
    "returnTo" in location.state &&
    typeof location.state.returnTo === "string" &&
    /^\/drops\/[^/?#]+$/.test(location.state.returnTo)
      ? location.state.returnTo
      : null;
  const [amount, setAmount] = useState(50);
  const [payoutAmt, setPayoutAmt] = useState(10);
  const payoutFeeGems = Math.ceil(payoutAmt * PAYOUT_FEE_PCT);
  const [busyTopup, setBusyTopup] = useState(false);
  const [busyPayout, setBusyPayout] = useState(false);
  const [payoutConfirmOpen, setPayoutConfirmOpen] = useState(false); // P1-12 modal konfirmasi payout
  const [payoutConsent, setPayoutConsent] = useState(false);
  const [convertAmt, setConvertAmt] = useState(1); // konversi Gems → C-Coin (docs/07)
  const [busyConvert, setBusyConvert] = useState(false);
  const [txPage, setTxPage] = useState(0); // halaman riwayat C-Coin
  const [gemPage, setGemPage] = useState(0); // halaman riwayat C-Gems
  // Midtrans Snap instruction untuk pembayaran yang tidak melempar redirect (fallback tampilkan token)
  const [snapPanel, setSnapPanel] = useState<{ snapToken: string; amountCcoin: number; expiresLabel: string } | null>(null);

  const { data, refetch, isLoading, isError } = useQuery({ queryKey: ["wallet"], queryFn: () => api.wallet(), enabled: !!user });
  const { data: kycData } = useQuery({ queryKey: ["kyc"], queryFn: () => api.kyc(), enabled: !!user });
  const kycApproved = kycData?.kyc?.status === "approved";
  // payout self-service untuk semua user — server yang enforce KYC + gems matured

  // Kembali dari Midtrans: ?order_id=...&status_code=... — saldo dikredit webhook, bukan redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("order_id")) return;
    push("Menunggu konfirmasi pembayaran — saldo masuk otomatis", "info");
    refetch();
    params.delete("order_id");
    params.delete("status_code");
    params.delete("transaction_status");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

  async function onTopup() {
    // Uang asli (IDR via Midtrans) — wajib konfirmasi sebelum redirect (founder 2026-08-29).
    if (
      !(await confirm({
        title: `Isi saldo ${amount} C?`,
        message: "Lanjut ke Midtrans untuk pembayaran.",
        confirmLabel: "Bayar",
        requireCheck: LEGAL_CONSENTS.topup,
      }))
    )
      return;
    setBusyTopup(true);
    try {
      const r = await api.topup(amount);
      if (r.redirectUrl) {
        window.location.href = r.redirectUrl;
        return;
      }
      setSnapPanel({
        snapToken: r.snapToken ?? "",
        amountCcoin: r.amountCcoin,
        expiresLabel: r.expiresInMinutes ? `${r.expiresInMinutes} menit` : "60 menit",
      });
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err && (err.status === 422 || err.code === "KYC_TOPUP_CAP")) {
        push(`${err.message} — buka verifikasi identitas`, "error");
        nav("/me/kyc");
      } else {
        console.error("top-up gagal", e);
        push(GENERIC_ERROR, "error");
      }
    } finally {
      setBusyTopup(false);
    }
  }
  async function onPayout() {
    setBusyPayout(true);
    try {
      await api.payout(payoutAmt);
      push("Permintaan penarikan dibuat — diproses mingguan", "success");
      setPayoutConfirmOpen(false);
      setPayoutConsent(false);
      refetch();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.status === 403 && err.code === "KYC_REQUIRED") {
        push(`${err.message} — buka verifikasi identitas`, "error");
        setPayoutConfirmOpen(false);
        setPayoutConsent(false);
        nav("/me/kyc");
      } else if (err?.status === 400 && err.code === "MIN_PAYOUT") {
        push("Penarikan minimum 10 C-Gems", "error");
      } else if (err?.code === "PAYOUT_GEMS_LOCKED") {
        // Dual-token (docs/07): server sudah kirim copy Indonesia dengan angka jam dari shared.
        push(err.message, "error");
      } else if (err?.status === 402) {
        push("Saldo tidak cukup", "error");
      } else if (err?.status === 423) {
        push("Penarikan ditahan admin", "error");
      } else {
        console.error("payout gagal", e);
        push(GENERIC_ERROR, "error");
      }
    } finally {
      setBusyPayout(false);
    }
  }

  async function onConvert() {
    setBusyConvert(true);
    try {
      await api.convertGems(convertAmt);
      push("Penukaran berhasil. C-Coin masuk ke saldo.", "success");
      refetch();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.status === 400 && err.code === "INSUFFICIENT_GEMS") {
        push("C-Gems tidak cukup", "error");
      } else {
        console.error("konversi gagal", e);
        push(GENERIC_ERROR, "error");
      }
    } finally {
      setBusyConvert(false);
    }
  }

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} label="Gagal memuat dompet" />;
  const w = data.wallet;
  const txs = data.transactions;
  const gemTxs = data.gemTxs;
  // Paginasi client-side — fetch tetap limit 100, tampil per halaman LEDGER_PAGE_SIZE.
  const txPageCount = Math.max(1, Math.ceil(txs.length / LEDGER_PAGE_SIZE));
  const gemPageCount = Math.max(1, Math.ceil(gemTxs.length / LEDGER_PAGE_SIZE));
  const txPageSafe = Math.min(txPage, txPageCount - 1);
  const gemPageSafe = Math.min(gemPage, gemPageCount - 1);
  const txRows = txs.slice(txPageSafe * LEDGER_PAGE_SIZE, (txPageSafe + 1) * LEDGER_PAGE_SIZE);
  const gemRows = gemTxs.slice(gemPageSafe * LEDGER_PAGE_SIZE, (gemPageSafe + 1) * LEDGER_PAGE_SIZE);
  const rate = data.rate;
  const topupCapNoKyc = data.topupCapNoKyc ?? BALANCE_CAP_CCOIN;
  const payoutHeld = data.payoutHeld ?? false;
  const payoutHoldUntil: string | null = data.payoutHoldUntil ?? null;
  return (
    <div className="page-stack">
      <PageHero
        channel="08"
        channelLabel="DOMPET"
        title="Dompet"
        actions={
          returnTo ? (
            <Link to={returnTo} className="btn-ghost" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
              ← Kembali ke drop
            </Link>
          ) : undefined
        }
      />

      {payoutHeld && (
        <div className="card card-pad wa-alert">
          <strong className="wa-alert-strong">Permintaan penarikan ditahan admin</strong>
          {payoutHoldUntil ? ` sampai ${new Date(payoutHoldUntil).toLocaleString("id-ID")}` : ""}.
        </div>
      )}

      <div className="grid-2">
        {/* C-Coin — saldo belanja (top-up; tidak dapat diuangkan) */}
        <div className="card card-pad wa-balance">
          <div className="label wa-label-gold">Saldo C-Coin</div>
          <div className="wa-balance-row">
            <span className="wa-balance-value">{w.balanceCCoin}</span>
            <span className="wa-balance-unit">C-Coin</span>
          </div>
          <hr className="wa-hr" />
          <div className="wa-balance-stats">
            <span className="wa-balance-stat">Total isi {w.totalTopupCCoin ?? 0} C</span>
            <span className="wa-balance-stat">Terpakai {w.totalSpentCCoin ?? 0} C</span>
          </div>
        </div>

        {/* C-Gems — saldo penghasilan (docs/07): hasil jual + Dukungan diterima */}
        <div className="card card-pad wa-balance">
          <div className="label wa-label-gold">Saldo C-Gems</div>
          <div className="wa-balance-row">
            <span className="wa-balance-value">{w.balanceGems}</span>
            <span className="wa-balance-unit">C-Gems</span>
          </div>
          <hr className="wa-hr" />
          <div className="wa-balance-stats">
            <span className="pill pill-success wa-pill-sm">Bisa dicairkan · {w.gemsMatured}</span>
            {w.gemsLocked > 0 && (
              <span className="pill pill-warn wa-pill-sm">
                Terkunci {GEMS_LOCK_HOURS} jam · {w.gemsLocked}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Actions — operate surface */}
      <div className="card card-pad wa-actions">
        <div>
          <div className="wa-block-title">Isi Saldo</div>
          <div className="muted wa-sub">Pilih metode dan nominal</div>
        </div>
        <div className="wa-note wa-note-gold">
          Saldo C-Coin <strong className="wa-note-strong">tidak dapat diuangkan</strong>.
        </div>
        <div className="wa-note wa-note-info">
          {kycApproved ? (
            <>
              Verifikasi identitas selesai. Batas pengisian sebelum verifikasi tidak berlaku.{" "}
              <a href="/me/kyc" className="wa-link">
                Lihat status verifikasi
              </a>
            </>
          ) : (
            <>
              Sebelum verifikasi, saldo setelah pengisian maksimal <strong className="wa-note-strong">{topupCapNoKyc} C-Coin</strong>.{" "}
              <a href="/me/kyc" className="wa-link">
                Selesaikan verifikasi
              </a>{" "}
              untuk meningkatkan batas pengisian. Batas penyedia pembayaran tetap berlaku.
            </>
          )}
        </div>
        <select className="select" aria-label="Jumlah isi saldo C-Coin" value={amount} onChange={(e) => setAmount(Number(e.target.value))}>
          {([10, 20, 30, 50, 100, 200, 500, 1000, 2000, 5000, 10000] as number[])
            .filter((v) => kycApproved || v <= BALANCE_CAP_CCOIN)
            .map((v) => (
              <option key={v} value={v}>
                {v} C · {formatIdr(v * rate)}
              </option>
            ))}
        </select>
        <button className="btn-gold wa-btn-block" onClick={onTopup} disabled={busyTopup}>
          {busyTopup ? "Memproses…" : `Isi ${amount} C →`}
        </button>
        {snapPanel && (
          <div className="wa-snap">
            <div className="wa-snap-title">Pembayaran Midtrans — {snapPanel.amountCcoin} C</div>

            <div className="muted wa-sub">
              Saldo masuk otomatis setelah pembayaran dikonfirmasi. Selesaikan pembayaran sebelum {snapPanel.expiresLabel}.
            </div>
          </div>
        )}

        <div className="wa-divider" />

        {w.balanceGems > 0 && (
          <>
            <div className="wa-row-between">
              <span className="wa-row-title">Tukar C-Gems ke C-Coin</span>
              <span className="wa-min-label">MAKS {w.balanceGems}</span>
            </div>
            <div className="wa-input-row">
              <input
                className="input wa-input-flex"
                type="number"
                min={1}
                value={convertAmt}
                onChange={(e) => setConvertAmt(Number(e.target.value))}
                aria-label="Jumlah C-Gems yang ditukar"
                placeholder="Jumlah C-Gems"
              />
              <button
                className="btn-ghost"
                onClick={async () => {
                  // Pattern CreatorPage: integer >= 1 wajib — tolak desimal/Infinity.
                  if (!Number.isInteger(convertAmt) || convertAmt < 1) {
                    push("Minimal 1 C-Gems", "info");
                    return;
                  }
                  if (convertAmt > w.balanceGems) {
                    push("C-Gems tidak cukup", "info");
                    return;
                  }
                  // Konversi satu arah (docs/07) — irreversible, wajib konfirmasi.
                  if (
                    !(await confirm({
                      title: `Tukar ${convertAmt} C-Gems ke C-Coin?`,
                      message: `Kamu akan mendapat ${convertAmt} C-Coin. Penukaran ini tidak bisa dibatalkan.`,
                      confirmLabel: "Tukar",
                      requireCheck: LEGAL_CONSENTS.conversion,
                    }))
                  )
                    return;
                  onConvert();
                }}
                disabled={busyConvert}
              >
                {busyConvert ? "Memproses…" : "Tukar"}
              </button>
            </div>
            <div className="wa-hint">1 C-Gems = 1 C-Coin</div>
            <div className="wa-divider" />
          </>
        )}

        <div className="wa-row-between">
          <span className="wa-row-title">Tarik ke Rekening</span>
          <span className="wa-min-label">MIN 10 C-Gems</span>
        </div>
        <div className="wa-input-row">
          <input
            className="input wa-input-flex"
            type="number"
            min={10}
            value={payoutAmt}
            onChange={(e) => setPayoutAmt(Number(e.target.value))}
            aria-label="Jumlah penarikan C-Gems"
            placeholder="Jumlah C-Gems"
          />
          <button
            className="btn-ghost"
            onClick={() => {
              // Pattern CreatorPage: integer >= 1 wajib — tolak desimal/Infinity.
              if (!Number.isInteger(payoutAmt) || payoutAmt < 10) {
                push("Penarikan minimum 10 C-Gems", "info");
                return;
              }
              // Payout hanya dari Gems matured — lot terkunci tidak terhitung (docs/07).
              if (payoutAmt > w.gemsMatured) {
                push("Saldo bisa cair tidak cukup", "info");
                return;
              }
              setPayoutConsent(false);
              setPayoutConfirmOpen(true);
            }}
            disabled={busyPayout}
          >
            {busyPayout ? "Memproses…" : "Tarik"}
          </button>
        </div>
        {w.gemsLocked > 0 && (
          <div className="wa-hint">
            {w.gemsLocked} C-Gems terkunci {GEMS_LOCK_HOURS} jam
          </div>
        )}
        <div className="wa-hint">Dana dikunci sampai batch mingguan · minimal 10 C-Gems</div>
      </div>

      {/* Ledger — monitor surface */}
      <div className="card">
        <div className="wa-toolbar">
          <span className="wa-toolbar-title">Riwayat</span>
          <button className="btn-ghost wa-refresh" onClick={() => refetch()}>
            Refresh
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Tipe</th>
                <th>Jumlah</th>
                <th>Saldo</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {txRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="wa-td-empty">
                    Belum ada transaksi
                  </td>
                </tr>
              ) : (
                txRows.map((t) => (
                  <tr key={t.id}>
                    <td className="wa-td-time">{new Date(t.createdAt).toLocaleString("id-ID")}</td>
                    <td>
                      <span
                        className={`pill ${t.type === "topup" || t.type === "top_up" ? "pill-success" : t.type === "checkout" ? "pill-warn" : t.type === "payout" ? "pill-info" : "pill-warn"} wa-pill-sm`}
                      >
                        {walletTxTypeLabel(t.type)}
                      </span>
                    </td>
                    <td className={`wa-td-amount ${t.amountCCoin > 0 ? "wa-td-pos" : "wa-td-neg"}`}>
                      {t.amountCCoin > 0 ? "+" : ""}
                      {t.amountCCoin} C
                    </td>
                    <td className="wa-td-balance">{t.balanceAfterCCoin} C</td>
                    <td className="wa-td-note" title={t.note ?? undefined}>
                      {t.note}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {txPageCount > 1 && <LedgerPager page={txPageSafe} pageCount={txPageCount} onPage={setTxPage} />}
      </div>

      {/* C-Gems ledger — penghasilan (kredit) & pemakaian (debit), docs/07 */}
      <div className="card">
        <div className="wa-toolbar">
          <span className="wa-toolbar-title">Riwayat C-Gems</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Tipe</th>
                <th>Jumlah</th>
                <th>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {gemRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="wa-td-empty">
                    Belum ada transaksi
                  </td>
                </tr>
              ) : (
                gemRows.map((t) => (
                  <tr key={`${t.createdAt}-${t.amount}-${t.balanceAfterGems}`}>
                    <td className="wa-td-time">{new Date(t.createdAt).toLocaleString("id-ID")}</td>
                    <td>
                      <span className={`pill ${t.amount > 0 ? "pill-success" : "pill-warn"} wa-pill-sm`}>
                        {walletTxTypeLabel(t.refType ?? "")}
                      </span>
                    </td>
                    <td className={`wa-td-amount ${t.amount > 0 ? "wa-td-pos" : "wa-td-neg"}`}>
                      {t.amount > 0 ? "+" : ""}
                      {t.amount} Gems
                    </td>
                    <td className="wa-td-balance">{t.balanceAfterGems} Gems</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {gemPageCount > 1 && <LedgerPager page={gemPageSafe} pageCount={gemPageCount} onPage={setGemPage} />}
      </div>

      {/* P1-12: Payout confirmation modal — tampilkan ringkasan sebelum kunci dana */}
      {payoutConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="payout-confirm-title"
          className="wa-modal-overlay"
          onClick={() => {
            if (!busyPayout) {
              setPayoutConfirmOpen(false);
              setPayoutConsent(false);
            }
          }}
        >
          <div className="card card-pad wa-modal" onClick={(e) => e.stopPropagation()}>
            <div id="payout-confirm-title" className="wa-modal-title">
              Konfirmasi penarikan
            </div>
            <div className="wa-modal-rows">
              <div className="wa-modal-row">
                <span className="muted">Jumlah</span>
                <span className="wa-mono wa-strong">
                  {payoutAmt} C-Gems · {formatIdr(payoutAmt * rate)}
                </span>
              </div>
              <div className="wa-modal-row">
                <span className="muted">Biaya penarikan (1%, dibulatkan ke atas)</span>
                <span className="wa-mono">{payoutFeeGems} C-Gems</span>
              </div>
              <div className="wa-modal-row">
                <span className="muted">Perkiraan diterima sebelum pajak</span>
                <span className="wa-mono wa-strong">{formatIdr((payoutAmt - payoutFeeGems) * rate)}</span>
              </div>
              <div className="wa-modal-row">
                <span className="muted">Saldo tersisa</span>
                <span className="wa-mono">{w.gemsMatured - payoutAmt} C-Gems</span>
              </div>
              <div className="muted wa-modal-note">
                C-Gems dikunci setelah konfirmasi. Penarikan ditargetkan diproses setiap Selasa yang merupakan hari kerja. Waktu penerimaan
                bergantung pada bank dan pemeriksaan transaksi.
              </div>
            </div>
            <LegalConsentCheckbox
              id="payout-legal-consent"
              consent={LEGAL_CONSENTS.payout}
              checked={payoutConsent}
              onChange={setPayoutConsent}
              autoFocus
            />
            <div className="wa-modal-actions">
              <button
                className="btn-ghost wa-btn-flex"
                onClick={() => {
                  setPayoutConfirmOpen(false);
                  setPayoutConsent(false);
                }}
                disabled={busyPayout}
              >
                Batal
              </button>
              <button className="btn-gold wa-btn-flex" onClick={onPayout} disabled={busyPayout || !payoutConsent}>
                {busyPayout ? "Memproses…" : "Ajukan penarikan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LedgerPager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (next: number) => void }) {
  return (
    <div className="wa-row-between">
      <button className="btn-ghost" onClick={() => onPage(page - 1)} disabled={page === 0}>
        ‹ Sebelumnya
      </button>
      <span className="muted wa-hint">
        Halaman {page + 1}/{pageCount}
      </span>
      <button className="btn-ghost" onClick={() => onPage(page + 1)} disabled={page >= pageCount - 1}>
        Berikutnya ›
      </button>
    </div>
  );
}
