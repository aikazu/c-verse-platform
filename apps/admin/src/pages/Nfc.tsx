import { useEffect, useState } from "react";
import { useConfirm } from "../components/ConfirmProvider";
import { StatusBadge } from "../components/StatusBadge";
import { apiFetch } from "../lib/api";
import { supabase } from "../lib/supabase";
import type { CardRow, NfcBatchRow } from "../lib/types";
import { errMessage } from "../lib/utils";

type SeedPendingRow = CardRow & {
  status: string;
  location: string;
  drop_id: string;
  drops: { is_seed: boolean };
};

export function NfcPage() {
  const confirm = useConfirm();
  const [batches, setBatches] = useState<NfcBatchRow[]>([]);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [seedPending, setSeedPending] = useState<SeedPendingRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const { data: b, error: bErr } = await supabase
      .from("nfc_batches")
      .select("id,batch_code,qty,status")
      .order("created_at", { ascending: false });
    setBatches((b ?? []) as NfcBatchRow[]);
    const { data: c, error: cErr } = await supabase
      .from("cards")
      .select("id,nfc_uid,nfc_short_id,verify_status,nfc_configured,qc_status")
      .limit(50);
    setCards((c ?? []) as CardRow[]);
    // Stuck seed PHASE-1 sales (bid_pending cards from seed drops) — admin
    // can release (PHASE-2) atau abort (PHASE-1 refund) dari sini.
    const { data: sp, error: spErr } = await supabase
      .from("cards")
      .select("id,nfc_uid,nfc_short_id,verify_status,status,location,drop_id,drops!inner(is_seed)")
      .eq("status", "bid_pending")
      .eq("drops.is_seed", true)
      .order("created_at", { ascending: false })
      .limit(50);
    setSeedPending((sp ?? []) as unknown as SeedPendingRow[]);
    const err = bErr ?? cErr ?? spErr;
    if (err) setMsg(err.message);
  }
  useEffect(() => {
    load();
  }, []);

  async function abortSeedSale(cardId: string) {
    if (
      !(await confirm({
        title: `Batalkan PHASE-1 seed sale untuk C.Card ${cardId}?`,
        message: "Buyer akan di-refund penuh.",
        confirmLabel: "Batalkan",
        danger: true,
      }))
    )
      return;
    setMsg(null);
    setBusyId(cardId);
    try {
      await apiFetch(`/api/admin/cards/${cardId}/cancel-seed-sale`, { method: "POST" });
      load();
    } catch (err) {
      setMsg(errMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>NFC</h2>
        <p className="muted">Pantau batch dan verifikasi C.Card (read-only — provisioning via backend)</p>
      </div>
      {msg && (
        <div className="admin-msg" role="status" aria-live="polite">
          {msg}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-ghost" onClick={load}>
          Refresh
        </button>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="admin-table-head">Batch — {batches.length}</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {batches.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="empty-state">
                      Belum ada batch
                    </td>
                  </tr>
                ) : (
                  batches.map((b) => (
                    <tr key={b.id}>
                      <td className="mono fs-11">{b.batch_code}</td>
                      <td>{b.qty}</td>
                      <td>
                        <StatusBadge status={b.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="admin-table-head">C.Card — sampel 50</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>UID</th>
                  <th>QC</th>
                  <th>Verifikasi</th>
                </tr>
              </thead>
              <tbody>
                {cards.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-state">
                      Belum ada data
                    </td>
                  </tr>
                ) : (
                  cards.map((c) => (
                    <tr key={c.id}>
                      <td className="mono fs-11">{c.nfc_short_id}</td>
                      <td className="mono fs-11">{(c.nfc_uid ?? "").slice(0, 12)}</td>
                      <td>{c.qc_status ? <StatusBadge status={c.qc_status} /> : <span className="pill">—</span>}</td>
                      <td>{c.verify_status ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="admin-table-head">Seed sale berjalan (PHASE-1) — {seedPending.length}</div>
        <p className="muted fs-11" style={{ marginTop: 4 }}>
          C.Card seed dalam status <code>bid_pending</code> menunggu vault-in + NFC verified sebelum release. Jika stuck (C.Card
          hilang/dispute), gunakan &quot;Batalkan sale&quot; untuk refund penuh ke buyer.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>UID</th>
                <th>Lokasi</th>
                <th>Verifikasi</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {seedPending.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-state">
                    Tidak ada seed sale yang sedang berjalan
                  </td>
                </tr>
              ) : (
                seedPending.map((c) => (
                  <tr key={c.id}>
                    <td className="mono fs-11">{c.nfc_short_id}</td>
                    <td className="mono fs-11">{(c.nfc_uid ?? "").slice(0, 12)}</td>
                    <td>
                      <StatusBadge status={c.location} />
                    </td>
                    <td>{c.verify_status ?? "—"}</td>
                    <td>
                      <button className="btn-ghost admin-mini" onClick={() => abortSeedSale(c.id)} disabled={busyId === c.id}>
                        Batalkan sale
                      </button>
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
