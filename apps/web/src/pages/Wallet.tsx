import { BALANCE_CAP_CCOIN, walletTxTypeLabel } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequireAuth } from "../components/RequireAuth";
import { ApiError, api, formatIdr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ErrorState, LoadingState } from "../lib/QueryStates";
import { useToast } from "../lib/toast";
import "./wallet.css";

const CHANNEL = "CH:08 / WALLET";
const CHANNEL_EXTRA = "TREASURY LINK";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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
  const nav = useNavigate();
  const [amount, setAmount] = useState(50);
  const [payoutAmt, setPayoutAmt] = useState(10);
  const [busyTopup, setBusyTopup] = useState(false);
  const [busyPayout, setBusyPayout] = useState(false);
  const [payoutConfirmOpen, setPayoutConfirmOpen] = useState(false); // P1-12 modal konfirmasi payout
  // Midtrans Snap instruction untuk pembayaran yang tidak melempar redirect (fallback tampilkan token)
  const [snapPanel, setSnapPanel] = useState<{ snapToken: string; amountCcoin: number; expiresLabel: string } | null>(null);

  const { data, refetch, isLoading, isError } = useQuery({ queryKey: ["wallet"], queryFn: () => api.wallet(), enabled: !!user });
  const { data: kycData } = useQuery({ queryKey: ["kyc"], queryFn: () => api.kyc(), enabled: !!user });
  const kycApproved = kycData?.kyc?.status === "approved";
  const isCreator = user?.role === "creator"; // payout self-service hanya untuk kreator

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
        push(errorMessage(e), "error");
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
        push("Payout minimum 10 C-Coin", "error");
      } else if (err?.status === 402) {
        push("Saldo tidak cukup", "error");
      } else if (err?.status === 423) {
        push("Payout ditahan admin", "error");
      } else {
        push(errorMessage(e), "error");
      }
    } finally {
      setBusyPayout(false);
    }
  }

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} label="Gagal memuat dompet" />;
  const w = data.wallet;
  const txs = data.transactions;
  const rate = data.rate;
  const topupCapNoKyc = data.topupCapNoKyc ?? BALANCE_CAP_CCOIN;
  const payoutHeld = data.payoutHeld ?? false;
  const payoutHoldUntil: string | null = data.payoutHoldUntil ?? null;
  return (
    <div className="page-stack">
      <section className="page-hero" aria-label="Header halaman Wallet">
        <div className="page-hero-rail">
          <span className="rail-channel">{CHANNEL}</span>
          <span className="rail-dot" aria-hidden="true" />
          <span className="rail-sep">·</span>
          <span className="rail-extra">{CHANNEL_EXTRA}</span>
          <span className="rail-time" aria-label="Siap">
            <span className="rail-cursor" aria-hidden="true" />
          </span>
        </div>
        <div className="page-hero-inner">
          <div className="page-hero-copy">
            <div className="page-hero-sub">Dompet</div>
            <h1 className="page-hero-title">
              C<em>-Coin</em>
            </h1>
            <p className="page-hero-desc">1 C = Rp 10.000</p>
          </div>
        </div>
      </section>

      {payoutHeld && (
        <div className="card card-pad wa-alert">
          <strong className="wa-alert-strong">Payout ditahan admin</strong>
          {payoutHoldUntil ? ` sampai ${new Date(payoutHoldUntil).toLocaleString("id-ID")}` : ""}.
        </div>
      )}

      <div className="grid-2">
        {/* Balance — spec-sheet style */}
        <div className="card card-pad wa-balance">
          <div className="label wa-label-gold">Saldo</div>
          <div className="wa-balance-row">
            <span className="wa-balance-value">{w.balanceCCoin}</span>
            <span className="wa-balance-unit">C-Coin</span>
          </div>
          <div className="wa-balance-idr">≈ {formatIdr(w.balanceIdrEquiv ?? w.balanceCCoin * rate)}</div>
          <hr className="wa-hr" />
          <div className="wa-balance-stats">
            <span className="wa-balance-stat">Total isi {w.totalTopupCCoin ?? 0} C</span>
            <span className="wa-balance-stat">Terpakai {w.totalSpentCCoin ?? 0} C</span>
          </div>
        </div>

        {/* Actions — operate surface */}
        <div className="card card-pad wa-actions">
          <div>
            <div className="wa-block-title">Isi Saldo</div>
            <div className="muted wa-sub">Pilih metode dan nominal — 1 C = Rp 10.000</div>
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

          {isCreator ? (
            <>
              <div className="wa-row-between">
                <span className="wa-row-title">Tarik ke Rekening</span>
                <span className="wa-min-label">MIN 10 C</span>
              </div>
              <div className="wa-input-row">
                <input
                  className="input wa-input-flex"
                  type="number"
                  min={10}
                  value={payoutAmt}
                  onChange={(e) => setPayoutAmt(Number(e.target.value))}
                  aria-label="Jumlah penarikan C-Coin"
                  placeholder="Jumlah C"
                />
                <button
                  className="btn-ghost"
                  onClick={() => {
                    if (payoutAmt < 10) {
                      push("Payout minimum 10 C-Coin", "info");
                      return;
                    }
                    if (payoutAmt > w.balanceCCoin) {
                      push("Saldo tidak cukup", "info");
                      return;
                    }
                    setPayoutConfirmOpen(true);
                  }}
                  disabled={busyPayout}
                >
                  {busyPayout ? "Memproses…" : "Tarik"}
                </button>
              </div>
              <div className="wa-hint">Dana dikunci sampai batch mingguan · minimal 10 C</div>
            </>
          ) : (
            <div className="muted wa-sub">Penarikan hanya untuk kreator — KYC wajib.</div>
          )}
        </div>
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
              {txs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="wa-td-empty">
                    Belum ada transaksi
                  </td>
                </tr>
              ) : (
                txs.map((t) => (
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
                  {payoutAmt} C · {formatIdr(payoutAmt * rate)}
                </span>
              </div>
              <div className="wa-modal-row">
                <span className="muted">Saldo tersisa</span>
                <span className="wa-mono">{w.balanceCCoin - payoutAmt} C</span>
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
