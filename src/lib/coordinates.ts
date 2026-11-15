/** Decimal latitude, longitude, with optional degree signs and cardinal directions. */
export function parseCoordinates(
  input: string,
): { latitude: number; longitude: number } | null {
  const match = input
    .trim()
    .match(
      /^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,\s]\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i,
    );
  if (!match) return null;
  let latitude = Number(match[1]),
    longitude = Number(match[3]);
  const latDirection = match[2]?.toUpperCase(),
    lonDirection = match[4]?.toUpperCase();
  if (
    (latDirection === "N" && latitude < 0) ||
    (lonDirection === "E" && longitude < 0)
  )
    return null;
  if (latDirection === "S") latitude = -Math.abs(latitude);
  if (lonDirection === "W") longitude = -Math.abs(longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  return { latitude, longitude };
}
export function formatCoordinates(latitude: number, longitude: number) {
  return `${Math.abs(latitude).toFixed(4)}° ${latitude < 0 ? "S" : "N"}  /  ${Math.abs(longitude).toFixed(4)}° ${longitude < 0 ? "W" : "E"}`;
}
