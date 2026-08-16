import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

const LATER_FLAG_KEY = "cverse_username_later";

export default function UsernameSetupModal() {
  const { user, refresh } = useAuth();
  const { push } = useToast();
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Hanya tampil untuk user yang usernamenya masih hasil generate default (username_is_auto)
  const isDefault = !!user?.usernameIsAuto;

  useEffect(() => {
    if (!value || value === user?.username) {
      setStatus("idle");
      return;
    }
    if (!USERNAME_RE.test(value)) {
      setStatus("invalid");
      return;
    }
    clearTimeout(debounceRef.current);
    setStatus("checking");
    debounceRef.current = setTimeout(async () => {
      try {
        await api.publicProfile(value);
        setStatus("taken");
      } catch (err: any) {
        const msg = (err?.message ?? "").toLowerCase();
        if (msg.includes("404") || msg.includes("tidak ditemukan") || msg.includes("not found")) {
          setStatus("available");
        } else {
          setStatus("idle");
        }
      }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [value, user?.username]);

  // early return seteleh semua hook agar urutan hook tetap konsisten tiap render
  if (!isDefault || skipped) return null;

  async function onSubmit() {
    if (status !== "available" && status !== "idle") return;
    setBusy(true);
    try {
      await api.patchProfile({ username: value });
      await refresh();
      push("Username tersimpan!", "success");
    } catch (err: any) {
      push(err?.message ?? "Gagal menyimpan username", "error");
    } finally {
      setBusy(false);
    }
  }

  function onSkip() {
    // Ingat pilihan "nanti" supaya modal tidak muncul lagi di sesi berikutnya (App juga gate via flag ini).
    try {
      localStorage.setItem(LATER_FLAG_KEY, "1");
    } catch {}
    setSkipped(true);
  }

  const hint: Record<string, string> = {
    idle: "Min 3 karakter, huruf/angka/underscore",
    checking: "Memeriksa ketersediaan…",
    available: "✓ Tersedia!",
    taken: "✗ Username sudah dipakai",
    invalid: "Hanya huruf kecil, angka, underscore (3–20 karakter)",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(5,3,11,0.85)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 420,
          width: "100%",
          padding: 32,
          borderColor: "var(--border-strong)",
          boxShadow: "0 0 0 2px var(--border-strong), 0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ fontFamily: "var(--font-display)", fontSize: 15, color: "var(--gold)", textAlign: "center" }}>Pilih Username</div>
        <div className="muted" style={{ textAlign: "center", marginTop: 10, fontSize: 13 }}>
          Panggilan publik untuk profilmu di C.Verse — bisa diganti nanti.
        </div>
        <div className="form-row" style={{ marginTop: 20 }}>
          <label className="label">Username</label>
          <input
            className="input"
            placeholder="contoh: kolektor_sejati"
            value={value}
            onChange={(e) => setValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            autoFocus
            style={{ fontFamily: "var(--font-mono)" }}
          />
          {value && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                marginTop: 6,
                color:
                  status === "available"
                    ? "var(--signal)"
                    : status === "taken" || status === "invalid"
                      ? "var(--alert)"
                      : "var(--text-dim)",
              }}
            >
              {hint[status]}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button
            className="btn-gold"
            disabled={busy || (status !== "available" && status !== "idle")}
            onClick={onSubmit}
            style={{ flex: 1, padding: "12px" }}
          >
            {busy ? "Menyimpan…" : "Simpan"}
          </button>
          <button className="btn-ghost" onClick={onSkip} style={{ flex: 1, padding: "12px" }} disabled={busy}>
            Nanti
          </button>
        </div>
      </div>
    </div>
  );
}
