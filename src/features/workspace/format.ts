export function formatPrice(value: number): string {
  return `৳${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] ?? "there";
}

export function initials(value: string): string {
  const result = value
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return result || "U";
}

/** Relative freshness label for dashboard headers, e.g. "Updated 2 minutes ago". */
export function formatUpdatedAt(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes === 1) return "Updated 1 minute ago";
  if (minutes < 60) return `Updated ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "Updated 1 hour ago";
  if (hours < 24) return `Updated ${hours} hours ago`;
  return `Updated ${formatDate(new Date(timestamp).toISOString())}`;
}
