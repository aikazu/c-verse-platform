import { dropStatusLabel, kycStatusLabel, orderStatusLabel, shipmentStatusLabel } from "@c-verse/shared";

type StatusKind = "drop" | "order" | "shipment" | "kyc" | "generic";
type PillVariant = "success" | "warn" | "danger" | "info";

// Variant heuristik lintas-domain: warna status admin tidak lagi seragam biru.
const VARIANT: Record<string, PillVariant> = {
  live: "success",
  published: "success",
  settled: "success",
  approved: "success",
  delivered: "success",
  active: "success",
  completed: "success",
  paid_out: "success",
  scheduled: "warn",
  draft: "warn",
  pending: "warn",
  requested: "warn",
  packed: "warn",
  qc: "warn",
  paid: "warn",
  under_review: "warn",
  processing: "warn",
  queued: "warn",
  resolved_refund: "success",
  resolved_strike: "warn",
  resolved_suspend: "danger",
  shipped: "info",
  closed: "info",
  sold_out: "info",
  inactive: "info",
  cancelled: "danger",
  rejected: "danger",
  refunded: "danger",
  disputed: "danger",
  tamper_detected: "danger",
  failed: "danger",
};

function labelFor(kind: StatusKind, status: string): string {
  if (kind === "order") return orderStatusLabel(status);
  if (kind === "shipment") return shipmentStatusLabel(status);
  if (kind === "kyc") return kycStatusLabel(status);
  if (kind === "drop") return dropStatusLabel(status);
  return status;
}

export function StatusBadge({ status, kind = "generic", style }: { status: string; kind?: StatusKind; style?: React.CSSProperties }) {
  const variant = VARIANT[status] ?? "info";
  return (
    <span className={`pill pill-${variant}`} style={style}>
      {labelFor(kind, status)}
    </span>
  );
}
