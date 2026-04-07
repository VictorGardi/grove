/**
 * Formats a timestamp to a professional display format (YYYY-MM-DD HH:mm UTC).
 * @param timestamp - ISO 8601 timestamp string, or null/undefined/invalid
 * @returns Formatted timestamp or "—" as fallback
 */
export function formatTimestamp(timestamp: string | null | undefined): string {
  if (!timestamp || typeof timestamp !== "string") {
    return "—";
  }

  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return "—";
    }

    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");

    return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
  } catch {
    return "—";
  }
}
