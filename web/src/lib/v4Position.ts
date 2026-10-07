/** Decode Uniswap V4 PositionManager PositionInfo packed uint256 */
export function decodeV4PositionInfo(info: bigint) {
  const tickLowerRaw = Number((info >> 8n) & 0xffffffn);
  const tickUpperRaw = Number((info >> 32n) & 0xffffffn);
  const tickLower = tickLowerRaw >= 0x800000 ? tickLowerRaw - 0x1000000 : tickLowerRaw;
  const tickUpper = tickUpperRaw >= 0x800000 ? tickUpperRaw - 0x1000000 : tickUpperRaw;
  return {
    tickLower,
    tickUpper,
    hasSubscriber: (info & 0xffn) !== 0n,
  };
}
