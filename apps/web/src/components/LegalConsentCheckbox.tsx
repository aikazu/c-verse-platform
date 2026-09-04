import { Link } from "react-router-dom";

export type LegalConsentDocument = {
  label: string;
  to: string;
};

export type LegalConsent = {
  label: string;
  documents: readonly LegalConsentDocument[];
};

const TERMS = { label: "Syarat & Ketentuan", to: "/legal/terms" } as const;
const PRIVACY = { label: "Kebijakan Privasi", to: "/legal/privacy" } as const;
const SHIPPING = { label: "Kebijakan Pengiriman & Vault", to: "/legal/shipping" } as const;
const KYC = { label: "Kebijakan KYC", to: "/legal/kyc" } as const;

export const LEGAL_CONSENTS = {
  topup: {
    label: "Saya paham C-Coin bersifat closed-loop dan tidak dapat diuangkan.",
    documents: [TERMS, PRIVACY],
  },
  raffle: {
    label: "Saya paham mengikuti raffle tidak bisa dibatalkan.",
    documents: [TERMS],
  },
  checkout: {
    label: "Saya menyetujui pembelian dan penyimpanan C.Card di Vault.",
    documents: [TERMS, SHIPPING],
  },
  bid: {
    label: "Saya paham bid baru bisa dibatalkan setelah 24 jam.",
    documents: [TERMS],
  },
  listing: {
    label: "Saya menyetujui publikasi harga dan skema settlement secondary market.",
    documents: [TERMS],
  },
  acceptBid: {
    label: "Saya menyetujui perpindahan kepemilikan dan settlement C-Gems.",
    documents: [TERMS, SHIPPING],
  },
  shipout: {
    label: "Saya menyetujui biaya serta ketentuan pengiriman fisik C.Card.",
    documents: [SHIPPING, TERMS],
  },
  sellerVault: {
    label: "Saya menyetujui verifikasi C.Card dan settlement setelah diterima Vault.",
    documents: [SHIPPING, TERMS],
  },
  payout: {
    label: "Saya menyetujui fee, verifikasi KYC, dan penguncian dana selama payout.",
    documents: [TERMS, KYC, PRIVACY],
  },
  conversion: {
    label: "Saya paham konversi C-Gems ke C-Coin bersifat satu arah dan final.",
    documents: [TERMS],
  },
  support: {
    label: "Saya menyetujui pengiriman Dukungan C-Coin kepada kreator.",
    documents: [TERMS],
  },
  kyc: {
    label: "Saya menyetujui pemrosesan data identitas untuk verifikasi KYC.",
    documents: [KYC, PRIVACY],
  },
  dispute: {
    label: "Saya menyatakan informasi dispute ini benar dan dapat dipertanggungjawabkan.",
    documents: [TERMS],
  },
} as const satisfies Record<string, LegalConsent>;

export function LegalConsentCheckbox({
  consent,
  checked,
  onChange,
  id,
  autoFocus,
}: {
  consent: LegalConsent;
  checked: boolean;
  onChange: (checked: boolean) => void;
  id: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="legal-consent">
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} autoFocus={autoFocus} />
      <div className="legal-consent-copy">
        <label htmlFor={id}>{consent.label}</label>
        <div className="legal-consent-links" aria-label="Dokumen legal terkait">
          Baca:
          {consent.documents.map((document) => (
            <Link key={document.to} to={document.to} target="_blank" rel="noreferrer">
              {document.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
