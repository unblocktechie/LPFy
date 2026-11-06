import { useMemo } from 'react';
import { zeroAddress, type Hex } from 'viem';
import { useReadContracts } from 'wagmi';
import { marketLendingAbi } from '../../abi';
import { MaybeLoading } from '../../components/Loader';
import { formatAmount } from '../../lib/format';
import { useNetwork } from '../../lib/networkContext';
import { allMarketPairIds } from '../../lib/pairId';
import { debtTokenDecimals, resolveSymbol } from '../../lib/tokens';

export function PoolLiquidity({
	compact = false,
	pairId,
}: {
	compact?: boolean;
	pairId?: Hex;
}) {
	const net = useNetwork();
	const debtDec = debtTokenDecimals(net.addresses.debtAsset);
	const debtSym = resolveSymbol(net.addresses.debtAsset, undefined, 'USDC');
	const enabled =
		net.addresses.debtAsset !== zeroAddress &&
		net.addresses.lendingModule !== zeroAddress;
	const pairIds = pairId ? [pairId] : allMarketPairIds(net.markets);
	const reads = useReadContracts({
		contracts: pairIds.flatMap((pid) => [
			{
				address: net.addresses.lendingModule,
				abi: marketLendingAbi,
				functionName: 'cashBalance' as const,
				args: [pid] as const,
				chainId: net.chainId,
			},
			{
				address: net.addresses.lendingModule,
				abi: marketLendingAbi,
				functionName: 'availableToBorrow' as const,
				args: [pid] as const,
				chainId: net.chainId,
			},
			{
				address: net.addresses.lendingModule,
				abi: marketLendingAbi,
				functionName: 'utilizationBps' as const,
				args: [pid] as const,
				chainId: net.chainId,
			},
		]),
		query: {
			enabled: enabled && net.contractsConfigured && pairIds.length > 0,
			staleTime: 0,
		},
	});
	const poolCash = useMemo(() => {
		let sum = 0n;
		for (let i = 0; i < pairIds.length; i += 1) {
			const row = reads.data?.[i * 3];
			if (row?.status === 'success') sum += row.result as bigint;
		}
		return pairIds.length ? sum : undefined;
	}, [reads.data, pairIds.length]);
	const availableTotal = useMemo(() => {
		let sum = 0n;
		for (let i = 0; i < pairIds.length; i += 1) {
			const row = reads.data?.[i * 3 + 1];
			if (row?.status === 'success') sum += row.result as bigint;
		}
		return pairIds.length ? sum : undefined;
	}, [reads.data, pairIds.length]);
	const utilAvg = useMemo(() => {
		if (pairId) {
			const row = reads.data?.[2];
			return row?.status === 'success' ? (row.result as bigint) : undefined;
		}
		let sum = 0n;
		let n = 0;
		for (let i = 0; i < pairIds.length; i += 1) {
			const row = reads.data?.[i * 3 + 2];
			if (row?.status === 'success') {
				sum += row.result as bigint;
				n += 1;
			}
		}
		return n ? sum / BigInt(n) : undefined;
	}, [reads.data, pairId, pairIds.length]);
	const loading = reads.isLoading && reads.data === undefined;
	if (compact) {
		return (
			<div className="row">
				<span>Pool {debtSym}</span>
				<strong>
					<MaybeLoading loading={loading && poolCash === undefined}>
						{poolCash !== undefined
							? `${formatAmount(poolCash, debtDec)} ${debtSym}`
							: undefined}
					</MaybeLoading>
				</strong>
			</div>
		);
	}
	return (
		<div className={`stat metric-card ${compact ? 'compact' : ''}`}>
			<div className="k">Available to borrow</div>
			<div className="v">
				<MaybeLoading loading={loading && availableTotal === undefined}>
					{availableTotal !== undefined
						? `${formatAmount(availableTotal, debtDec)} ${debtSym}`
						: '—'}
				</MaybeLoading>
			</div>
			<div className="meta">
				Cash{' '}
				{poolCash !== undefined
					? `${formatAmount(poolCash, debtDec)} ${debtSym}`
					: '—'}
				{utilAvg !== undefined
					? ` · util ${(Number(utilAvg) / 100).toFixed(1)}%`
					: ''}
				{!pairId ? ' · all markets' : ''}
			</div>
		</div>
	);
}
