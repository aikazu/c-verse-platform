import { Navigate } from "react-router-dom";

// Register = login. Magic-link + Google otomatis mendeteksi email baru (auto
// register) vs email lama (auto login) — alur tunggal. Route ini 301 ke /login.
export default function Register() {
  return <Navigate to="/login" replace />;
}
