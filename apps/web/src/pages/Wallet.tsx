import { BALANCE_CAP_CCOIN, GEMS_LOCK_HOURS, walletTxTypeLabel } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConfirm } from "../components/ConfirmProvider";
import { DompetVisual } from "../components/HeroVisuals";
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
  const nav = useNavigate();
  const [amount, setAmount] = useState(50);
  const [payoutAmt, setPayoutAmt] = useState(10);
  const [busyTopup, setBusyTopup] = useState(false);
  const [busyPayout, setBusyPayout] = useState(false);
  const [payoutConfirmOpen, setPayoutConfirmOpen] = useState(false); // P1-12 modal konfirmasi payout
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
    if (!(await confirm({ title: `Top-up ${amount} C?`, message: "Lanjut ke Midtrans untuk pembayaran.", confirmLabel: "Bayar" }))) return;
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
        push(`${err.message} — buka KYC sekarang`, "error");
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
      push("Permintaan payout dibuat — diproses batch mingguan", "success");
      setPayoutConfirmOpen(false);
      refetch();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.status === 403 && err.code === "KYC_REQUIRED") {
        push(`${err.message} — buka KYC sekarang`, "error");
        setPayoutConfirmOpen(false);
        nav("/me/kyc");
      } else if (err?.status === 400 && err.code === "MIN_PAYOUT") {
        push("Payout minimum 10 C-Gems", "error");
      } else if (err?.code === "PAYOUT_GEMS_LOCKED") {
        // Dual-token (docs/07): server sudah kirim copy Indonesia dengan angka jam dari shared.
        push(err.message, "error");
      } else if (err?.status === 402) {
        push("Saldo tidak cukup", "error");
      } else if (err?.status === 423) {
        push("Payout ditahan admin", "error");
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
      push("Konversi berhasil — C-Coin masuk ke saldo", "success");
      refetch();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.status === 400 && err.code === "INSUFFICIENT_GEMS") {
        push("Gems tidak cukup", "error");
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
      <PageHero heroVisual={<DompetVisual />} channel="08" channelLabel="DOMPET" title="Dompet" />

      {payoutHeld && (
        <div className="card card-pad wa-alert">
          <strong className="wa-alert-strong">Payout ditahan admin</strong>
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
            <span className="pill pill-success wa-pill-sm">Bisa dicair · {w.gemsMatured}</span>
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
              KYC terverifikasi — tanpa cap saldo.{" "}
              <a href="/me/kyc" className="wa-link">
                Lihat status KYC
              </a>
            </>
          ) : (
            <>
              Cap saldo non-KYC: <strong className="wa-note-strong">{topupCapNoKyc} C-Coin</strong> —{" "}
              <a href="/me/kyc" className="wa-link">
                selesaikan KYC
              </a>{" "}
              untuk tanpa cap.
            </>
          )}
        </div>
        <select className="select" aria-label="Jumlah top-up C-Coin" value={amount} onChange={(e) => setAmount(Number(e.target.value))}>
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
            <div className="wa-snap-token">{snapPanel.snapToken || "Token tidak tersedia"}</div>
            <div className="muted wa-sub">
              Selesaikan pembayaran, saldo masuk otomatis setelah webhook (kedaluwarsa {snapPanel.expiresLabel}).
            </div>
          </div>
        )}

        <div className="wa-divider" />

        {w.balanceGems > 0 && (
          <>
            <div className="wa-row-between">
              <span className="wa-row-title">Konversi ke C-Coin</span>
              <span className="wa-min-label">MAKS {w.balanceGems}</span>
            </div>
            <div className="wa-input-row">
              <input
                className="input wa-input-flex"
                type="number"
                min={1}
                value={convertAmt}
                onChange={(e) => setConvertAmt(Number(e.target.value))}
                aria-label="Jumlah konversi C-Gems"
                placeholder="Jumlah C-Gems"
              />
              <button
                className="btn-ghost"
                onClick={async () => {
                  // Pattern CreatorPage: integer >= 1 wajib — tolak desimal/Infinity.
                  if (!Number.isInteger(convertAmt) || convertAmt < 1) {
                    push("Minimal 1 Gems", "info");
                    return;
                  }
                  if (convertAmt > w.balanceGems) {
                    push("Gems tidak cukup", "info");
                    return;
                  }
                  // Konversi satu arah (docs/07) — irreversible, wajib konfirmasi.
                  if (
                    !(await confirm({
                      title: `Konversi ${convertAmt} Gems?`,
                      message: `Jadi ${convertAmt} C-Coin — satu arah, tidak dapat dibalik.`,
                      confirmLabel: "Konversi",
                    }))
                  )
                    return;
                  onConvert();
                }}
                disabled={busyConvert}
              >
                {busyConvert ? "Memproses…" : "Konversi"}
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
                push("Payout minimum 10 C-Gems", "info");
                return;
              }
              // Payout hanya dari Gems matured — lot terkunci tidak terhitung (docs/07).
              if (payoutAmt > w.gemsMatured) {
                push("Saldo bisa cair tidak cukup", "info");
                return;
              }
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
          onClick={() => !busyPayout && setPayoutConfirmOpen(false)}
        >
          <div className="card card-pad wa-modal" onClick={(e) => e.stopPropagation()}>
            <div id="payout-confirm-title" className="wa-modal-title">
              Konfirmasi Payout
            </div>
            <div className="wa-modal-rows">
              <div className="wa-modal-row">
                <span className="muted">Jumlah</span>
                <span className="wa-mono wa-strong">
                  {payoutAmt} C-Gems · {formatIdr(payoutAmt * rate)}
                </span>
              </div>
              <div className="wa-modal-row">
                <span className="muted">Saldo tersisa</span>
                <span className="wa-mono">{w.gemsMatured - payoutAmt} C-Gems</span>
              </div>
              <div className="muted wa-modal-note">Dana dikunci setelah konfirmasi — dicairkan batch mingguan (Selasa 06:00 WIB).</div>
            </div>
            <div className="wa-modal-actions">
              <button className="btn-ghost wa-btn-flex" onClick={() => setPayoutConfirmOpen(false)} disabled={busyPayout}>
                Batal
              </button>
              <button className="btn-gold wa-btn-flex" onClick={onPayout} disabled={busyPayout}>
                {busyPayout ? "Memproses…" : "Kunci Dana"}
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
