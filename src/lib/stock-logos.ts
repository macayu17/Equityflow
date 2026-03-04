function getGrowwLogoUrl(ticker: string): string {
  return `https://assets-netstorage.groww.in/stock-assets/logos2/${ticker.toUpperCase()}.webp`;
}

function getGrowwLogoPngUrl(ticker: string): string {
  return `https://assets-netstorage.groww.in/stock-assets/logos2/${ticker.toUpperCase()}.png`;
}

export function getStockLogoUrls(ticker: string, preferredLogoUrl?: string): string[] {
  const growwWebp = getGrowwLogoUrl(ticker);
  const growwPng = getGrowwLogoPngUrl(ticker);

  const urls = [
    preferredLogoUrl,
    growwWebp,
    growwPng,
    `https://www.google.com/s2/favicons?domain=${ticker.toLowerCase()}.com&sz=128`,
  ].filter((u): u is string => !!u);

  return Array.from(new Set(urls));
}
