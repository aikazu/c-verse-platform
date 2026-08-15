import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* Hero */}
      <div
        style={{
          background: "var(--gold-glow), linear-gradient(135deg, #0f0f0f 0%, #141414 55%, #0d0d12 100%)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-4)",
          padding: "48px 32px",
          display: "flex",
          gap: 36,
          alignItems: "center",
          flexWrap: "wrap",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div style={{ flex: "1 1 420px" }}>
          <span className="eyebrow">C.Verse — Creator Verse</span>
          <h1 className="h1" style={{ marginTop: 10 }}>
            Koleksi
            <br />
            <em>Kreator</em> Favoritmu
          </h1>
          <hr className="hr-gold" />
          <p className="muted" style={{ marginTop: 14, maxWidth: 500, fontSize: 14, lineHeight: 1.7 }}>
            Kartu edisi terbatas dalam acrylic premium. Setiap kartu terverifikasi lewat NFC.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 24, flexWrap: "wrap" }}>
            <Link
              to="/drops"
              className="btn-gold"
              style={{
                padding: "12px 24px",
                borderRadius: 99,
                fontWeight: 700,
                display: "inline-flex",
                textDecoration: "none",
                fontSize: 14,
              }}
            >
              Jelajahi Drops →
            </Link>
            <Link to="/marketplace" className="btn-ghost" style={{ padding: "12px 24px", display: "inline-flex", textDecoration: "none" }}>
              Marketplace
            </Link>
          </div>
        </div>
        <div style={{ flex: "0 0 280px", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 240 }}>
          <div
            style={{
              width: 168,
              height: 232,
              borderRadius: 14,
              background: "linear-gradient(145deg, #1a1a2a 0%, #1e1e30 50%, #16162a 100%)",
              border: "1px solid var(--border)",
              borderTop: "2px solid var(--gold)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              boxShadow: "0 20px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(201,163,82,0.08) inset",
            }}
          >
            <span style={{ fontSize: 52, filter: "drop-shadow(0 2px 8px rgba(201,163,82,0.2))" }}>🎴</span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--text-dim)",
              }}
            >
              C.Card · NFC Verified
            </span>
          </div>
        </div>
      </div>

      {/* 3 pillars — tighter, mono labels */}
      <div className="grid-3">
        {[
          { icon: "◈", label: "Fisik Premium", desc: "Acrylic hardcase 63×88 mm, holo — koleksi yang bisa dipegang." },
          { icon: "⬡", label: "Terverifikasi", desc: "Tap NFC untuk keaslian kartu." },
          { icon: "₵", label: "C-Coin", desc: "1 C-Coin = Rp 10.000. Transaksi simpel." },
        ].map((c) => (
          <div key={c.label} className="card card-pad" style={{ padding: "22px 20px" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "rgba(201,163,82,0.10)",
                border: "1px solid rgba(201,163,82,0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                color: "var(--gold)",
              }}
            >
              {c.icon}
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--text-dim)",
                marginTop: 14,
              }}
            >
              {c.label}
            </div>
            <div style={{ fontWeight: 600, marginTop: 4, fontSize: 14 }}>{c.label}</div>
            <div className="muted" style={{ marginTop: 6, fontSize: 13, lineHeight: 1.6 }}>
              {c.desc}
            </div>
          </div>
        ))}
      </div>

      {/* CTA strip */}
      <div
        className="card card-pad"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          background: "var(--surface-2)",
        }}
      >
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 500 }}>
            Mulai <em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>koleksimu</em>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            Drops terbaru dan koleksi kreator menantimu.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link to="/drops" className="btn-gold">
            Lihat Drops
          </Link>
          <Link to="/collection" className="btn-ghost">
            Koleksiku
          </Link>
        </div>
      </div>
    </div>
  );
}
