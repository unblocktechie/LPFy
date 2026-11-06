import type { ReactNode } from "react";

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}

export function LoadingText({ label = "Loading…" }: { label?: string }) {
  return (
    <span className="loading-inline">
      <Spinner size={12} />
      {label}
    </span>
  );
}

/** Show spinner while loading; otherwise render children / fallback. */
export function MaybeLoading({
  loading,
  children,
  fallback = "—",
}: {
  loading: boolean;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  if (loading) return <LoadingText />;
  if (children === undefined || children === null || children === "") return <>{fallback}</>;
  return <>{children}</>;
}
