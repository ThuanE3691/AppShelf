/** "41 h 12 min left" until the given time, or "Expired". */
export function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min left` : `${minutes} min left`;
}
