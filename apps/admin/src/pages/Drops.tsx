import { ARTWORK_MAX_BYTES, PUBLIC_IMAGE_TYPES } from "@c-verse/shared";
import { useEffect, useRef, useState } from "react";
import { useConfirm } from "../components/ConfirmProvider";
import { EditorialEditor } from "../components/EditorialEditor";
import { StatusBadge } from "../components/StatusBadge";
import { apiFetch } from "../lib/api";
import type { DropRow } from "../lib/types";
import { errMessage } from "../lib/utils";

type QueuedArtwork = { dropId: string; file: File };
type ArtworkEditor = { dropId: string; status: string; currentUrl: string | null; file: File | null; previewUrl: string | null };
type ActiveCreator = { user_id: string; handle: string | null; users: { display_name: string | null } | null };

function imageError(file: File): string | null {
  if (!PUBLIC_IMAGE_TYPES.some((type) => type === file.type)) return "Gunakan gambar JPEG, PNG, atau WebP.";
  if (file.size > ARTWORK_MAX_BYTES) return "Ukuran artwork maksimal 10 MB.";
  return null;
}

function ArtworkPreview({ src, alt }: { src: string | null; alt: string }) {
  return src ? (
    <img src={src} alt={alt} style={{ width: 96, height: 96, objectFit: "contain", borderRadius: 8, border: "1px solid var(--border)" }} />
  ) : null;
}

