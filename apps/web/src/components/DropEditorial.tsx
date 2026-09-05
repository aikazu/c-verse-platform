import type { PublishedEditorial } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { ErrorState } from "../lib/QueryStates";
import "./drop-editorial.css";

interface DropEditorialProps {
  dropId: string;
  cardId?: string;
  kind?: "story" | "seed_campaign";
}

export function DropEditorial({ dropId, cardId, kind }: DropEditorialProps) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["drop-editorial", dropId],
    queryFn: () => api.dropEditorial(dropId),
  });
  if (isLoading) return null;
  if (isError) return <ErrorState label="Cerita C.Card belum dapat dimuat." onRetry={() => void refetch()} />;

  const items = (data?.items ?? []).filter((item: PublishedEditorial) => {
    if (kind && item.kind !== kind) return false;
    return !cardId || (item.kind === "seed_campaign" && item.document.cardId === cardId);
  });
  if (items.length === 0) return null;

  return (
    <section className="drop-editorial" aria-label="Cerita C.Card">
      {items.map((item) => (
        <article className="card card-pad drop-editorial-item" key={item.kind}>
          <p className="drop-editorial-kicker">{item.kind === "seed_campaign" ? "CREATOR SEED CAMPAIGN" : "CERITA C.CARD"}</p>
          <h2 className="h2">{item.document.title}</h2>
          <p className="drop-editorial-body">{item.document.body}</p>
          {item.kind === "seed_campaign" && (
            <div className="drop-editorial-stages">
              <Stage label="Proses pembuatan" body={item.document.making} />
              <Stage label="Penandatanganan" body={item.document.signing} />
              <Stage label="Penyerahan" body={item.document.handover} />
              {item.cardShortId && (
                <Link className="drop-editorial-card-link" to={`/cards/${item.cardShortId}`}>
                  Lihat kartu Creator Seed →
                </Link>
              )}
            </div>
          )}
          {item.document.media.length > 0 && (
            <div className="drop-editorial-media">
              {[...new Map(item.document.media.map((media) => [JSON.stringify(media), media])).values()].map((media) => (
                <figure key={JSON.stringify(media)}>
                  {media.type === "image" ? (
                    <img src={media.url} alt={media.caption} loading="lazy" />
                  ) : (
                    <video controls preload="metadata">
                      <source src={media.url} />
                      Video tidak dapat diputar di browser ini.
                    </video>
                  )}
                  <figcaption>{media.caption}</figcaption>
                  <a href={media.url} target="_blank" rel="noreferrer">
                    Buka media ↗
                  </a>
                </figure>
              ))}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

function Stage({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <h3>{label}</h3>
      <p>{body}</p>
    </div>
  );
}
