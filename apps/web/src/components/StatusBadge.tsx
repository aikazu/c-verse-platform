import { dropStatusLabel, orderStatusLabel, shipmentStatusLabel } from "@c-verse/shared";

type StatusKind = "drop" | "order" | "shipment";
type PillVariant = "success" | "warn" | "danger" | "info";

const DROP_VARIANT: Record<string, PillVariant> = {
  live: "success",
  published: "success",
  scheduled: "warn",
  draft: "warn",
  sold_out: "info",
  closed: "info",
  cancelled: "danger",
};

const ORDER_VARIANT: Record<string, PillVariant> = {
  paid: "warn",
  qc: "warn",
  shipped: "info",
  delivered: "info",
  settled: "success",
  refunded: "danger",
  disputed: "danger",
  cancelled: "danger",
};

const SHIPMENT_VARIANT: Record<string, PillVariant> = {
  requested: "warn",
  packed: "warn",
  shipped: "info",
  delivered: "success",
  cancelled: "danger",
};

function resolve(kind: StatusKind, status: string): { label: string; variant: PillVariant } {
  if (kind === "order") return { label: orderStatusLabel(status), variant: ORDER_VARIANT[status] ?? "info" };
  if (kind === "shipment") return { label: shipmentStatusLabel(status), variant: SHIPMENT_VARIANT[status] ?? "info" };
  return { label: dropStatusLabel(status), variant: DROP_VARIANT[status] ?? "info" };
}

export function StatusBadge({ status, kind = "drop", style }: { status: string; kind?: StatusKind; style?: React.CSSProperties }) {
  const { label, variant } = resolve(kind, status);
  return (
    <span className={`pill pill-${variant}`} style={style}>
      {label}
    </span>
  );
}
