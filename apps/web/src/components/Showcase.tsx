import { PRIMARY_DOMAIN, type PublicShowcase, SHOWCASE_MAX_CARDS, type ShowcaseInput } from "@c-verse/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { ApiProfileResponse } from "../lib/api-types";
import { useToast } from "../lib/toast";
import { CardThumb } from "./CardThumb";
import "./showcase.css";

export function ShowcaseEditor({ profile }: { profile: ApiProfileResponse }) {
  const query = useQuery({ queryKey: ["my-showcase", profile.user.id], queryFn: api.myShowcase });
  if (query.isPending) return <p role="status">Memuat etalase…</p>;
  if (!query.data)
    return (
      <button className="btn-ghost" onClick={() => void query.refetch()}>
        Coba muat etalase lagi
      </button>
    );
  return <ShowcaseForm key={JSON.stringify(query.data)} profile={profile} initial={query.data} />;
}

function ShowcaseForm({ profile, initial }: { profile: ApiProfileResponse; initial: ShowcaseInput }) {
  const [title, setTitle] = useState(initial.title);
  const [cardIds, setCardIds] = useState(initial.cardIds.filter((id) => profile.cards.some((card) => card.id === id)));
  const client = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: api.saveShowcase,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["my-showcase"] });
      await client.invalidateQueries({ queryKey: ["showcase"] });
      toast.push("Etalase tersimpan", "success");
    },
  });
  return (
    <section className="card card-pad showcase" aria-label="Atur etalase koleksi">
      <header>
        <span className="label">ETALASE KOLEKSI</span>
        <h2 className="h2">Tiga kartu, ceritamu.</h2>
        <p>Pilih hingga {SHOWCASE_MAX_CARDS} kartu unggulan. Kartu yang berpindah pemilik otomatis dihapus dari pilihan.</p>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({ title, cardIds });
        }}
      >
        <label className="showcase-title">
          Judul etalase
          <input
            className="input"
            value={title}
            maxLength={80}
            required={cardIds.length > 0}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <fieldset disabled={save.isPending}>
          <legend>
            Kartu unggulan · {cardIds.length}/{SHOWCASE_MAX_CARDS}
          </legend>
          {profile.cards.length === 0 ? (
            <p>Etalase siap diisi setelah kamu memiliki C.Card.</p>
          ) : (
            <div className="showcase-picker">
              {profile.cards.map((card) => (
                <label key={card.id} className="showcase-choice">
                  <input
                    type="checkbox"
                    checked={cardIds.includes(card.id)}
                    disabled={!cardIds.includes(card.id) && cardIds.length >= SHOWCASE_MAX_CARDS}
                    onChange={(event) =>
                      setCardIds((ids) => (event.target.checked ? [...ids, card.id] : ids.filter((id) => id !== card.id)))
                    }
                  />
                  <span>
                    {card.drop?.title ?? "C.Card"} #{card.unitNumber} · {card.variant === "signed" ? "Signed" : "Reguler"}
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        {save.isError && <p role="alert">{save.error.message}</p>}
        <div className="showcase-actions">
          <button className="btn-gold" disabled={save.isPending}>
            {save.isPending ? "Menyimpan…" : "Simpan etalase"}
          </button>
          {profile.user.username && !profile.user.isAnonymous && (
            <Link className="btn-ghost" to={`/u/${profile.user.username}`}>
              Lihat & bagikan etalase →
            </Link>
          )}
        </div>
        {profile.user.isAnonymous && (
          <p>
            Profil kamu privat. Etalase tersimpan, tetapi tidak tampil atau dapat dibagikan ke publik.{" "}
            <Link to="/me/privacy">Atur privasi</Link>
          </p>
        )}
      </form>
    </section>
  );
}

export function Showcase({ username }: { username: string }) {
  const query = useQuery({ queryKey: ["showcase", username], queryFn: () => api.publicShowcase(username), staleTime: 0 });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const showcase = query.data?.showcase;
  if (!showcase?.cards.length) return null;
  const profileUrl = `https://${PRIMARY_DOMAIN}/u/${encodeURIComponent(showcase.username)}`;
  async function shareImage() {
    setBusy(true);
    try {
      // Re-read privacy and ownership before creating any new exported image.
      const { showcase: current } = await api.publicShowcase(username);
      if (!current?.cards.length) throw new Error("Etalase sudah berubah atau disembunyikan. Muat ulang profil.");
      const { createShowcaseImage } = await import("../lib/showcase-image");
      const file = await createShowcaseImage(current);
      const url = `https://${PRIMARY_DOMAIN}/u/${encodeURIComponent(current.username)}`;
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: current.title, text: `${current.title} — ${url}` });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          // Preparing artwork can outlive the browser's transient share permission.
          // Keep the finished image available through the download fallback.
        }
      }
      const objectUrl = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = file.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      toast.push("Gambar etalase diunduh. Tautan profil tercantum pada gambar.", "success");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        toast.push(error instanceof Error ? error.message : "Gagal membagikan etalase", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card card-pad showcase" aria-label="Etalase koleksi">
      <header>
        <span className="label">PILIHAN KOLEKTOR</span>
        <h2 className="h2">{showcase.title}</h2>
      </header>
      <ShowcaseCards showcase={showcase} />
      <div className="showcase-actions">
        <button className="btn-gold" disabled={busy} onClick={() => void shareImage()}>
          {busy ? "Menyiapkan gambar…" : "Bagikan gambar etalase"}
        </button>
        <button
          className="btn-ghost"
          onClick={() =>
            void navigator.clipboard
              .writeText(profileUrl)
              .then(() => toast.push("Tautan disalin", "success"))
              .catch(() => toast.push("Tautan belum dapat disalin", "error"))
          }
        >
          Salin tautan
        </button>
      </div>
    </section>
  );
}

function ShowcaseCards({ showcase }: { showcase: PublicShowcase }) {
  return (
    <div className="showcase-grid">
      {showcase.cards.map((card, index) => (
        <Link key={card.id} className="showcase-card" to={`/cards/${card.shortId}`}>
          <div className="showcase-art">
            <CardThumb artworkUrl={card.artworkUrl} title={card.title} />
            <span className="pill pill-warn">0{index + 1}</span>
          </div>
          <h3>{card.title}</h3>
          <span className="mono">
            #{card.unitNumber} · {card.variant === "signed" ? "Signed" : "Reguler"}
          </span>
        </Link>
      ))}
    </div>
  );
}
