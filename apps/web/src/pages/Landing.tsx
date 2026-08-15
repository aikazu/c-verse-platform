import { Link } from "react-router-dom";

const TICKER_ITEMS = [
  "NEW DROP SETIAP MINGGU",
  "KOLEKSI KREATOR EDISI TERBATAS",
  "NFC VERIFIED",
  "1 C-COIN = RP 10.000",
  "1 KARTU / USER / DROP",
  "TRADE DI MARKETPLACE",
];

const STEPS = [
  {
    num: "01",
    title: "PILIH DROP",
    desc: "Beli kartu edisi terbatas dari kreator favoritmu sebelum habis. Satu kartu per user per drop — yang cepat, dapat.",
  },
  {
    num: "02",
    title: "TAP NFC",
    desc: "Sentuh kartu ke ponselmu. Chip NTAG dengan CMAC AES-128 memverifikasi keaslian dalam sekejap — tamper permanen.",
  },
  {
    num: "03",
    title: "TRADE & LEVEL UP",
    desc: "Pasang buyout di Marketplace atau bid langsung di Browse. Setiap 1 C-Coin belanja = 1 XP — naik level, buka badge.",
  },
];

const POWER_UPS = [
  {
    icon: "⬡",
    label: "POWER-UP 1",
    title: "FISIK PREMIUM",
    desc: "Acrylic hardcase 63×88 mm dengan efek holo — koleksi yang benar-benar bisa dipegang, dipajang, dan ditunjukkan.",
  },
  {
    icon: "◈",
    label: "POWER-UP 2",
    title: "NFC VERIFIED",
    desc: "Verifikasi keaslian instan lewat tap NFC. Counter maju + diversifikasi key — kartu palsu tidak akan lolos.",
  },
  {
    icon: "₵",
    label: "POWER-UP 3",
    title: "C-COIN",
    desc: "1 C-Coin = Rp 10.000. Top-up, beli drop, trade — semua transaksi dalam satu mata uang simpel, tanpa desimal.",
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
            <span className="hero-tag">Player 1 — Ready</span>
            <h1 className="hero-title">
              C<span className="dot">.</span>VERSE
            </h1>
            <p className="hero-sub">Koleksi Kreator · Edisi Terbatas</p>
            <p className="hero-desc">
              Kartu kolaborasi kreator dalam <strong>acrylic premium</strong> — setiap kartu terverifikasi lewat <strong>tap NFC</strong>.
              Kumpulkan, trade, dan naik level dalam satu ekosistem arcade koleksi.
            </p>
            <div className="hero-cta">
              <Link to="/drops" className="btn-gold btn-xl">
                ▶ Mulai Main
              </Link>
              <Link to="/marketplace" className="btn-ghost btn-xl">
                Marketplace
              </Link>
            </div>
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
              <span className="holo-emoji">🎴</span>
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
          <div className="hero-score-value cyan">AES-128</div>
          <div className="hero-score-label">CMAC NFC Anti-Tamper</div>
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
            Attract Mode
          </span>
          <h2 className="attract-title" style={{ marginTop: 10 }}>
            Ready <em>Player One?</em>
          </h2>
          <p className="attract-desc">Buat akun, klaim kartu pertamamu dari drop berikutnya, dan mulai kumpulkan XP. High score menanti.</p>
          <div className="attract-cta">
            <Link to="/register" className="btn-gold btn-xl">
              ▶ Tekan Start
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
