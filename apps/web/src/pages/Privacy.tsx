import { AVATAR_MAX_BYTES, PUBLIC_IMAGE_TYPES } from "@c-verse/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "../components/Avatar";
import { useConfirm } from "../components/ConfirmProvider";
import { PageHero } from "../components/PageHero";
import { RequireAuth } from "../components/RequireAuth";
import { api } from "../lib/api";
import type { ApiProfileResponse } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { ErrorState, LoadingState } from "../lib/QueryStates";
import { useToast } from "../lib/toast";
import "./account.css";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Sama seperti /home & /notifications: gate di dalam komponen halaman supaya
// query profil hanya jalan untuk user yang sudah terautentikasi.
export default function Privacy() {
  return (
    <RequireAuth>
      <PrivacyInner />
    </RequireAuth>
  );
}

function PrivacyInner() {
  const { push } = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { refresh } = useAuth();
  const { data, isLoading, isError, refetch } = useQuery<ApiProfileResponse>({
    queryKey: ["profile-privacy"],
    queryFn: () => api.profile(),
  });
  const [saving, setSaving] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarNotice, setAvatarNotice] = useState<{ message: string; kind: "error" | "success" } | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    },
    [avatarPreviewUrl],
  );
  // Loading/error eksplisit (pola QueryStates) — fetch gagal tidak boleh
  // terlihat seperti halaman kosong.
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={() => refetch()} label="Gagal memuat preferensi privasi" />;
  const user = data?.user;
  const isAnonymous = user?.isAnonymous ?? false;
  const ca = Boolean(user?.consentAnalyticsDetail);
  const cm = Boolean(user?.consentDataMarket);
  const avatarName = user?.displayName || user?.username || user?.email || "Profil";

  function clearAvatarSelection() {
    setAvatarFile(null);
    setAvatarPreviewUrl(null);
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  }

  function selectAvatar(file: File | undefined) {
    if (!file) return;
    if (!PUBLIC_IMAGE_TYPES.some((type) => type === file.type)) {
      clearAvatarSelection();
      setAvatarNotice({ message: "Gunakan gambar JPEG, PNG, atau WebP.", kind: "error" });
      push("Gunakan gambar JPEG, PNG, atau WebP.", "error");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      clearAvatarSelection();
      setAvatarNotice({ message: "Ukuran avatar maksimal 3 MiB.", kind: "error" });
      push("Ukuran avatar maksimal 3 MiB.", "error");
      return;
    }
    setAvatarFile(file);
    setAvatarPreviewUrl(URL.createObjectURL(file));
    setAvatarNotice(null);
  }

  async function saveAvatar() {
    if (!avatarFile) return;
    setSaving(true);
    try {
      const body = new FormData();
      body.append("file", avatarFile);
      await api.uploadAvatar(body);
      clearAvatarSelection();
      await Promise.all([
        refetch(),
        refresh(),
        queryClient.invalidateQueries({ queryKey: ["profile"] }),
        queryClient.invalidateQueries({ queryKey: ["public-profile"] }),
      ]);
      setAvatarNotice({ message: "Avatar publik diperbarui.", kind: "success" });
      push("Avatar publik diperbarui", "success");
    } catch (e: unknown) {
      setAvatarNotice({ message: errorMessage(e), kind: "error" });
      push(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function removeAvatar() {
    if (!user?.avatarUrl || saving) return;
    if (
      !(await confirm({
        title: "Hapus avatar publik?",
        message: "Avatar akan dihapus dari profil publik dan diganti inisial.",
        confirmLabel: "Hapus avatar",
        danger: true,
      }))
    )
      return;
    setSaving(true);
    try {
      await api.removeAvatar();
      await Promise.all([
        refetch(),
        refresh(),
        queryClient.invalidateQueries({ queryKey: ["profile"] }),
        queryClient.invalidateQueries({ queryKey: ["public-profile"] }),
      ]);
      setAvatarNotice({ message: "Avatar dihapus.", kind: "success" });
      push("Avatar dihapus", "success");
    } catch (e: unknown) {
      setAvatarNotice({ message: errorMessage(e), kind: "error" });
      push(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }
  async function toggle() {
    setSaving(true);
    try {
      await api.patchPrivacy(!isAnonymous);
      push(!isAnonymous ? "Profil disembunyikan" : "Profil ditampilkan", "success");
      refetch();
    } catch (e: unknown) {
      push(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }
  async function toggleConsent(kind: "analytics" | "market") {
    setSaving(true);
    try {
      if (kind === "analytics") await api.patchConsent({ consentAnalyticsDetail: !ca });
      else await api.patchConsent({ consentDataMarket: !cm });
      push("Preferensi disimpan", "success");
      refetch();
    } catch (e: unknown) {
      push(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="page-stack ac-narrow">
      <PageHero channel="12" channelLabel="PRIVASI" title="Privasi" desc="Kontrol visibilitas koleksi & izin data" />
      <div className="card card-pad">
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{isAnonymous ? "Disembunyikan" : "Ditampilkan"}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {isAnonymous ? "Koleksi tidak terlihat publik" : "Koleksi terlihat di profil publik"}
            </div>
          </div>
          <button
            className={isAnonymous ? "btn-ghost" : "btn-gold"}
            onClick={toggle}
            disabled={saving}
            style={{ padding: "10px 18px", fontFamily: "var(--font-mono)", fontSize: 12 }}
          >
            {saving ? "…" : isAnonymous ? "Tampilkan" : "Sembunyikan"}
          </button>
        </div>
      </div>
      <section className="card card-pad ac-avatar" aria-labelledby="avatar-heading">
        <div className="ac-avatar-preview" aria-live="polite">
          <Avatar src={avatarPreviewUrl ?? user?.avatarUrl} name={avatarName} className="ac-avatar-image" />
          <div>
            <h2 id="avatar-heading">Avatar profil</h2>
            <p className="muted">JPEG, PNG, atau WebP hingga 3 MiB.</p>
            <p className="ac-avatar-note">
              File avatar selalu dapat diakses melalui URL publik; mode anonim hanya menyembunyikannya dari profil. Jangan unggah dokumen
              pribadi.
            </p>
            <p className="muted">Mengganti atau menghapus avatar tidak dapat menarik salinan yang sudah diunduh pihak lain.</p>
          </div>
        </div>
        <input
          ref={avatarInputRef}
          id="profile-avatar"
          aria-label="File avatar profil"
          className="ac-file-input"
          type="file"
          accept={PUBLIC_IMAGE_TYPES.join(",")}
          onChange={(event) => selectAvatar(event.target.files?.[0])}
          disabled={saving}
        />
        <div className="ac-avatar-actions">
          <button type="button" className="btn-ghost" onClick={() => avatarInputRef.current?.click()} disabled={saving}>
            Pilih gambar
          </button>
          {avatarFile && (
            <button type="button" className="btn-gold" onClick={saveAvatar} disabled={saving}>
              {saving ? "Mengunggah…" : "Simpan avatar"}
            </button>
          )}
          {avatarFile && (
            <button type="button" className="btn-ghost" onClick={clearAvatarSelection} disabled={saving}>
              Batal
            </button>
          )}
          {user?.avatarUrl && !avatarFile && (
            <button type="button" className="btn-ghost ac-avatar-remove" onClick={removeAvatar} disabled={saving}>
              Hapus
            </button>
          )}
        </div>
        {avatarFile && (
          <div className="muted" style={{ fontSize: 11 }}>
            {avatarFile.name} · {Math.ceil(avatarFile.size / 1024)} KB
          </div>
        )}
        {saving && (
          <div className="ac-avatar-status" role="status">
            Menyimpan perubahan…
          </div>
        )}
        {avatarNotice && (
          <div
            className={`ac-avatar-status ac-avatar-status-${avatarNotice.kind}`}
            role={avatarNotice.kind === "error" ? "alert" : "status"}
          >
            {avatarNotice.message}
          </div>
        )}
      </section>
      <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Izin data (opsional)</div>
        <p className="muted" style={{ fontSize: 11 }}>
          Pengaturan consent ini opsional dan tidak memengaruhi kemampuan kolektor membeli/menjual. Kreator hanya menerima data agregat —
          data pribadi tidak pernah dibagikan.
        </p>
        <label className="ac-toggle">
          <input type="checkbox" checked={ca} onChange={() => toggleConsent("analytics")} disabled={saving} />
          <span className="ac-toggle-copy">
            <strong>Insight agregat ke kreator</strong>
            <div className="muted" style={{ fontSize: 11, lineHeight: 1.5, marginTop: 2 }}>
              Kreator dapat melihat statistik anonim (jumlah kunjungan halaman kreator, repeat rate). Tidak ada data identitas yang
              dibagikan.
            </div>
          </span>
        </label>
        <label className="ac-toggle">
          <input type="checkbox" checked={cm} onChange={() => toggleConsent("market")} disabled={saving} />
          <span className="ac-toggle-copy">
            <strong>Data agregat untuk laporan pasar</strong>
            <div className="muted" style={{ fontSize: 11, lineHeight: 1.5, marginTop: 2 }}>
              Setuju data kamu digunakan dalam laporan agregat (mis. rata-rata spending kolektor per kategori, tanpa identitas).
            </div>
          </span>
        </label>
      </div>
    </div>
  );
}
