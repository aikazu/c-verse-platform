import { BALANCE_CAP_CCOIN, walletTxTypeLabel } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequireAuth } from "../components/RequireAuth";
import { ApiError, api, formatIdr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ErrorState, LoadingState } from "../lib/QueryStates";
import { useToast } from "../lib/toast";

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
      refetch();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.status === 403 && err.code === "KYC_REQUIRED") {
        push(`${err.message} — buka KYC sekarang`, "error");
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
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <span className="eyebrow">Dompet</span>
        <h1 className="h2" style={{ marginTop: 4 }}>
          C<em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>-Coin</em>
        </h1>
        <p className="muted" style={{ marginTop: 4 }}>
          1 C = Rp 10.000
        </p>
      </div>

      {payoutHeld && (
        <div
          className="card card-pad"
          style={{
            background: "var(--alert-bg)",
            border: "1px solid var(--alert-border)",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <strong style={{ color: "var(--alert)" }}>Payout ditahan admin</strong>
          {payoutHoldUntil ? ` sampai ${new Date(payoutHoldUntil).toLocaleString("id-ID")}` : ""}.
        </div>
      )}

      <div className="grid-2">
        {/* Balance — spec-sheet style */}
        <div className="card card-pad" style={{ background: "var(--surface-2)", padding: 24 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--gold)",
            }}
          >
            Saldo
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 10 }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 44, fontWeight: 500, letterSpacing: "-0.02em" }}>
              {w.balanceCCoin}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>C-Coin</span>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
            ≈ {formatIdr(w.balanceIdrEquiv ?? w.balanceCCoin * rate)}
          </div>
          <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "16px 0 0" }} />
          <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
              Total isi {w.totalTopupCCoin ?? 0} C
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
              Terpakai {w.totalSpentCCoin ?? 0} C
            </span>
          </div>
        </div>

        {/* Actions — operate surface */}
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Isi Saldo</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              Pilih metode dan nominal — 1 C = Rp 10.000 (Opsi A closed-loop)
            </div>
          </div>
          <div
            style={{
              background: "var(--gold-bg-soft)",
              border: "1px solid var(--gold-border)",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 11,
              lineHeight: 1.5,
              color: "var(--text-muted)",
            }}
          >
            Saldo <strong style={{ color: "var(--text)" }}>tidak dapat diuangkan</strong> (Gamified Point — Opsi A). Refund hanya reversal
            ke metode asal atau penutupan akun bersaldo ke top-up terakhir.
            <br />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>Isi saldo = kamu setuju T&C C-Coin.</span>
          </div>
          <div
            style={{
              background: "var(--info-bg)",
              border: "1px solid var(--info-border)",
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 11,
              lineHeight: 1.5,
              color: "var(--text-muted)",
            }}
          >
            {kycApproved ? (
              <>
                KYC terverifikasi — tanpa cap saldo.{" "}
                <a href="/me/kyc" style={{ color: "var(--gold)", fontWeight: 600 }}>
                  Lihat status KYC
                </a>
              </>
            ) : (
              <>
                Cap saldo non-KYC: <strong style={{ color: "var(--text)" }}>{topupCapNoKyc} C-Coin</strong> —{" "}
                <a href="/me/kyc" style={{ color: "var(--gold)", fontWeight: 600 }}>
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
          <button className="btn-gold" onClick={onTopup} disabled={busyTopup} style={{ padding: "11px", width: "100%" }}>
            {busyTopup ? "Memproses…" : `Isi ${amount} C →`}
          </button>
          {snapPanel && (
            <div
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 12 }}>Pembayaran Midtrans — {snapPanel.amountCcoin} C</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, wordBreak: "break-all", color: "var(--gold)" }}>
                {snapPanel.snapToken || "Token tidak tersedia"}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                Selesaikan pembayaran, saldo masuk otomatis setelah webhook (kedaluwarsa {snapPanel.expiresLabel}).
              </div>
            </div>
          )}

          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />

          {isCreator ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>Tarik ke Rekening</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.06em" }}>
                  MIN 10 C
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  type="number"
                  min={10}
                  value={payoutAmt}
                  onChange={(e) => setPayoutAmt(Number(e.target.value))}
                  style={{ flex: 1 }}
                  aria-label="Jumlah penarikan C-Coin"
                  placeholder="Jumlah C"
                />
                <button className="btn-ghost" onClick={onPayout} disabled={busyPayout}>
                  {busyPayout ? "Memproses…" : "Tarik"}
                </button>
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
                Dana dikunci sampai batch mingguan · minimal 10 C
              </div>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 11 }}>
              Penarikan hanya untuk kreator (hasil penjualan) — KYC wajib.
            </div>
          )}
        </div>
      </div>

      {/* Ledger — monitor surface */}
      <div className="card">
        <div
          style={{
            padding: "14px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 13 }}>Riwayat</span>
          <button
            className="btn-ghost"
            style={{ padding: "5px 12px", fontSize: 11, fontFamily: "var(--font-mono)" }}
            onClick={() => refetch()}
          >
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
                  <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: 24, fontSize: 13 }}>
                    Belum ada transaksi
                  </td>
                </tr>
              ) : (
                txs.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                      {new Date(t.createdAt).toLocaleString("id-ID")}
                    </td>
                    <td>
                      <span
                        className={`pill ${t.type === "topup" || t.type === "top_up" ? "pill-success" : t.type === "checkout" ? "pill-warn" : t.type === "payout" ? "pill-info" : "pill-warn"}`}
                        style={{ fontSize: 10 }}
                      >
                        {walletTxTypeLabel(t.type)}
                      </span>
                    </td>
                    <td
                      style={{
                        fontWeight: 700,
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: t.amountCCoin > 0 ? "var(--signal)" : "var(--alert)",
                      }}
                    >
                      {t.amountCCoin > 0 ? "+" : ""}
                      {t.amountCCoin} C
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{t.balanceAfterCCoin} C</td>
                    <td
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        maxWidth: 220,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={t.note ?? undefined}
                    >
                      {t.note}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
