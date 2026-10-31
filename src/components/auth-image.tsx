"use client";

import { useEffect, useState } from "react";

/**
 * AuthImage — an <img> component that fetches the image with the
 * Authorization: Bearer header from localStorage.
 *
 * Why this exists: plain <img src="/api/.../raw"> tags rely on cookies
 * for auth. On the cross-origin preview URL, the SameSite cookie policy
 * blocks the session cookie → the API returns 401 → the image fails
 * to load. This component uses fetch() with the Authorization header
 * (which always works) and converts the response to a blob URL that
 * the <img> tag can display.
 *
 * Usage: <AuthImage src="/api/.../raw" alt="..." className="..." />
 *        Behaves identically to <img> once the image is loaded.
 */

interface AuthImageProps {
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}

export function AuthImage({
  src,
  alt = "",
  className,
  style,
  onClick,
  onError,
}: AuthImageProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;

    const fetchImage = async () => {
      setLoading(true);
      setError(false);
      try {
        const token =
          typeof window !== "undefined"
            ? window.localStorage.getItem("ira_session_token")
            : null;
        const res = await fetch(src, {
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const blob = await res.blob();
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch (err) {
        if (!revoked) setError(true);
      } finally {
        if (!revoked) setLoading(false);
      }
    };

    fetchImage();

    // Cleanup: revoke the object URL when the component unmounts or src changes
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (loading) {
    return (
      <div
        className={className}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "40px",
          color: "#999",
          fontSize: "10px",
          ...style,
        }}
      >
        Loading…
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div
        className={className}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "40px",
          color: "#999",
          fontSize: "9px",
          textAlign: "center",
          padding: "4px",
          ...style,
        }}
        onClick={onClick}
      >
        Image load failed
      </div>
    );
  }

  return (
    <img
      src={blobUrl}
      alt={alt}
      className={className}
      style={style}
      onClick={onClick}
      onError={onError}
    />
  );
}
