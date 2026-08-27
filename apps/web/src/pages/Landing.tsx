import { Link } from "react-router-dom";

const TICKER_ITEMS = [
  "NEW DROP SETIAP MINGGU",
  "EDISI TERBATAS DARI KREATOR FAVORIT",
  "KEASLIAN TERVERIFIKASI NFC",
  "1 C-COIN = RP 10.000",
  "1 C.CARD PER USER PER DROP",
  "JUAL & BID DI MARKETPLACE",
];

// Terminology consistency: marketing copy boleh "C.CARD" all-caps pada hero
// (brand emblem); prosa UI lain konsisten "C.Card" per docs/00_readme.md §6.

const STEPS = [
  {
    num: "01",
    title: "PILIH DROP",
    desc: "Masuk ke drop kreator favoritmu dan amankan C.Card edisi terbatas. Satu C.Card per user per drop — begitu habis, tidak ada cetak ulang.",
  },
  {
    num: "02",
    title: "TAP NFC",
    desc: "Sentuh C.Card-mu ke ponsel — keasliannya diverifikasi lewat NFC dalam hitungan detik. Bukan C.Card asli? Tidak akan lolos.",
  },
  {
    num: "03",
    title: "TRADE & LEVEL UP",
    desc: "Pasang buyout di Marketplace atau bid langsung di Browse. Setiap 1 C-Coin belanja = 1 XP — naik level, buka badge baru.",
  },
];

const POWER_UPS = [
  {
    icon: "⬡",
    label: "POWER-UP 1",
    title: "FISIK PREMIUM",
    desc: "Bukan sekadar merch. C.Card hadir dalam acrylic 63×88 mm dengan efek holo — bisa dipegang, dipajang, dan dipamerkan.",
  },
  {
    icon: "◈",
    label: "POWER-UP 2",
    title: "NFC VERIFIED",
    desc: "Satu tap ke ponsel, dan C.Card-mu terkonfirmasi asli — instan, di mana saja, tanpa aplikasi tambahan.",
  },
  {
    icon: "₵",
    label: "POWER-UP 3",
    title: "C-COIN",
    desc: "1 C-Coin = Rp 10.000 — angka bulat, tanpa desimal. Top-up, beli drop, dan trade semuanya lewat satu mata uang.",
  },
];

export default function Landing() {
  return (
    <div className="landing">
      {/* Coin-slot ticker */}
      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          {[0, 1].map((pass) => (
            <span key={pass}>
              {TICKER_ITEMS.map((item) => (
                <span key={`${pass}-${item}`}>★ {item}&nbsp;&nbsp;&nbsp;</span>
              ))}
            </span>
          ))}
        </div>
      </div>

      {/* HERO — attract mode */}
      <section className="hero">
        <div className="hero-stars" />
        <div className="hero-stars-2" />
        <div className="hero-grid-floor" />
        <div className="hero-inner">
          <div className="hero-copy">
            <span className="hero-tag">Perkenalkan C.Card</span>
            <h1 className="hero-title">
              C<span className="dot">.</span>VERSE
            </h1>
            <p className="hero-sub">Hasil kolaborasi kreator — dicetak terbatas, dibuat untuk dikoleksi</p>
            <p className="hero-desc">
              Setiap C.Card tercetak dalam jumlah terbatas bersama kreatornya — acrylic premium dengan efek holo yang enak dipajang. Sentuh
              ke ponsel, keasliannya langsung terverifikasi lewat <strong>NFC</strong>. Kumpulkan, trade, dan naik level — semuanya di satu
              tempat.
            </p>
            <div className="hero-cta">
              <Link to="/drops" className="btn-gold btn-xl">
                ▶ Mulai Koleksimu
              </Link>
              <Link to="/marketplace" className="btn-ghost btn-xl">
                Buka Marketplace
              </Link>
            </div>
            <p className="muted" style={{ marginTop: 10, fontFamily: "var(--font-mono)", fontSize: 12, letterSpacing: "0.04em" }}>
              Sudah punya akun tapi saldo kosong?{" "}
              <Link to="/wallet" style={{ color: "var(--gold)", fontWeight: 600 }}>
                Isi C-Coin →
              </Link>
            </p>
            <p className="insert-coin">
              Insert coin to continue <span className="coin-slot blink">▮</span>
            </p>
          </div>

          <div className="hero-card-scene">
            <div className="holo-card">
              <div className="holo-card-top">
                <span>C.CARD</span>
                <span>NO.001</span>
              </div>
              <span className="holo-emoji">NO.001</span>
              <span className="holo-name">FIRST DROP</span>
              <span className="holo-chip">✓ NFC Verified</span>
            </div>
          </div>
        </div>
      </section>

      {/* HI-SCORE strip */}
      <div className="hero-score">
        <div className="hero-score-cell">
          <div className="hero-score-value">63×88</div>
          <div className="hero-score-label">MM Acrylic Premium</div>
        </div>
        <div className="hero-score-cell">
          <div className="hero-score-value cyan">1 Tap</div>
          <div className="hero-score-label">Verifikasi NFC Instan</div>
        </div>
        <div className="hero-score-cell">
          <div className="hero-score-value magenta">Rp 10.000</div>
          <div className="hero-score-label">Per 1 C-Coin</div>
        </div>
      </div>

      <div className="landing-inner">
        {/* HOW TO PLAY */}
        <section className="sect">
          <div className="sect-head">
            <span className="eyebrow">How to Play</span>
            <h2 className="h2">
              Cara Main — <em>3 Langkah</em>
            </h2>
          </div>
          <div className="grid-3">
            {STEPS.map((s) => (
              <div key={s.num} className="crt-screen">
                <div className="step-num">{s.num}</div>
                <div className="step-title">{s.title}</div>
                <p className="step-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* POWER-UPS */}
        <section className="sect">
          <div className="sect-head">
            <span className="eyebrow">Power-Ups</span>
            <h2 className="h2">
              Kenapa <em>C.Verse</em>
            </h2>
          </div>
          <div className="grid-3">
            {POWER_UPS.map((p) => (
              <div key={p.title} className="card card-pad">
                <div className="power-icon">{p.icon}</div>
                <div className="power-label">{p.label}</div>
                <div className="power-title">{p.title}</div>
                <p className="power-desc">{p.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ATTRACT MODE CTA */}
        <section className="attract">
          <span className="eyebrow" style={{ textAlign: "center" }}>
            Game Start
          </span>
          <h2 className="attract-title" style={{ marginTop: 10 }}>
            C.Card Pertamamu <em>Sudah Menunggu</em>
          </h2>
          <p className="attract-desc">Buat akun gratis, klaim C.Card dari drop berikutnya, dan mulai kumpulkan XP. Papan skor menantimu.</p>
          <div className="attract-cta">
            <Link to="/register" className="btn-gold btn-xl">
              ▶ Buat Akun Gratis
            </Link>
            <Link to="/drops" className="btn-ghost btn-xl">
              Lihat Drops
            </Link>
          </div>
          <p className="press-start">
            Press Start <span className="blink">▮</span>
          </p>
        </section>
      </div>
    </div>
  );
}
