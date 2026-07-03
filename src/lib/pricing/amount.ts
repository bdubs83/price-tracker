export function displayAmountLabel(value?: string) {
  if (!value) return 'Unspecified';
  const normalized = value.trim();
  const match = normalized.match(/^(\d+(?:\.\d+)?)(mg|mcg|IU|iu|ml)(?:\*\d+vials?)?$/);
  if (!match) return normalized.replace(/\*10vials?/i, '').replace(/\s+/g, ' ').trim();
  const unit = match[2].toLowerCase() === 'iu' ? 'IU' : match[2].toLowerCase();
  return `${match[1]}${unit}`;
}
