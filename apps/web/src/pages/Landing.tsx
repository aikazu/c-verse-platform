import { Link } from "react-router-dom";
import "./landing.css";

const STEPS = [
  {
    title: "Pilih drop",
    description: "Pilih jenis kartu, lalu ikuti undian pembelian (raffle). Setelah undian selesai, sisa kartu bisa dibeli langsung.",
    href: "/drops",
    action: "Lihat Drops",
  },
  {
    title: "Simpan di Vault",
    description:
      "Kartu yang kamu beli disimpan di Vault, tempat penyimpanan C.Verse. Ajukan pengiriman saat ingin menerima kartu fisiknya.",
    href: "/legal/shipping",
    action: "Ketentuan Vault",
  },
  {
    title: "Beli atau tawar kartu",
    description: "Beli kartu dari kolektor lain di Marketplace, atau ajukan harga penawaran melalui halaman detail kartu.",
    href: "/marketplace",
    action: "Buka Marketplace",
  },
];

export default function Landing() {
  return (
    <div className="landing">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-copy">
          <p className="landing-label">C.VERSE / COLLECTIBLE CARD</p>
          <h1 id="landing-title">C.Card</h1>
          <p className="landing-description">
            Kartu fisik edisi terbatas dari kolaborasi kreator. Ikuti drop, simpan di Vault, atau beli dari kolektor lain.
          </p>
          <div className="landing-actions">
            <Link to="/drops" className="btn-gold btn-xl">
              Lihat Drops
            </Link>
            <Link to="/marketplace" className="btn-ghost btn-xl">
              Buka Marketplace
            </Link>
          </div>
          <p className="landing-payment">Belanja dengan C-Coin. Hasil penjualan dan royalti masuk sebagai C-Gems.</p>
        </div>
        <figure className="landing-format">
          <div className="landing-format-label">FORMAT KARTU</div>
          <svg viewBox="0 0 320 370" role="img" aria-label="Ukuran kartu 63 kali 88 milimeter">
            <defs>
              <pattern id="card-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M20 0H0V20" fill="none" stroke="currentColor" strokeOpacity=".1" />
              </pattern>
            </defs>
            <rect width="320" height="370" fill="url(#card-grid)" />
            <g fill="none" stroke="currentColor">
              <rect x="62" y="42" width="196" height="274" rx="6" />
              <rect x="72" y="52" width="176" height="254" rx="2" strokeOpacity=".25" />
              <path d="M62 28V16M258 28V16M62 22H258M276 42H288M276 316H288M282 42V316" strokeOpacity=".6" />
              <path d="M62 329V341M258 329V341M62 335H123M197 335H258" strokeOpacity=".35" />
            </g>
            <text x="160" y="14" textAnchor="middle" className="landing-measure">
              63 MM
            </text>
            <text x="306" y="179" textAnchor="middle" transform="rotate(90 306 179)" className="landing-measure">
              88 MM
            </text>
            <text x="160" y="177" textAnchor="middle" className="landing-card-name">
              C.Card
            </text>
            <text x="160" y="337" textAnchor="middle" className="landing-measure">
              HOLO
            </text>
          </svg>
          <figcaption>Kartu holografik dalam pelindung akrilik, dengan chip NFC untuk memeriksa keaslian.</figcaption>
        </figure>
      </section>
      <section className="landing-guide" aria-labelledby="landing-guide-title">
        <h2 id="landing-guide-title">Cara mengoleksi C.Card</h2>
        <ol>
          {STEPS.map((step) => (
            <li key={step.href}>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
              <Link to={step.href}>
                {step.action} <span aria-hidden="true">↗</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
