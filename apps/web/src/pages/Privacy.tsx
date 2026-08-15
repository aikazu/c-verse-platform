import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";

export default function Privacy() {
  const { push } = useToast();
  const { data, refetch } = useQuery({ queryKey: ["profile-privacy"], queryFn: () => api.profile() });
  const isAnonymous = (data as any)?.user?.isAnonymous ?? false;
  const ca = Boolean((data as any)?.user?.consentAnalyticsDetail ?? (data as any)?.consentAnalyticsDetail);
  const cm = Boolean((data as any)?.user?.consentDataMarket ?? (data as any)?.consentDataMarket);
  const [saving, setSaving] = useState(false);
  async function toggle() {
    setSaving(true);
    try {
      await api.patchPrivacy(!isAnonymous);
      push(!isAnonymous ? "Profil disembunyikan" : "Profil ditampilkan", "success");
      refetch();
    } catch (e: any) {
      push(e.message, "error");
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
    } catch (e: any) {
      push(e.message, "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <span className="eyebrow">Privasi</span>
        <h1 className="h2" style={{ marginTop: 4 }}>
          Privasi
        </h1>
        <p className="muted" style={{ marginTop: 6 }}>
          Kontrol visibilitas koleksi & izin data
        </p>
      </div>
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
          Framework consent dibangun sejak awal (docs 09 3.4). Kreator hanya melihat data agregat/anonim bila kamu izinkan.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={ca} onChange={() => toggleConsent("analytics")} disabled={saving} /> Izinkan kreator lihat insight
          anonim (visitor anonim, repeat rate) —{" "}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>consent_analytics_detail</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={cm} onChange={() => toggleConsent("market")} disabled={saving} /> Izinkan data agregat untuk
          laporan pasar —{" "}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>consent_data_market</span>
        </label>
      </div>
    </div>
  );
}
