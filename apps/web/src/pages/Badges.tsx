import type { Badge, BadgeCriteria, BadgeFamily, UserBadge } from "@c-verse/shared";
import { BADGE_FAMILIES, BADGE_TIERS, badgeProgressTarget, parseBadgeCriteria } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeDetailDialog } from "../components/BadgeDetailDialog";
import { BadgeEmblem } from "../components/BadgeEmblem";
import { PageHero } from "../components/PageHero";
import { api } from "../lib/api";
import type { ApiBadgeProgressResponse, ApiBadgesResponse } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { ErrorState, LoadingState } from "../lib/QueryStates";
import "./badges.css";

type StatusFilter = "all" | "earned" | "unearned";
type FamilyFilter = BadgeFamily | "special" | "all";

type BadgeEntry = {
  badge: Badge;
  criteria: BadgeCriteria | null;
  earned?: UserBadge;
};

const FAMILY_BY_ID = new Map(BADGE_FAMILIES.map((family) => [family.id, family]));

function familyFor(criteria: BadgeCriteria | null) {
  return criteria?.family === "special" ? null : criteria ? FAMILY_BY_ID.get(criteria.family) : null;
}

function rarity(criteria: BadgeCriteria | null) {
  return BADGE_TIERS.find((tier) => tier.tier === criteria?.tier) ?? BADGE_TIERS[0];
}

function badgeFamily(criteria: BadgeCriteria | null): BadgeFamily | "special" {
  return criteria?.family ?? "special";
}

function progressFor(criteria: BadgeCriteria | null, progress: Record<string, number> | undefined): number | undefined {
  return criteria ? progress?.[criteria.type] : undefined;
}

function compareCatalogue(left: BadgeEntry, right: BadgeEntry): number {
  const leftFamily =
    left.criteria?.family === "special" || !left.criteria
      ? BADGE_FAMILIES.length
      : BADGE_FAMILIES.findIndex((family) => family.id === left.criteria?.family);
  const rightFamily =
    right.criteria?.family === "special" || !right.criteria
      ? BADGE_FAMILIES.length
      : BADGE_FAMILIES.findIndex((family) => family.id === right.criteria?.family);
  if (leftFamily !== rightFamily) return leftFamily - rightFamily;
  const leftTier = left.criteria?.tier ?? Number.MAX_SAFE_INTEGER;
  const rightTier = right.criteria?.tier ?? Number.MAX_SAFE_INTEGER;
  return leftTier !== rightTier ? leftTier - rightTier : left.badge.name.localeCompare(right.badge.name, "id");
}

function BadgeStatus({
  entry,
  progress,
  privateReady,
  signedIn,
}: {
  entry: BadgeEntry;
  progress?: number;
  privateReady: boolean;
  signedIn: boolean;
}) {
  if (!signedIn) return <span className="badges-status badges-status--unknown">Lencana pencapaian</span>;
  if (!privateReady) return <span className="badges-status badges-status--unknown">Status akun belum diketahui</span>;
  if (entry.earned) return <span className="badges-status badges-status--earned">Terkoleksi</span>;
  if (!entry.criteria || progress === undefined)
    return <span className="badges-status badges-status--unknown">Kemajuan belum tersedia</span>;
  return <span className="badges-status badges-status--progress">Dalam misi</span>;
}

