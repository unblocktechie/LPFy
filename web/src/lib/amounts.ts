import { formatUnits } from 'viem';

export function toInputAmount(value: bigint, decimals: number) {
  const s = formatUnits(value, decimals);
  if (!s.includes('.')) return s;
  return s.replace(/(\.d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
}
