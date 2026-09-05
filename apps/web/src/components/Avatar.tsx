import type { CSSProperties } from "react";
import { useState } from "react";

type AvatarProps = {
  src?: string | null;
  name: string;
  className?: string;
  size?: number;
  style?: CSSProperties;
};

function initials(name: string): string {
  return (name.trim() || "?").replace(/^@+/, "").slice(0, 2).toUpperCase();
}

/** Public-image avatar with a deterministic initials fallback. */
export function Avatar({ src, name, className, size, style: providedStyle }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const style = { ...(size ? { width: size, height: size } : {}), ...providedStyle };
  if (src && failedSrc !== src) {
    return <img className={className} src={src} alt={`Avatar ${name}`} style={style} onError={() => setFailedSrc(src)} />;
  }
  return (
    <span className={className} style={style} aria-label={`Avatar ${name}`}>
      {initials(name)}
    </span>
  );
}
