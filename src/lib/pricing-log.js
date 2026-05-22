// Builds the copy-to-clipboard price-search log. Pure formatter: takes
// trip inputs, change events, plan, quote, and progress events, returns
// a single string. Also exports copyLogWithFallback (textarea+execCommand
// fallback for browsers without navigator.clipboard).

export function buildPricingLog(input) {
  const {
    origin,
    stops,
    requirements,
    startDate,
    passengers,
    lockOrder,
    inputChangeLog,
    plan,
    quote,
    priceProgress
  } = input;

  const lines = [
    'Microwave Travel price-search log',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Goal for agent:',
    'Analyze this route-search log and suggest how to reduce API requests, improve candidate ordering, caching, batching, or route/date selection without missing cheaper routes.',
    '',
    'Trip input:',
    `Start city: ${origin}`,
    `Stops: ${stops.map((stop) => `${stop.city} (${Number(stop.stayDays) || 0}d)`).join(' -> ')}`,
    `Visit-before dates: ${requirements.map((item) => `${item.city} before ${item.date}`).join('; ') || 'none'}`,
    `Start date: ${startDate}`,
    `Passengers: ${passengers}`,
    `Lock order: ${lockOrder ? 'yes' : 'no'}`,
    '',
    `Input change events (${inputChangeLog.length}):`,
    ...(inputChangeLog.length
      ? inputChangeLog.map((event, index) => `${index + 1}. [${event.at}] ${event.message} | stops now: ${event.stops.map(formatStopSnapshot).join(' -> ')}`)
      : ['No user input changes recorded since page load.']),
    '',
    'Current displayed route:',
    plan?.legs?.length
      ? plan.legs.map((leg, index) => `${index + 1}. ${leg.from} -> ${leg.to} | ${leg.mode} | depart ${leg.departOn} | arrive ${leg.arriveBy} | ${leg.hours}h | ${leg.distanceKm} km`).join('\n')
      : 'No route plan available.',
    '',
    'Price result:',
    quote
      ? JSON.stringify({
          totalAmount: quote.totalAmount,
          currency: quote.currency,
          pricedLegCount: quote.pricedLegCount,
          legCount: quote.legCount,
          message: quote.message,
          optimization: quote.optimization || null,
          optimizedRouteOptions: (quote.optimizedRouteOptions || []).map((option) => ({
            route: option.route,
            departureDate: option.departureDate,
            dateShiftDays: option.dateShiftDays || 0,
            stayFlexDays: option.stayFlexDays || 0,
            amount: option.amount,
            totalAmount: option.totalAmount,
            pricedLegCount: option.pricedLegCount,
            legCount: option.legCount
          })),
          optimizedRouteSkippedOptions: (quote.optimizedRouteSkippedOptions || []).map((option) => ({
            route: option.route,
            departureDate: option.departureDate,
            reason: option.reason,
            message: option.message,
            details: option.details
          }))
        }, null, 2)
      : 'Pricing is still running or no quote is available.',
    '',
    `Progress events (${priceProgress.length}):`,
    ...priceProgress.map(formatProgressEvent),
    '',
    `Provider attempts (${quote?.attempts?.length || 0}):`,
    ...(quote?.attempts || []).map((attempt, index) => `${index + 1}. ${JSON.stringify(attempt)}`),
    '',
    `Priced legs (${quote?.legs?.length || 0}):`,
    ...(quote?.legs || []).map((leg, index) => `${index + 1}. ${JSON.stringify(leg)}`)
  ];

  return lines.join('\n');
}

export function formatProgressEvent(event, index) {
  const details = event.details ? ` | ${JSON.stringify(event.details)}` : '';
  return `${index + 1}. [${event.at || 'no-time'}] ${event.step}: ${event.message}${details}`;
}

export function formatStopSnapshot(stop) {
  const visitBefore = stop.visitBefore ? `, before ${stop.visitBefore}` : '';
  return `${stop.city || 'empty'} (${stop.stayDays || 0}d${visitBefore})`;
}

export function copyLogWithFallback(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}
