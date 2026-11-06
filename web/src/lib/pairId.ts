import { type Address, encodePacked, getAddress, keccak256 } from 'viem';

export function pairIdOf(tokenA: Address, tokenB: Address): `0x${string}` {
  const a = getAddress(tokenA);
  const b = getAddress(tokenB);
  const [x, y] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return keccak256(encodePacked(['address', 'address'], [x, y]));
}
