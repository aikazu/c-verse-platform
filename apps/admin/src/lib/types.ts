// ── Row types (snake_case straight from Supabase / admin API) ───────────────

export type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  username: string | null;
  role: string;
  flag_reason: string | null;
};
export type CreatorRow = {
  id: string;
  user_id: string | null;
  handle: string | null;
  total_followers_combined: number | null;
  status: string;
  notes: string | null;
  created_at: string;
};
export type ProvisionResult = {
  user: { id: string; email: string; role: string };
  creator: { handle: string };
  emailSent: boolean;
};
export type DropRow = {
  id: string;
  title: string;
  series: string;
  status: string;
  total_units: number;
  sold_count: number | null;
  price_ccoin: number | null;
  price_unsigned_ccoin: number | null;
  raffle_end_at: string | null;
  drawn_at: string | null;
  created_at: string;
};
export type OrderRow = {
  id: string;
  card_id: string | null;
  status: string;
  delivery_option: string | null;
  tracking_number: string | null;
  created_at: string;
};
export type ShipmentRow = { id: string; card_id: string; status: string; tracking_number: string | null };
export type DisputeRow = {
  id: string;
  order_id: string | null;
  reporter_id: string;
  reason: string;
  status: string;
  decision_notes: string | null;
  created_at: string;
};
export type BadgeRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  xp_reward: number | null;
  criteria: unknown;
  is_active: boolean | null;
};
export type KycRow = {
  id: string;
  user_id: string;
  full_name: string;
  nik: string;
  status: string;
  created_at: string;
};
export type PayoutBatchRow = { id: string; batch_code: string; status: string; total_ccoin: number; total_idr: number };
export type PayoutRow = {
  id: string;
  user_id: string;
  type: string;
  ccoin_amount: number;
  idr_amount: number | null;
  status: string;
  batch_id: string | null;
};
export type AuditRow = {
  id: string;
  admin_user_id: string;
  action: string;
  target_table: string;
  target_id: string | null;
  payload_summary: unknown;
  ip: string | null;
  created_at: string;
};
export type NfcBatchRow = { id: string; batch_code: string; qty: number; status: string };
export type CardRow = {
  id: string;
  nfc_uid: string | null;
  nfc_short_id: string | null;
  verify_status: string | null;
  nfc_configured: boolean | null;
  qc_status: string | null;
};
