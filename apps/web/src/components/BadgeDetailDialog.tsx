import {
  BADGE_FAMILIES,
  BADGE_TIERS,
  type Badge,
  type BadgeCriteria,
  badgeProgressTarget,
  parseBadgeCriteria,
  type UserBadge,
} from "@c-verse/shared";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { BadgeEmblem } from "./BadgeEmblem";
import "./badge-detail-dialog.css";

type BadgeDetailDialogProps = {
  badge: Badge;
  earned?: UserBadge;
  progress?: number;
  privateReady?: boolean;
  privateUnavailable?: boolean;
  returnFocusTo: HTMLButtonElement | null;
  onClose: () => void;
};

function criterionText(criteria: BadgeCriteria | null): string {
  if (!criteria) return "Syarat lencana ini akan ditampilkan saat tersedia.";
  const family = BADGE_FAMILIES.find((entry) => entry.id === criteria.family);
  const target = badgeProgressTarget(criteria);
  if (criteria.type === "first_bid") return "Ajukan penawaran pertama melalui halaman detail kartu.";
  if (criteria.type === "single_bid_gt") return `Pasang satu penawaran di atas ${target - 1} C-Coin.`;
  if (criteria.type === "kyc_verified") return "Selesaikan verifikasi identitas akun.";
  return `Capai ${target.toLocaleString("id-ID")} ${family?.unit ?? "pencapaian"}.`;
}

function earnedDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? "Tanggal tidak tersedia"
    : new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "long", year: "numeric" }).format(parsed);
}

function actionFor(criteria: BadgeCriteria | null, signedIn: boolean): { to: string; label: string } {
  if (criteria?.type === "kyc_verified")
    return signedIn ? { to: "/me/kyc", label: "Verifikasi akun" } : { to: "/login", label: "Masuk untuk verifikasi" };
  if (criteria?.type === "first_bid" || criteria?.type === "single_bid_gt") return { to: "/browse", label: "Jelajahi C.Card" };
  return { to: BADGE_FAMILIES.find((family) => family.id === criteria?.family)?.href ?? "/browse", label: "Cari kartu" };
}

export function BadgeDetailDialog({
  badge,
  earned,
  progress,
  privateReady = false,
  privateUnavailable = false,
  returnFocusTo,
  onClose,
}: BadgeDetailDialogProps) {
  const { user } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const criteria = parseBadgeCriteria(badge.criteria);
  const family = BADGE_FAMILIES.find((entry) => entry.id === criteria?.family);
  const tier = BADGE_TIERS.find((entry) => entry.tier === criteria?.tier) ?? BADGE_TIERS[0];
  const action = actionFor(criteria, Boolean(user?.id));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      returnFocusTo?.focus();
    };
  }, [returnFocusTo]);

  return (
    <dialog
      ref={dialogRef}
      className="badges-dialog"
      aria-labelledby="badge-detail-title"
      aria-describedby="badge-detail-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]");
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)
          onClose();
      }}
    >
      <button type="button" className="badges-dialog__close" onClick={onClose} autoFocus aria-label="Tutup detail lencana">
        ×
      </button>
      <BadgeEmblem badge={badge} size="hero" />
      <div className="badges-dialog__eyebrow">
        {family?.name ?? "Khusus"} · {tier.name} Tingkat {tier.roman}
      </div>
      <h2 id="badge-detail-title">{badge.name}</h2>
      <p id="badge-detail-description">{badge.description}</p>
      <dl className="badges-dialog__facts">
        <div>
          <dt>Syarat</dt>
          <dd>{criterionText(criteria)}</dd>
        </div>
        <div>
          <dt>XP</dt>
          <dd>+{earned?.xpRewardSnapshot ?? badge.xpReward ?? badge.xp} XP</dd>
        </div>
        {earned ? (
          <div>
            <dt>Didapat</dt>
            <dd>{earnedDate(earned.earnedAt)}</dd>
          </div>
        ) : null}
        {!earned && privateReady && criteria ? (
          <div>
            <dt>Kemajuan</dt>
            <dd>
              {progress !== undefined
                ? `${progress.toLocaleString("id-ID")} / ${badgeProgressTarget(criteria).toLocaleString("id-ID")}`
                : "Belum tersedia untuk kriteria ini."}
            </dd>
          </div>
        ) : null}
        {!earned && !privateReady ? (
          <div>
            <dt>Status</dt>
            <dd>
              {privateUnavailable ? "Pencapaianmu belum bisa dimuat. Coba lagi dari galeri lencana." : "Masuk untuk melihat pencapaianmu."}
            </dd>
          </div>
        ) : null}
      </dl>
      <Link className="btn-gold" to={action.to} onClick={onClose}>
        {action.label}
      </Link>
    </dialog>
  );
}
