import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { RequireAuth } from "../components/RequireAuth";
import { api } from "../lib/api";
import type { ApiProfileResponse } from "../lib/api-types";
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
  const { data, isLoading, isError, refetch } = useQuery<ApiProfileResponse>({
    queryKey: ["profile-privacy"],
    queryFn: () => api.profile(),
  });
  const [saving, setSaving] = useState(false);
  // Loading/error eksplisit (pola QueryStates) — fetch gagal tidak boleh
  // terlihat seperti halaman kosong.
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={() => refetch()} label="Gagal memuat preferensi privasi" />;
  const user = data?.user;
  const isAnonymous = user?.isAnonymous ?? false;
  const ca = Boolean(user?.consentAnalyticsDetail);
  const cm = Boolean(user?.consentDataMarket);
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
      <section className="page-hero ac-hero" aria-label="Header halaman Privasi">
        <div className="page-hero-rail">
          <span className="rail-channel">CH:12 / PRIVASI</span>
          <span className="rail-dot" aria-hidden="true" />
          <span className="rail-sep">·</span>
          <span className="rail-extra">STEALTH PROTOCOL</span>
          <span className="rail-time" aria-label="Siap">
            <span className="rail-cursor" aria-hidden="true" />
          </span>
        </div>
        <div className="page-hero-inner">
          <div className="page-hero-copy">
            <h1 className="page-hero-title">Privasi</h1>
            <p className="page-hero-desc">Kontrol visibilitas koleksi &amp; izin data</p>
          </div>
        </div>
      </section>
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
