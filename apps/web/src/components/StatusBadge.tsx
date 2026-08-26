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

export function StatusBadge({
  status,
  kind = "drop",
  style,
  pulse = false,
}: {
  status: string;
  kind?: StatusKind;
  style?: React.CSSProperties;
  /**
   * Additive optional: when true, the badge pulses like the live-pulse signal
   * dot. Used by launch-manifest surfaces to flag "LIVE" / "RAFFLE" drops.
   * Backward-compatible: defaults to false so existing callers are unchanged.
   */
  pulse?: boolean;
}) {
  const { label, variant } = resolve(kind, status);
  const className = pulse ? `pill pill-${variant} is-pulse` : `pill pill-${variant}`;
  return (
    <span className={className} style={style}>
      {label}
    </span>
  );
}
