export function providerLabel(provider) {
  return provider
    .split(', ')
    .map((name) => {
      if (name === 'serpapi') return 'SerpApi Google Flights';
      if (name === 'aviasales') return 'Aviasales';
      if (name === 'yandex-rasp') return 'Yandex Rasp';
      if (name === 'amadeus') return 'Amadeus';
      return name;
    })
    .join(', ');
}

export function configuredProviders() {
  return [
    process.env.SERPAPI_KEY ? 'serpapi' : null,
    process.env.TRAVELPAYOUTS_TOKEN ? 'aviasales' : null,
    process.env.YANDEX_RASP_API_KEY ? 'yandex-rasp' : null,
    process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET ? 'amadeus' : null
  ].filter(Boolean);
}
