import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { type LegalDocument, type LegalSection, legalDocuments, legalDocumentsBySlug } from "./legal-documents";
import "./legal.css";

const LEGAL_ALIASES: Record<string, string> = {
  tos: "terms",
  "terms-of-service": "terms",
  "privacy-policy": "privacy",
};

function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} — C.Verse`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

function DocumentMeta({ document }: { document: LegalDocument }) {
  return (
    <dl className="legal-meta-grid">
      <div>
        <dt>Status</dt>
        <dd>
          <span className="legal-status-dot" aria-hidden="true" />
          {document.status}
        </dd>
      </div>
      <div>
        <dt>Diperbarui</dt>
        <dd>
          <time dateTime="2026-09-04">{document.updated}</time>
        </dd>
      </div>
      <div>
        <dt>Versi</dt>
        <dd>{document.version}</dd>
      </div>
      <div>
        <dt>Berlaku untuk</dt>
        <dd>{document.audience}</dd>
      </div>
    </dl>
  );
}

function LegalSectionContent({ section }: { section: LegalSection }) {
  return (
    <>
      {section.paragraphs?.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      {section.bullets ? (
        <ul>
          {section.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      ) : null}
      {section.table ? (
        <div className="legal-table-wrap">
          <table>
            <thead>
              <tr>
                {section.table.headers.map((header) => (
                  <th key={header} scope="col">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell, index) =>
                    index === 0 ? (
                      <th key={cell} scope="row">
                        {cell}
                      </th>
                    ) : (
                      <td key={cell}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {section.note ? (
        <aside className="legal-note">
          <span aria-hidden="true">i</span>
          <p>{section.note}</p>
        </aside>
      ) : null}
    </>
  );
}

function LegalHub() {
  useDocumentTitle("Pusat Legal");
  return (
    <div className="legal-shell legal-hub">
      <header className="legal-hero">
        <div className="legal-kicker">
          <span>STATION PROTOCOL</span>
          <span>PUBLIC ACCESS</span>
        </div>
        <p className="legal-code">LEGAL CONTROL DECK / 2026</p>
        <h1>Pusat Legal</h1>
        <p className="legal-lead">
          Aturan platform dalam bahasa yang bisa dibaca manusia. Pilih dokumen untuk memahami hak, kewajiban, saldo, data, Vault, dan
          transaksi di C.Verse.
        </p>
        <div className="legal-hero-orbit" aria-hidden="true">
          <span />
          <i />
        </div>
      </header>

      <section className="legal-launch-notice" aria-labelledby="legal-readiness-title">
        <div className="legal-launch-index">00</div>
        <div>
          <p className="legal-eyebrow">STATUS PUBLIKASI</p>
          <h2 id="legal-readiness-title">Dokumen legal sedang masuk tahap publikasi</h2>
          <p>
            T&C dan kebijakan Vault sudah final internal. Identitas badan usaha, NIB, alamat terdaftar, dan tanggal berlaku akan dicantumkan
            sebelum layanan komersial dibuka.
          </p>
        </div>
      </section>

      <div className="legal-card-grid">
        {legalDocuments.map((document, index) => (
          <Link className="legal-card" to={`/legal/${document.slug}`} key={document.slug}>
            <div className="legal-card-head">
              <span>{document.code}</span>
              <span>{String(index + 1).padStart(2, "0")}</span>
            </div>
            <h2>{document.shortTitle}</h2>
            <p>{document.description}</p>
            <div className="legal-card-foot">
              <span>Versi {document.version}</span>
              <strong>
                Buka dokumen <span aria-hidden="true">↗</span>
              </strong>
            </div>
          </Link>
        ))}
      </div>

      <section className="legal-contact-panel">
        <div>
          <p className="legal-eyebrow">BUTUH BANTUAN?</p>
          <h2>Hakmu tidak berhenti di halaman ini.</h2>
        </div>
        <div className="legal-contact-links">
          <a href="mailto:support@c-verse.co">support@c-verse.co</a>
          <a href="mailto:privacy@c-verse.co">privacy@c-verse.co</a>
          <a href="mailto:legal@c-verse.co">legal@c-verse.co</a>
        </div>
      </section>
    </div>
  );
}

function LegalDocumentPage({ document }: { document: LegalDocument }) {
  useDocumentTitle(document.shortTitle);
  return (
    <div className="legal-shell">
      <header className="legal-document-hero">
        <div className="legal-breadcrumb">
          <Link to="/legal">Pusat Legal</Link>
          <span aria-hidden="true">/</span>
          <span>{document.code}</span>
        </div>
        <div className="legal-document-title-row">
          <div>
            <p className="legal-code">{document.code} / CONTROLLED DOCUMENT</p>
            <h1>{document.title}</h1>
            <p className="legal-lead">{document.description}</p>
          </div>
          <button className="legal-print" type="button" onClick={() => window.print()}>
            <span aria-hidden="true">⌁</span>
            Cetak / Simpan PDF
          </button>
        </div>
        <DocumentMeta document={document} />
      </header>

      <div className="legal-document-layout">
        <aside className="legal-toc" aria-label="Daftar isi">
          <p className="legal-eyebrow">DAFTAR ISI</p>
          <nav>
            {document.sections.map((section) => (
              <a href={`#${section.id}`} key={section.id}>
                {section.title}
              </a>
            ))}
            <a href="#sumber">Sumber hukum</a>
          </nav>
          <div className="legal-toc-seal" aria-hidden="true">
            <span>C.V</span>
            <small>VERIFIED COPY</small>
          </div>
        </aside>

        <article className="legal-document">
          {document.sections.map((section) => (
            <section id={section.id} key={section.id}>
              <h2>{section.title}</h2>
              <LegalSectionContent section={section} />
            </section>
          ))}

          <section id="sumber" className="legal-sources">
            <h2>Sumber hukum</h2>
            <p>Rujukan berikut digunakan sebagai fondasi penyusunan. Tautan membuka sumber resmi di tab baru.</p>
            <ol>
              {document.sources.map((source) => (
                <li key={source.label}>
                  {source.href ? (
                    <a href={source.href} target="_blank" rel="noreferrer">
                      {source.label}
                    </a>
                  ) : (
                    source.label
                  )}
                </li>
              ))}
            </ol>
          </section>

          <footer className="legal-document-footer">
            <p>
              Pertanyaan tentang dokumen ini?{" "}
              <a href="mailto:legal@c-verse.co">
                Hubungi legal@c-verse.co <span aria-hidden="true">↗</span>
              </a>
            </p>
            <Link to="/legal">Kembali ke Pusat Legal</Link>
          </footer>
        </article>
      </div>
    </div>
  );
}

export default function Legal() {
  const { slug } = useParams();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [slug]);

  if (!slug) return <LegalHub />;

  const alias = LEGAL_ALIASES[slug];
  if (alias) return <Navigate to={`/legal/${alias}`} replace />;

  const document = legalDocumentsBySlug.get(slug);
  if (!document) return <Navigate to="/legal" replace />;
  return <LegalDocumentPage document={document} />;
}
