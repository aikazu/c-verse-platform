import { type EditorialDocument, type EditorialKind, type EditorialState, emptyEditorialDocument } from "@c-verse/shared";
import { useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "../lib/api";
import { useConfirm } from "./ConfirmProvider";
import "./editorial-editor.css";

type SaveAction = "draft" | "publish" | "unpublish";
type SaveResponse = { revision: number };
interface EditorialEditorProps {
  dropId: string;
  kind?: EditorialKind;
  onClose: () => void;
}

function cloneDocument(document: EditorialDocument): EditorialDocument {
  return { ...document, media: document.media.map((item) => ({ ...item })) };
}
function documentKey(document: EditorialDocument): string {
  return JSON.stringify(document);
}

export function EditorialEditor({ dropId, kind = "story", onClose }: EditorialEditorProps) {
  const confirm = useConfirm();
  const baseline = useRef(documentKey(emptyEditorialDocument()));
  const [document, setDocument] = useState<EditorialDocument>(emptyEditorialDocument);
  const [mediaKeys, setMediaKeys] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [published, setPublished] = useState<EditorialDocument | null>(null);
  const [cards, setCards] = useState<EditorialState["cards"]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = baseline.current !== documentKey(document);
  const isCampaign = kind === "seed_campaign";
  const title = isCampaign ? "Campaign Creator Seed" : "Cerita C.Card";
  const endpoint = `/api/drops/${encodeURIComponent(dropId)}/editorial/${kind}`;

  async function reload(options: { preserveMessage?: boolean } = {}) {
    setLoading(true);
    setLoadFailed(false);
    setConflict(false);
    if (!options.preserveMessage) setMessage(null);
    try {
      const state = await apiFetch<EditorialState>(endpoint);
      const next = cloneDocument(state.draft);
      baseline.current = documentKey(next);
      setDocument(next);
      setMediaKeys(next.media.map(() => crypto.randomUUID()));
      setRevision(state.revision);
      setPublished(state.published ? cloneDocument(state.published) : null);
      setCards(state.cards);
    } catch (error) {
      setLoadFailed(true);
      setMessage(error instanceof Error ? error.message : "Konten tidak dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, [dropId, kind]);
  function patchDocument(patch: Partial<EditorialDocument>) {
    setDocument((current) => ({ ...current, ...patch }));
  }
  function patchMedia(index: number, patch: Partial<EditorialDocument["media"][number]>) {
    setDocument((current) => ({ ...current, media: current.media.map((item, i) => (i === index ? { ...item, ...patch } : item)) }));
  }
  function addMedia() {
    setMediaKeys((keys) => [...keys, crypto.randomUUID()]);
    setDocument((current) => ({ ...current, media: [...current.media, { type: "image", url: "", caption: "" }] }));
  }
  function removeMedia(index: number) {
    setMediaKeys((keys) => keys.filter((_, position) => position !== index));
    setDocument((current) => ({ ...current, media: current.media.filter((_, i) => i !== index) }));
  }

  async function save(action: SaveAction) {
    if (action === "publish" && (!document.title.trim() || !document.body.trim())) {
      setMessage("Judul dan isi wajib sebelum dipublikasikan.");
      return;
    }
    if (
      action === "publish" &&
      isCampaign &&
      (!document.cardId || !document.making.trim() || !document.signing.trim() || !document.handover.trim())
    ) {
      setMessage("Pilih kartu dan lengkapi proses pembuatan, signing, serta handover sebelum publikasi.");
      return;
    }
    if (action !== "draft") {
      const accepted = await confirm({
        title: action === "publish" ? `Publikasikan ${title}?` : `Batalkan publikasi ${title}?`,
        message:
          action === "publish"
            ? "Versi draft saat ini akan tampil publik."
            : "Konten publik disembunyikan, sementara draft kerja tetap tersimpan.",
        confirmLabel: action === "publish" ? "Publikasikan" : "Batalkan publikasi",
        danger: action === "unpublish",
      });
      if (!accepted) return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await apiFetch<SaveResponse>(endpoint, { method: "PUT", body: JSON.stringify({ document, action, revision }) });
      setRevision(response.revision);
      baseline.current = documentKey(document);
      setMessage(action === "draft" ? "Draft disimpan." : action === "publish" ? "Konten dipublikasikan." : "Publikasi dibatalkan.");
      await reload({ preserveMessage: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
        setMessage("Konten berubah di sesi lain. Muat ulang sebelum menyimpan agar perubahan tidak tertimpa.");
      } else setMessage(error instanceof Error ? error.message : "Konten tidak dapat disimpan.");
    } finally {
      setSaving(false);
    }
  }
  async function close() {
    if (dirty) {
      const accepted = await confirm({
        title: "Tutup tanpa menyimpan draft?",
        message: "Perubahan di editor ini belum tersimpan.",
        confirmLabel: "Tutup tanpa menyimpan",
        danger: true,
      });
      if (!accepted) return;
    }
    onClose();
  }

  return (
    <section className="card card-pad editorial-editor" aria-labelledby="editorial-editor-title">
      <div className="editorial-editor-head">
        <div>
          <p className="editorial-kicker">EDITORIAL DROP</p>
          <h3 id="editorial-editor-title">{title}</h3>
          <p className="muted">Draft hanya terlihat di admin. Publikasikan saat konten siap tampil di halaman Drop.</p>
        </div>
        <button type="button" className="btn-ghost admin-mini" onClick={() => void close()} disabled={saving}>
          Tutup
        </button>
      </div>
      {!loading && !loadFailed && (
        <p className="muted editorial-publication">Status publik: {published ? "sudah dipublikasikan" : "belum dipublikasikan"}.</p>
      )}
      {loading ? (
        <p className="muted">Memuat konten…</p>
      ) : loadFailed ? (
        <button type="button" className="btn-ghost admin-mini" onClick={() => void reload()}>
          Coba muat lagi
        </button>
      ) : (
        <div className="editorial-fields">
          <label className="label" htmlFor="editorial-title">
            Judul
          </label>
          <input
            id="editorial-title"
            className="input"
            maxLength={120}
            value={document.title}
            onChange={(event) => patchDocument({ title: event.target.value })}
            disabled={saving}
          />
          <label className="label" htmlFor="editorial-body">
            Isi
          </label>
          <textarea
            id="editorial-body"
            className="input editorial-body"
            rows={8}
            maxLength={8000}
            value={document.body}
            onChange={(event) => patchDocument({ body: event.target.value })}
            disabled={saving}
          />
          {isCampaign && (
            <>
              <label className="label" htmlFor="editorial-card">
                Kartu Creator Seed
              </label>
              <select
                id="editorial-card"
                className="input"
                value={document.cardId ?? ""}
                onChange={(event) => patchDocument({ cardId: event.target.value || null })}
                disabled={saving}
              >
                <option value="">Pilih kartu terkait</option>
                {cards.map((card) => (
                  <option key={card.id} value={card.id}>
                    #{card.unitNumber} · {card.shortId}
                  </option>
                ))}
              </select>
            </>
          )}
          <div className="editorial-media-head">
            <div>
              <span className="label">Media opsional</span>
              <p className="muted">Media disediakan melalui tautan HTTPS.</p>
            </div>
            <button type="button" className="btn-ghost admin-mini" onClick={addMedia} disabled={saving || document.media.length >= 6}>
              + Tambah media
            </button>
          </div>
          {document.media.map((item, index) => (
            <fieldset className="editorial-media-row" key={mediaKeys[index]}>
              <legend>Media {index + 1}</legend>
              <label className="label" htmlFor={`editorial-media-type-${index}`}>
                Jenis
              </label>
              <select
                id={`editorial-media-type-${index}`}
                className="input"
                value={item.type}
                onChange={(event) => patchMedia(index, { type: event.target.value as "image" | "video" })}
                disabled={saving}
              >
                <option value="image">Gambar</option>
                <option value="video">Video</option>
              </select>
              <label className="label" htmlFor={`editorial-media-url-${index}`}>
                URL HTTPS
              </label>
              <input
                id={`editorial-media-url-${index}`}
                className="input"
                type="url"
                placeholder="https://…"
                maxLength={2048}
                value={item.url}
                onChange={(event) => patchMedia(index, { url: event.target.value })}
                disabled={saving}
              />
              <label className="label" htmlFor={`editorial-media-caption-${index}`}>
                Keterangan
              </label>
              <input
                id={`editorial-media-caption-${index}`}
                className="input"
                maxLength={240}
                value={item.caption}
                onChange={(event) => patchMedia(index, { caption: event.target.value })}
                disabled={saving}
              />
              <button type="button" className="btn-ghost admin-mini" onClick={() => removeMedia(index)} disabled={saving}>
                Hapus media
              </button>
            </fieldset>
          ))}
          {isCampaign && (
            <>
              <label className="label" htmlFor="editorial-making">
                Proses pembuatan
              </label>
              <textarea
                id="editorial-making"
                className="input editorial-body"
                rows={4}
                maxLength={4000}
                value={document.making}
                onChange={(event) => patchDocument({ making: event.target.value })}
                disabled={saving}
              />
              <label className="label" htmlFor="editorial-signing">
                Signing
              </label>
              <textarea
                id="editorial-signing"
                className="input editorial-body"
                rows={4}
                maxLength={4000}
                value={document.signing}
                onChange={(event) => patchDocument({ signing: event.target.value })}
                disabled={saving}
              />
              <label className="label" htmlFor="editorial-handover">
                Handover
              </label>
              <textarea
                id="editorial-handover"
                className="input editorial-body"
                rows={4}
                maxLength={4000}
                value={document.handover}
                onChange={(event) => patchDocument({ handover: event.target.value })}
                disabled={saving}
              />
            </>
          )}
        </div>
      )}
      {message && (
        <div className="admin-msg editorial-message" role={conflict ? "alert" : "status"}>
          {message}
        </div>
      )}
      {conflict && (
        <button type="button" className="btn-ghost admin-mini" onClick={() => void reload()} disabled={loading || saving}>
          Muat ulang konten
        </button>
      )}
      {!loading && !loadFailed && (
        <div className="editorial-actions">
          <button type="button" className="btn-ghost admin-mini" onClick={() => void save("draft")} disabled={saving || conflict}>
            {saving ? "Menyimpan…" : "Simpan Draft"}
          </button>
          <button type="button" className="btn-gold admin-mini" onClick={() => void save("publish")} disabled={saving || conflict}>
            Publikasikan
          </button>
          <button type="button" className="btn-ghost admin-mini" onClick={() => void save("unpublish")} disabled={saving || conflict}>
            Batalkan Publikasi
          </button>
        </div>
      )}
    </section>
  );
}