export function DropsPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<DropRow[]>([]);
  const [creators, setCreators] = useState<ActiveCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    creatorId: "",
    title: "",
    series: "",
    narrative: "",
    totalUnits: 15,
    priceCcoin: 30,
    dropStartAt: "",
  });
  const [createArtwork, setCreateArtwork] = useState<{ file: File; previewUrl: string } | null>(null);
  const [pendingArtwork, setPendingArtwork] = useState<QueuedArtwork | null>(null);
  const [artworkEditor, setArtworkEditor] = useState<ArtworkEditor | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editorial, setEditorial] = useState<{ dropId: string; kind: "story" | "seed_campaign" } | null>(null);
  const createArtworkRef = useRef<HTMLInputElement>(null);
  const editArtworkRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (createArtwork) URL.revokeObjectURL(createArtwork.previewUrl);
    },
    [createArtwork],
  );
  useEffect(
    () => () => {
      if (artworkEditor?.previewUrl) URL.revokeObjectURL(artworkEditor.previewUrl);
    },
    [artworkEditor?.previewUrl],
  );

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await apiFetch<{ drops: DropRow[]; activeCreators: ActiveCreator[] }>("/api/admin/drops");
      setRows(result.drops);
      setCreators(result.activeCreators);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function uploadArtwork(dropId: string, file: File) {
    const body = new FormData();
    body.append("file", file);
    return apiFetch<{ artworkUrl: string }>(`/api/drops/${encodeURIComponent(dropId)}/artwork`, { method: "POST", body });
  }

  function selectCreateArtwork(file: File | undefined) {
    if (!file) return;
    const problem = imageError(file);
    if (problem) {
      setCreateArtwork(null);
      setMsg(problem);
      if (createArtworkRef.current) createArtworkRef.current.value = "";
      return;
    }
    setCreateArtwork({ file, previewUrl: URL.createObjectURL(file) });
  }

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    setMsg(null);
    setCreating(true);
    try {
      // A drop is created exactly once; a failed upload retries this id instead of cloning drafts.
      const result = await apiFetch<{ drop: { id: string } }>("/api/drops", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          series: form.series,
          narrative: form.narrative,
          creatorId: form.creatorId,
          totalUnits: Number(form.totalUnits),
          priceCcoin: Number(form.priceCcoin),
          ...(form.dropStartAt ? { dropStartAt: new Date(form.dropStartAt).toISOString() } : {}),
        }),
      });
      const createdId = result.drop.id;
      setForm({ creatorId: "", title: "", series: "", narrative: "", totalUnits: 15, priceCcoin: 30, dropStartAt: "" });
      if (!createArtwork) {
        setMsg("Drop dibuat (draft) — artwork dapat diunggah dari daftar di bawah.");
        await load();
        return;
      }
      setUploading(true);
      try {
        await uploadArtwork(createdId, createArtwork.file);
        setCreateArtwork(null);
        if (createArtworkRef.current) createArtworkRef.current.value = "";
        setMsg("Draft dan artwork berhasil dibuat.");
      } catch (error) {
        setPendingArtwork({ dropId: createdId, file: createArtwork.file });
        setCreateArtwork(null);
        setMsg(`Draft berhasil dibuat, tetapi artwork belum terunggah: ${errMessage(error)}`);
      } finally {
        setUploading(false);
      }
      await load();
    } catch (error) {
      setMsg(errMessage(error));
    } finally {
      setCreating(false);
    }
  }

  async function retryPendingArtwork() {
    if (!pendingArtwork || uploading) return;
    setUploading(true);
    setMsg(null);
    try {
      await uploadArtwork(pendingArtwork.dropId, pendingArtwork.file);
      setPendingArtwork(null);
      setMsg("Artwork berhasil diunggah ke draft yang sama.");
      await load();
    } catch (error) {
      setMsg(`Artwork belum terunggah: ${errMessage(error)}`);
    } finally {
      setUploading(false);
    }
  }

  async function discardPendingArtwork() {
    if (!pendingArtwork || uploading) return;
    if (
      !(await confirm({
        title: "Lanjutkan draft tanpa artwork?",
        message: "Draft tetap tersimpan, tetapi belum memiliki artwork yang kamu pilih. Kamu dapat menggantinya dari daftar drop nanti.",
        confirmLabel: "Lanjutkan tanpa artwork",
      }))
    )
      return;
    setPendingArtwork(null);
    setMsg("Draft disimpan tanpa artwork. Upload dapat dilakukan dari daftar drop.");
  }

  function selectEditedArtwork(file: File | undefined) {
    if (!file || !artworkEditor) return;
    const problem = imageError(file);
    if (problem) {
      setMsg(problem);
      setArtworkEditor({ ...artworkEditor, file: null, previewUrl: null });
      if (editArtworkRef.current) editArtworkRef.current.value = "";
      return;
    }
    setArtworkEditor({ ...artworkEditor, file, previewUrl: URL.createObjectURL(file) });
  }

  async function saveEditedArtwork() {
    if (!artworkEditor?.file || uploading) return;
    const needsConfirm = artworkEditor.status !== "draft" && artworkEditor.status !== "cancelled";
    if (
      needsConfirm &&
      !(await confirm({
        title: "Ganti artwork drop yang sudah tayang?",
        message: "Artwork ini dipakai seluruh kartu drop ini dan langsung mengubah tampilan kartu publik.",
        confirmLabel: "Ganti artwork",
        danger: true,
      }))
    )
      return;
    setUploading(true);
    setMsg(null);
    try {
      await uploadArtwork(artworkEditor.dropId, artworkEditor.file);
      setArtworkEditor(null);
      if (editArtworkRef.current) editArtworkRef.current.value = "";
      setMsg("Artwork drop diperbarui.");
      await load();
    } catch (error) {
      setMsg(errMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function setStatus(id: string, status: string) {
    const labels: Record<string, string> = { published: "publish", live: "jadikan live", closed: "tutup" };
    if (
      !(await confirm({
        title: `Ubah status drop menjadi "${status}" (${labels[status] ?? status})?`,
        confirmLabel: "Ubah",
        danger: status === "closed",
      }))
    )
      return;
    setMsg(null);
    setBusy(true);
    try {
      await apiFetch(`/api/drops/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (error) {
      setMsg(errMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function draw(id: string) {
    if (
      !(await confirm({
        title: "Jalankan draw undian sekarang?",
        message: "Pemenang ditentukan permanen dan tidak bisa diulang.",
        confirmLabel: "Jalankan Draw",
        danger: true,
      }))
    )
      return;
    setMsg(null);
    setBusy(true);
    try {
      const { winners } = await apiFetch<{ winners: number }>(`/api/drops/${id}/draw`, { method: "POST" });
      setMsg(`Draw selesai — ${winners} pemenang`);
      await load();
    } catch (error) {
      setMsg(errMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Drops</h2>
        <p className="muted">Kelola koleksi dan jadwal rilis</p>
      </div>
      <form onSubmit={onCreate} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Buat Drop</div>
        <label className="label" htmlFor="drop-creator">
          Kreator
        </label>
        <select
          id="drop-creator"
          className="input"
          value={form.creatorId}
          onChange={(e) => setForm((state) => ({ ...state, creatorId: e.target.value }))}
          required
        >
          <option value="">Pilih kreator aktif</option>
          {creators.map((creator) => (
            <option key={creator.user_id} value={creator.user_id}>
              {creator.users?.display_name ?? creator.handle ?? creator.user_id}
              {creator.handle ? ` · @${creator.handle}` : ""}
            </option>
          ))}
        </select>
        <label className="label" htmlFor="drop-title">
          Judul
        </label>
        <input
          id="drop-title"
          className="input"
          placeholder="Judul"
          value={form.title}
          onChange={(e) => setForm((state) => ({ ...state, title: e.target.value }))}
          required
        />
        <label className="label" htmlFor="drop-series">
          Seri
        </label>
        <input
          id="drop-series"
          className="input"
          placeholder="Seri"
          value={form.series}
          onChange={(e) => setForm((state) => ({ ...state, series: e.target.value }))}
          required
        />
        <label className="label" htmlFor="drop-narrative">
          Deskripsi
        </label>
        <textarea
          id="drop-narrative"
          className="input"
          placeholder="Deskripsi (min. 10 karakter)"
          value={form.narrative}
          onChange={(e) => setForm((state) => ({ ...state, narrative: e.target.value }))}
          required
          minLength={10}
          rows={2}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label className="label" htmlFor="drop-artwork">
              Artwork publik
            </label>
            <input
              ref={createArtworkRef}
              id="drop-artwork"
              className="input"
              type="file"
              accept={PUBLIC_IMAGE_TYPES.join(",")}
              onChange={(e) => selectCreateArtwork(e.target.files?.[0])}
              disabled={creating || uploading}
            />
          </div>
          <div style={{ width: 120 }}>
            <label className="label" htmlFor="drop-units">
              Total unit
            </label>
            <input
              id="drop-units"
              className="input"
              type="number"
              min={1}
              max={1000}
              value={form.totalUnits}
              onChange={(e) => setForm((state) => ({ ...state, totalUnits: Number(e.target.value) }))}
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ width: 120 }}>
            <label className="label" htmlFor="drop-price">
              Harga (C)
            </label>
            <input
              id="drop-price"
              className="input"
              type="number"
              min={1}
              value={form.priceCcoin}
              onChange={(e) => setForm((state) => ({ ...state, priceCcoin: Number(e.target.value) }))}
              style={{ width: "100%" }}
            />
          </div>
        </div>
        {createArtwork && <ArtworkPreview src={createArtwork.previewUrl} alt="Pratinjau artwork baru" />}
        <p className="muted" style={{ margin: 0, fontSize: 11 }}>
          JPEG, PNG, atau WebP hingga 10 MB. Artwork publik — jangan unggah dokumen KYC. File dipakai sebagai tekstur kartu 3D; siapkan
          layout atlas utuh, bukan hasil crop.
        </p>
        <label className="label" htmlFor="drop-start">
          Waktu rilis (opsional)
        </label>
        <input
          id="drop-start"
          className="input"
          type="datetime-local"
          value={form.dropStartAt}
          onChange={(e) => setForm((state) => ({ ...state, dropStartAt: e.target.value }))}
        />
        <button className="btn-gold" style={{ alignSelf: "start" }} disabled={creating || uploading || !!pendingArtwork || !form.creatorId}>
          {creating ? "Membuat…" : uploading ? "Mengunggah…" : "Buat Draft"}
        </button>
        {pendingArtwork && (
          <div className="flex-gap-6 flex-wrap">
            <button type="button" className="btn-ghost" onClick={() => void retryPendingArtwork()} disabled={uploading}>
              Coba upload artwork draft lagi
            </button>
            <button type="button" className="btn-ghost" onClick={() => void discardPendingArtwork()} disabled={uploading}>
              Lanjutkan tanpa artwork
            </button>
          </div>
        )}
        {msg && (
          <div className="admin-msg" role="status" aria-live="polite">
            {msg}
          </div>
        )}
      </form>
      {artworkEditor && (
        <section
          className="card card-pad"
          aria-labelledby="edit-artwork-title"
          style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div id="edit-artwork-title" style={{ fontWeight: 700, fontSize: 13 }}>
            Ubah artwork drop
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <ArtworkPreview src={artworkEditor.currentUrl} alt="Artwork saat ini" />
            <ArtworkPreview src={artworkEditor.previewUrl} alt="Pratinjau artwork pengganti" />
          </div>
          <label className="label" htmlFor="replace-drop-artwork">
            File artwork pengganti
          </label>
          <input
            ref={editArtworkRef}
            id="replace-drop-artwork"
            className="input"
            type="file"
            accept={PUBLIC_IMAGE_TYPES.join(",")}
            onChange={(e) => selectEditedArtwork(e.target.files?.[0])}
            disabled={uploading}
          />
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>
            Artwork publik, bukan dokumen KYC. Gunakan atlas kartu utuh untuk tekstur 3D; jangan crop tiap varian.
          </p>
          <div className="flex-gap-6 flex-wrap">
            <button
              type="button"
              className="btn-gold admin-mini"
              onClick={() => void saveEditedArtwork()}
              disabled={!artworkEditor.file || uploading}
            >
              {uploading ? "Mengunggah…" : "Simpan artwork"}
            </button>
            <button type="button" className="btn-ghost admin-mini" onClick={() => setArtworkEditor(null)} disabled={uploading}>
              Batal
            </button>
          </div>
        </section>
      )}
      {editorial && <EditorialEditor dropId={editorial.dropId} kind={editorial.kind} onClose={() => setEditorial(null)} />}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="admin-table-head">Daftar — {rows.length}</div>
        {loading ? (
          <div style={{ padding: 20 }} className="muted">
            Memuat…
          </div>
        ) : loadError ? (
          <div className="admin-msg" role="alert" aria-live="polite" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>Gagal memuat data drops — periksa koneksi lalu coba lagi.</span>
            <button className="btn-ghost admin-mini" onClick={() => void load()}>
              Coba Lagi
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Judul</th>
                  <th>Status</th>
                  <th>Unit</th>
                  <th>Harga</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-state">
                      Belum ada data
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ fontWeight: 700, fontSize: 12 }}>{row.title}</td>
                      <td>
                        <StatusBadge status={row.status} kind="drop" />
                        {row.drawn_at ? (
                          <span className="pill" style={{ marginLeft: 4 }}>
                            drawn
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {row.sold_count ?? 0}/{row.total_units}
                      </td>
                      <td>{row.price_ccoin ?? row.price_unsigned_ccoin ?? "—"} C</td>
                      <td className="flex-gap-6 flex-wrap">
                        <button
                          className="btn-ghost admin-mini"
                          onClick={() =>
                            setArtworkEditor({
                              dropId: row.id,
                              status: row.status,
                              currentUrl: row.artwork_url,
                              file: null,
                              previewUrl: null,
                            })
                          }
                          disabled={uploading}
                        >
                          Ganti artwork
                        </button>
                        <button
                          className="btn-ghost admin-mini"
                          onClick={() => setEditorial({ dropId: row.id, kind: "story" })}
                          disabled={busy || uploading || editorial !== null}
                        >
                          Cerita C.Card
                        </button>
                        {row.is_seed && (
                          <button
                            className="btn-ghost admin-mini"
                            onClick={() => setEditorial({ dropId: row.id, kind: "seed_campaign" })}
                            disabled={busy || uploading || editorial !== null}
                          >
                            Campaign
                          </button>
                        )}
                        <button className="btn-ghost admin-mini" onClick={() => void setStatus(row.id, "published")} disabled={busy}>
                          Publish
                        </button>
                        <button className="btn-ghost admin-mini" onClick={() => void setStatus(row.id, "live")} disabled={busy}>
                          Live
                        </button>
                        <button className="btn-ghost admin-mini" onClick={() => void setStatus(row.id, "closed")} disabled={busy}>
                          Tutup
                        </button>
                        {row.raffle_end_at && !row.drawn_at && (
                          <button className="btn-gold admin-mini" onClick={() => void draw(row.id)} disabled={busy}>
                            Draw
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
