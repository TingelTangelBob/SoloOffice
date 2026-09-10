// Gemeinsame, browserfähige Rechenlogik für API, Demo, Editor und Dokumentausgabe.
// Beträge werden in Cent, Mengen und Prozentwerte in Hundertsteln verarbeitet.
const MAX_CENTS = 9_999_999_999n; // NUMERIC(10,2) des bestehenden Schemas

function invalid(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'INVALID_DOCUMENT_DATA';
  throw error;
}

function roundedDivision(value, divisor) {
  return (value + divisor / 2n) / divisor;
}

function decimal(value, label, { max = 99_999_999.99, optional = false, absolute = false, preview = false } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return 0n;
  const supported = typeof value === 'number' || (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()));
  const number = supported ? Number(value) : NaN;
  const normalized = absolute ? Math.abs(number) : number;
  const scaled = Math.round(normalized * 100);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > max
      || !Number.isSafeInteger(scaled) || Math.abs(normalized * 100 - scaled) > 0.00001) {
    if (preview) return 0n;
    invalid(`${label} muss eine gültige Zahl mit höchstens zwei Nachkommastellen zwischen 0 und ${max} sein.`);
  }
  return BigInt(scaled);
}

function boundedMoney(cents, label) {
  if (cents < 0n || cents > MAX_CENTS) invalid(`${label} überschreitet den unterstützten Betragsbereich.`);
  return cents;
}

function discount(base, type, value, legacyAmount, label, preview) {
  if (type === undefined || type === null || type === '') {
    const amount = decimal(legacyAmount, label, { optional: true, absolute: true, preview });
    if (amount > base && !preview) invalid(`${label} darf den zugehörigen Nettobetrag nicht überschreiten.`);
    return { amount: amount > base ? base : amount, type: amount ? 'fixed' : null, value: amount ? Number(amount) / 100 : null };
  }
  if (type !== 'fixed' && type !== 'percentage') invalid(`${label}: Unbekannte Rabattart.`);
  const units = decimal(value, label, { max: type === 'percentage' ? 100 : 99_999_999.99, preview });
  const amount = type === 'percentage' ? roundedDivision(base * units, 10_000n) : units;
  if (amount > base && !preview) invalid(`${label} darf den zugehörigen Nettobetrag nicht überschreiten.`);
  return { amount: amount > base ? base : amount, type, value: Number(units) / 100 };
}

export function calculateDocumentMoney(data, { documentType = data?.documentType || 'invoice', allowIncomplete = false } = {}) {
  if (!data || !Array.isArray(data.items)) invalid('Die Positionen müssen als Liste übergeben werden.');
  if (!['invoice', 'credit_note', 'quote'].includes(documentType)) invalid('Unbekannte Dokumentart.');
  if (data.items.length > 2000) invalid('Ein Dokument darf höchstens 2000 Positionen enthalten.');
  const sign = documentType === 'credit_note' ? -1 : 1;
  const credit = sign < 0;
  const asMoney = amount => sign * Number(amount) / 100;
  let subtotal = 0n;
  let itemDiscountAmount = 0n;
  const buckets = new Map();

  const items = data.items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) invalid(`Position ${index + 1} ist ungültig.`);
    const label = `Position ${index + 1}`;
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    if (!allowIncomplete && (!description || description.length > 10_000)) invalid(`${label} benötigt eine Beschreibung mit höchstens 10000 Zeichen.`);
    const quantity = decimal(item.quantity, `${label}: Menge`, { preview: allowIncomplete });
    if (!allowIncomplete && quantity === 0n) invalid(`${label}: Die Menge muss größer als 0 sein.`);
    const unitPrice = decimal(item.unitPrice, `${label}: Einzelpreis`, { absolute: credit, preview: allowIncomplete });
    const rate = decimal(item.taxRate, `${label}: Steuersatz`, { max: 100, optional: true, preview: allowIncomplete });
    const gross = boundedMoney(roundedDivision(quantity * unitPrice, 100n), label);
    const itemDiscount = discount(gross, item.discountType, item.discountValue, item.discountAmount, `${label}: Rabatt`, allowIncomplete);
    const net = gross - itemDiscount.amount;
    subtotal += gross;
    itemDiscountAmount += itemDiscount.amount;
    buckets.set(rate, (buckets.get(rate) || 0n) + net);
    return {
      ...item, description, quantity: Number(quantity) / 100,
      unitPrice: asMoney(unitPrice), taxRate: Number(rate) / 100,
      discountType: itemDiscount.type, discountValue: itemDiscount.value,
      discountAmount: asMoney(itemDiscount.amount), total: asMoney(net),
    };
  });
  boundedMoney(subtotal, 'Die Zwischensumme');
  const afterItems = subtotal - itemDiscountAmount;
  const globalDiscount = discount(afterItems, data.globalDiscountType, data.globalDiscountValue, data.globalDiscountAmount, 'Gesamtrabatt', allowIncomplete);

  // Restcent der proportionalen Verteilung gehen deterministisch an die größten Reste.
  const allocations = [...buckets].sort(([a], [b]) => Number(a - b)).map(([rate, base]) => ({
    rate, base, reduction: afterItems ? globalDiscount.amount * base / afterItems : 0n,
    remainder: afterItems ? globalDiscount.amount * base % afterItems : 0n,
  }));
  let remainder = globalDiscount.amount - allocations.reduce((sum, bucket) => sum + bucket.reduction, 0n);
  for (const bucket of [...allocations].sort((a, b) => Number(b.remainder - a.remainder) || Number(a.rate - b.rate))) {
    if (remainder <= 0n) break;
    bucket.reduction += 1n;
    remainder -= 1n;
  }
  let tax = 0n;
  const taxBreakdown = {};
  for (const bucket of allocations) {
    const taxable = bucket.base - bucket.reduction;
    const amount = roundedDivision(taxable * bucket.rate, 10_000n);
    tax += amount;
    taxBreakdown[Number(bucket.rate) / 100] = { taxableAmount: asMoney(taxable), taxAmount: asMoney(amount) };
  }
  const discountedSubtotal = afterItems - globalDiscount.amount;
  boundedMoney(discountedSubtotal + tax, 'Die Gesamtsumme');
  return {
    items, subtotal: asMoney(subtotal), itemDiscountAmount: asMoney(itemDiscountAmount),
    globalDiscountType: globalDiscount.type, globalDiscountValue: globalDiscount.value,
    globalDiscountAmount: asMoney(globalDiscount.amount),
    totalDiscountAmount: asMoney(itemDiscountAmount + globalDiscount.amount),
    discountedSubtotal: asMoney(discountedSubtotal), taxAmount: asMoney(tax),
    total: asMoney(discountedSubtotal + tax), taxBreakdown,
  };
}
