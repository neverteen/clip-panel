export function parseSteamTradeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) return null;

  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "steamcommunity.com" ||
      url.pathname !== "/tradeoffer/new/" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) return null;
    const partner = url.searchParams.getAll("partner");
    const token = url.searchParams.getAll("token");
    const keys = [...url.searchParams.keys()];
    if (
      partner.length !== 1 || !partner[0] ||
      token.length !== 1 || !token[0] ||
      keys.length !== 2
    ) return null;
    return trimmed;
  } catch {
    return null;
  }
}

export function maskDestination(value: string) {
  if (value.length <= 12) return `${value.slice(0, 3)}••••${value.slice(-2)}`;
  return `${value.slice(0, 8)}••••••••${value.slice(-4)}`;
}