export default function Badges() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const catalog = useQuery<ApiBadgesResponse>({ queryKey: ["badges"], queryFn: () => api.badges() });
  const progressQuery = useQuery<ApiBadgeProgressResponse>({
    queryKey: ["badge-progress", user?.id],
    queryFn: () => api.badgeProgress(),
    enabled: Boolean(user?.id),
  });

  const privateReady = Boolean(user?.id && progressQuery.data);
  const privateUnavailable = Boolean(user?.id && progressQuery.isError);
  const progress = progressQuery.data?.progress;

  const entries = useMemo<BadgeEntry[]>(() => {
    const byId = new Map<string, Badge>();
    for (const badge of catalog.data?.badges ?? []) byId.set(badge.id, badge);
    for (const award of progressQuery.data?.badges ?? []) {
      if (award.badge) byId.set(award.badge.id, award.badge);
    }
    const awards = new Map<string, UserBadge>((progressQuery.data?.badges ?? []).map((award) => [award.badgeId, award]));
    return (
      [...byId.values()]
        .map((badge) => ({ badge, criteria: parseBadgeCriteria(badge.criteria), earned: awards.get(badge.id) }))
        // An archived badge remains part of a collector's record, but is not a
        // public target for visitors who have not earned it.
        .filter((entry) => entry.badge.isActive !== false || entry.earned)
        .sort(compareCatalogue)
    );
  }, [catalog.data?.badges, progressQuery.data?.badges]);

  const visibleEntries = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("id-ID");
    return entries.filter((entry) => {
      const family = familyFor(entry.criteria);
      const familyMatches = familyFilter === "all" || entry.criteria?.family === familyFilter;
      const text = `${entry.badge.name} ${entry.badge.description} ${family?.name ?? ""} ${family?.title ?? ""}`.toLocaleLowerCase("id-ID");
      const statusMatches =
        statusFilter === "all" ||
        (statusFilter === "earned" && privateReady && Boolean(entry.earned)) ||
        (statusFilter === "unearned" && privateReady && !entry.earned);
      return familyMatches && statusMatches && (!needle || text.includes(needle));
    });
  }, [entries, familyFilter, privateReady, search, statusFilter]);

  const selected = entries.find((entry) => entry.badge.id === selectedId) ?? null;
  if (catalog.isLoading) return <LoadingState label="Menyusun galeri lencana…" />;
  if (catalog.isError) return <ErrorState onRetry={() => void catalog.refetch()} label="Gagal memuat katalog lencana" />;

  return (
    <div className="page-stack badges-page">
      <PageHero
        channel="06"
        channelLabel="LENCANA"
        title="Kabinet Prestasi"
        desc="Delapan keluarga pencapaian dengan lima tingkat lencana untuk menandai setiap tonggak koleksi."
      />

      <section className="badges-cabinet" aria-labelledby="badges-tier-heading">
        <div className="badges-cabinet__copy">
          <span className="section-eyebrow">TINGKAT LENCANA</span>
          <h2 id="badges-tier-heading">Dari Bronze sampai Nova</h2>
          <p>Setiap tingkat menandai tonggak yang lebih tinggi dalam perjalanan koleksimu.</p>
        </div>
        <ol className="badges-tier-samples" aria-label="Lima tingkat lencana">
          {BADGE_TIERS.map((tier) => (
            <li key={tier.tier}>
              <BadgeEmblem
                family="collector"
                tier={tier.tier}
                size="hero"
                label={`Contoh tingkat lencana ${tier.name}, tingkat ${tier.roman}`}
              />
              <span className="badges-tier-samples__roman">{tier.roman}</span>
              <span>{tier.name}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="badges-vault" aria-labelledby="badges-gallery-heading">
        <header className="badges-vault__head">
          <div>
            <span className="section-eyebrow">CATALOGUE</span>
            <h2 id="badges-gallery-heading">Galeri lencana</h2>
            <p>{entries.length} lencana tercatat dalam katalog saat ini.</p>
          </div>
          {user ? (
            <div className="badges-private-state" aria-live="polite">
              {progressQuery.isLoading && "Membaca kemajuan akun…"}
              {privateReady && "Kemajuan akun pribadi aktif"}
              {privateUnavailable && (
                <button type="button" onClick={() => void progressQuery.refetch()}>
                  Kemajuan belum tersedia — coba lagi
                </button>
              )}
            </div>
          ) : (
            <Link className="badges-signin" to="/login">
              Masuk untuk melihat kemajuanmu
            </Link>
          )}
        </header>

        <div className="badges-controls" aria-label="Filter galeri lencana">
          <label className="badges-search">
            <span className="sr-only">Cari lencana</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari nama atau keluarga…"
              type="search"
            />
          </label>
          <label className="badges-select">
            <span>Keluarga</span>
            <select value={familyFilter} onChange={(event) => setFamilyFilter(event.target.value as FamilyFilter)}>
              <option value="all">Semua keluarga</option>
              {BADGE_FAMILIES.map((family) => (
                <option key={family.id} value={family.id}>
                  {family.title}
                </option>
              ))}
              <option value="special">Special</option>
            </select>
          </label>
          <div className="badges-status-filter" role="group" aria-label="Status koleksi">
            {(["all", "earned", "unearned"] as const).map((status) => {
              const label = status === "all" ? "Semua" : status === "earned" ? "Terkoleksi" : "Belum";
              return (
                <button
                  key={status}
                  type="button"
                  className={statusFilter === status ? "is-active" : ""}
                  onClick={() => setStatusFilter(status)}
                  disabled={status !== "all" && !privateReady}
                  title={status !== "all" && !privateReady ? "Masuk dan muat kemajuan akun untuk memakai filter ini" : undefined}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {visibleEntries.length === 0 ? (
          <div className="empty-arcade badges-empty" role="status">
            <div className="empty-icon" aria-hidden="true">
              NO_MATCH
            </div>
            <div className="empty-title">Lencana tidak ditemukan</div>
            <p className="empty-msg">Ubah kata kunci atau filter keluarga untuk melihat pencapaian lain.</p>
          </div>
        ) : (
          <div className="badges-grid" aria-label="Daftar lencana">
            {visibleEntries.map((entry) => {
              const family = familyFor(entry.criteria);
              const tier = rarity(entry.criteria);
              const current = progressFor(entry.criteria, progress);
              const target = entry.criteria ? badgeProgressTarget(entry.criteria) : undefined;
              const percentage = target !== undefined && current !== undefined ? Math.min(100, Math.round((current / target) * 100)) : null;
              const xp = entry.earned?.xpRewardSnapshot ?? entry.badge.xpReward ?? entry.badge.xp;
              return (
                <article key={entry.badge.id} className={`badges-card${entry.earned ? " is-earned" : ""}`}>
                  <BadgeEmblem badge={entry.badge} family={badgeFamily(entry.criteria)} tier={tier.tier} />
                  <div className="badges-card__body">
                    <div className="badges-card__meta">
                      <span>{family?.title ?? "Special"}</span>
                      <span>
                        {tier.name} · Tier {tier.roman}
                      </span>
                    </div>
                    <h3>{entry.badge.name}</h3>
                    <p>{entry.badge.description}</p>
                    <div className="badges-card__footer">
                      <BadgeStatus entry={entry} progress={current} privateReady={privateReady} signedIn={Boolean(user?.id)} />
                      <span className="badges-xp">+{xp} XP</span>
                    </div>
                    {percentage !== null && !entry.earned && (
                      <div className="badges-progress" aria-label={`Kemajuan ${percentage}%`}>
                        <span style={{ width: `${percentage}%` }} />
                        <small>
                          {current?.toLocaleString("id-ID")} / {target?.toLocaleString("id-ID")}
                        </small>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="badges-card__detail"
                    onClick={(event) => {
                      openerRef.current = event.currentTarget;
                      setSelectedId(entry.badge.id);
                    }}
                    aria-label={`Lihat detail ${entry.badge.name}`}
                  >
                    Detail
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selected && (
        <BadgeDetailDialog
          badge={selected.badge}
          earned={selected.earned}
          progress={progressFor(selected.criteria, progress)}
          privateReady={privateReady}
          privateUnavailable={privateUnavailable}
          returnFocusTo={openerRef.current}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
