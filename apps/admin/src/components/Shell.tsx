import type React from "react";
import { NavLink } from "react-router-dom";

function Shell({
  email,
  authLabel = "Supabase OTP · akses berbasis peran",
  onLogout,
  children,
}: {
  email: string;
  authLabel?: string;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const items = [
    { to: "/", label: "Dashboard", icon: "▦" },
    { to: "/creators", label: "Kreator", icon: "◎" },
    { to: "/drops", label: "Drops", icon: "◈" },
    { to: "/orders", label: "Pesanan", icon: "⧉" },
    { to: "/nfc", label: "NFC", icon: "⬡" },
    { to: "/payouts", label: "Payout", icon: "₵" },
    { to: "/badges", label: "Lencana", icon: "✦" },
    { to: "/disputes", label: "Sengketa", icon: "⚑" },
    { to: "/kyc", label: "KYC", icon: "⊞" },
    { to: "/audit", label: "Audit", icon: "◷" },
    { to: "/investor", label: "Investor", icon: "⬢" },
  ];

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <div className="admin-sidebar-logo">
            C<span>.</span>Verse
          </div>
          <div className="admin-sidebar-sub">Admin</div>
        </div>
        <nav className="admin-nav">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === "/"}
              className={({ isActive }) => (isActive ? "admin-nav-link active" : "admin-nav-link")}
            >
              <span className="admin-nav-icon">{it.icon}</span>
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <div className="admin-user">
            <div className="admin-user-avatar">{email.slice(0, 1).toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="fs-12 fw-700" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {email}
              </div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>{authLabel}</div>
            </div>
          </div>
          <button className="btn-ghost admin-logout" onClick={onLogout}>
            Keluar
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-title">C.Verse Admin</div>
        </header>
        <div className="admin-content">{children}</div>
      </div>
    </div>
  );
}

export { Shell };
