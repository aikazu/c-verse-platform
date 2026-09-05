import { C_COIN_RATE_IDR, ccoinToIdr, formatIdr, SHIPMENT_FEE_CCOIN } from "@c-verse/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import "./collector-guide.css";

const topics = ["pool", "hold", "result", "vault", "shipping"] as const;
type Topic = (typeof topics)[number];
const titles: Record<Topic, string> = {
  pool: "Pilih pool C.Card",
  hold: "Kenali saldo ditahan",
  result: "Lihat hasil Raffle",
  vault: "Kartu tersimpan di Vault",
  shipping: "Kirim saat kamu siap",
};
const money = (amount: number) => `${amount} C-Coin (${formatIdr(ccoinToIdr(amount))})`;

export function CollectorGuide(props: { topic: Topic; regularPrice?: number; signedPrice?: number; entryStatus?: string }) {
  const { user } = useAuth();
  return user ? <GuideForUser key={`${user.id}-${props.topic}`} userId={user.id} {...props} /> : null;
}

function GuideForUser({
  userId,
  topic,
  regularPrice,
  signedPrice,
  entryStatus,
}: {
  userId: string;
  topic: Topic;
  regularPrice?: number;
  signedPrice?: number;
  entryStatus?: string;
}) {
  const [selected, setSelected] = useState(topic);
  const client = useQueryClient();
  const queryKey = ["collector-guide", userId];
  const query = useQuery({ queryKey, queryFn: api.guide });
  const mutation = useMutation({ mutationFn: api.saveGuide, onSuccess: (data) => client.setQueryData(queryKey, data) });
  const statusLabel: Record<string, string> = {
    held: "Menunggu pengundian",
    won_regular: "Mendapat kartu Reguler",
    won_premium: "Mendapat kartu Signed",
    lost: "Belum terpilih — saldo dikembalikan",
  };
  const descriptions: Record<Topic, string> = {
    pool: `Reguler untuk kartu tanpa tanda tangan, Signed untuk kartu bertanda tangan. Keduanya mencoba Signed dahulu, lalu Reguler jika belum terpilih. Maksimal satu kartu per Drop. ${regularPrice !== undefined ? `Reguler ${money(regularPrice)}. ` : ""}${signedPrice !== undefined ? `Signed ${money(signedPrice)}.` : "Harga setiap pool tertera di detail Drop."}`,
    hold: "Saat ikut Raffle, C-Coin ditahan sehingga belum bisa dibelanjakan. Reguler menahan harga Reguler; Signed atau Keduanya menahan harga Signed, bukan jumlah kedua harga. Jika tidak menang, seluruh hold kembali otomatis. Jika Keduanya mendapat Reguler, selisih harga kembali. C-Coin adalah saldo belanja dan tidak dapat diuangkan.",
    result: `Setelah pengundian, lihat hasil entry di detail Drop dan notifikasi akun. Pemenang membayar dari saldo ditahan; yang belum terpilih menerima pengembalian otomatis. ${entryStatus && statusLabel[entryStatus] ? `Status entry kamu: ${statusLabel[entryStatus]}.` : "Jika pengundian sedang diproses, tunggu hasil resmi."}`,
    vault:
      "Pembelian selesai saat kartu tercatat milikmu dan disimpan di Vault platform. Lihat kartu di Koleksi dan lokasinya di Kelola C.Card. Pembelian tidak meminta alamat atau ongkir; pengiriman fisik dapat diminta sesudahnya.",
    shipping: `Di Kelola C.Card, pilih kartu milikmu yang berada di Vault lalu pilih Kirim dari Vault. Isi alamat dan periksa konfirmasi. Ongkir ${money(SHIPMENT_FEE_CCOIN)} dibayar saat meminta pengiriman. Pantau status dan resi di akun. Kartu dalam proses transaksi atau pengiriman belum bisa dikirim lagi.`,
  };
  if (query.isPending) return null;
  return (
    <aside className="collector-guide" aria-label="Panduan pengguna baru">
      {query.isError ? (
        <button className="btn-ghost" onClick={() => void query.refetch()}>
          Coba muat panduan lagi
        </button>
      ) : query.data?.dismissed ? (
        <button
          className="btn-ghost"
          disabled={mutation.isPending}
          onClick={() => {
            setSelected(topic);
            mutation.mutate(false);
          }}
        >
          Buka panduan pengguna baru
        </button>
      ) : (
        <>
          <div className="guide-heading">
            <span className="label">MULAI MENGOLEKSI</span>
            <button className="btn-ghost" disabled={mutation.isPending} onClick={() => mutation.mutate(true)}>
              Lewati panduan
            </button>
          </div>
          <nav className="guide-steps" aria-label="Langkah panduan">
            {topics.map((value, index) => (
              <button
                key={value}
                className={value === selected ? "pill pill-warn" : "pill"}
                aria-pressed={value === selected}
                onClick={() => setSelected(value)}
              >
                {index + 1}. {titles[value]}
              </button>
            ))}
          </nav>
          <h2 className="h3">{titles[selected]}</h2>
          <p>{descriptions[selected]}</p>
          <p className="mono guide-rate">1 C-Coin = {formatIdr(C_COIN_RATE_IDR)}</p>
          <div className="guide-heading">
            <Link
              to={selected === "hold" ? "/wallet" : selected === "shipping" || selected === "vault" ? "/me/manage" : "/drops"}
              className="btn-ghost"
            >
              {selected === "hold" ? "Buka Wallet" : selected === "shipping" || selected === "vault" ? "Kelola C.Card" : "Jelajahi Drops"} →
            </Link>
            <button
              className="btn-ghost"
              disabled={mutation.isPending}
              onClick={() => {
                const next = topics[topics.indexOf(selected) + 1];
                if (next) setSelected(next);
                else mutation.mutate(true);
              }}
            >
              {selected === "shipping" ? "Selesai panduan" : "Lanjut panduan →"}
            </button>
          </div>
        </>
      )}
      {mutation.isError && <p role="alert">{mutation.error.message}</p>}
    </aside>
  );
}
