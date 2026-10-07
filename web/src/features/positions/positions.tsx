import { useEffect, useMemo, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
	parseAbiItem,
	zeroAddress,
	type Address,
	type PublicClient,
} from 'viem';
import {
	usePublicClient,
	useReadContract,
	useReadContracts,
} from 'wagmi';
import {
	adapterAbi,
	erc721Abi,
	marketLendingAbi,
	v3NpmAbi,
	v4NpmAbi,
} from '../../abi';
import { LoadingText } from '../../components/Loader';
import { TokenPair } from '../../components/TokenPair';
import {
	formatAmount,
	formatPoolFee,
	formatUsd8,
} from '../../lib/format';
import { useNetwork } from '../../lib/networkContext';
import type { AppMarket } from '../../lib/networks';
import { matchesMarketPair } from '../../lib/pairId';
import {
	debtTokenDecimals,
	formatBpsAsPct,
	resolveDecimals,
	resolveSymbol,
} from '../../lib/tokens';

const TRANSFER_EVENT = parseAbiItem(
	'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
);

export async function fetchOwnedV4Ids(
	client: PublicClient,
	npm: Address,
	owner: Address,
): Promise<bigint[]> {
	const n = await client.readContract({
		address: npm,
		abi: erc721Abi,
		functionName: 'balanceOf',
		args: [owner],
	});
	if (n === 0n) return [];
	const want = Number(n > 40n ? 40n : n);
	const ownerLc = owner.toLowerCase();

	try {
		const enumerated: bigint[] = [];
		for (let i = 0n; i < BigInt(want); i += 1n) {
			enumerated.push(
				await client.readContract({
					address: npm,
					abi: erc721Abi,
					functionName: 'tokenOfOwnerByIndex',
					args: [owner, i],
				}),
			);
		}
		if (enumerated.length) return enumerated;
	} catch {
		/* V4 PositionManager is not ERC721Enumerable */
	}

	try {
		const next = await client.readContract({
			address: npm,
			abi: [
				{
					type: 'function',
					name: 'nextTokenId',
					stateMutability: 'view',
					inputs: [],
					outputs: [{ type: 'uint256' }],
				},
			] as const,
			functionName: 'nextTokenId',
		});
		const owned: bigint[] = [];
		const batch = 40n;
		let cursor = next > 0n ? next - 1n : 0n;
		let scanned = 0n;
		const maxScan = 2_500n;
		while (cursor > 0n && owned.length < want && scanned < maxScan) {
			const start = cursor >= batch ? cursor - batch + 1n : 1n;
			const ids: bigint[] = [];
			for (let id = cursor; id >= start; id -= 1n) ids.push(id);
			const results = await client.multicall({
				allowFailure: true,
				contracts: ids.map((tokenId) => ({
					address: npm,
					abi: erc721Abi,
					functionName: 'ownerOf' as const,
					args: [tokenId] as const,
				})),
			});
			results.forEach((row, i) => {
				if (
					row.status === 'success' &&
					typeof row.result === 'string' &&
					row.result.toLowerCase() === ownerLc
				) {
					owned.push(ids[i]);
				}
			});
			scanned += BigInt(ids.length);
			cursor = start > 1n ? start - 1n : 0n;
		}
		if (owned.length) {
			return [...new Set(owned)].sort((a, b) =>
				a === b ? 0 : a > b ? -1 : 1,
			);
		}
	} catch {
		/* nextTokenId / multicall unavailable */
	}

	const latest = await client.getBlockNumber();
	const lookback = 500_000n;
	let from = latest > lookback ? latest - lookback : 0n;
	const span = 10_000n;
	const seen = new Set<string>();
	while (from <= latest) {
		const to = from + span > latest ? latest : from + span;
		try {
			const logs = await client.getLogs({
				address: npm,
				event: TRANSFER_EVENT,
				args: { to: owner },
				fromBlock: from,
				toBlock: to,
			});
			for (const log of logs) {
				if (log.args.tokenId !== undefined)
					seen.add(log.args.tokenId.toString());
			}
		} catch {
			/* skip window */
		}
		from = to + 1n;
	}
	const owned: bigint[] = [];
	for (const idStr of seen) {
		const tokenId = BigInt(idStr);
		try {
			const current = await client.readContract({
				address: npm,
				abi: erc721Abi,
				functionName: 'ownerOf',
				args: [tokenId],
			});
			if (current.toLowerCase() === ownerLc) owned.push(tokenId);
		} catch {
			/* burned */
		}
	}
	return owned.sort((a, b) => (a === b ? 0 : a > b ? -1 : 1));
}

export const WALLET_NFT_CAP = 40;

export function TableMessage({
	children,
	colSpan = 7,
}: {
	children: ReactNode;
	colSpan?: number;
}) {
	return (
		<tr>
			<td colSpan={colSpan} className="table-msg">
				{children}
			</td>
		</tr>
	);
}

export function PositionUnderlying({
	version,
	tokenId,
	token0,
	token1,
}: {
	version: 0 | 1;
	tokenId: bigint;
	token0?: Address;
	token1?: Address;
}) {
	const net = useNetwork();
	const adapter =
		version === 0 ? net.addresses.v3Adapter : net.addresses.v4Adapter;
	const sqrt = useReadContract({
		address: adapter,
		abi: adapterAbi,
		functionName: 'getPoolSqrtPriceX96',
		args: [tokenId],
		chainId: net.chainId,
		query: { enabled: adapter !== zeroAddress },
	});
	const amounts = useReadContract({
		address: adapter,
		abi: adapterAbi,
		functionName: 'getAmountsForValuation',
		args: sqrt.data !== undefined ? [tokenId, sqrt.data] : undefined,
		chainId: net.chainId,
		query: {
			enabled: adapter !== zeroAddress && sqrt.data !== undefined,
		},
	});
	const s0 = resolveSymbol(token0, undefined, 'token0');
	const s1 = resolveSymbol(token1, undefined, 'token1');
	const d0 = resolveDecimals(token0);
	const d1 = resolveDecimals(token1);
	if (sqrt.isError || amounts.isError) {
		return <span className="muted">Unavailable</span>;
	}
	if (amounts.isLoading || sqrt.isLoading || !amounts.data) {
		return <LoadingText label="Amounts…" />;
	}
	const a0 = amounts.data[0];
	const a1 = amounts.data[1];
	return (
		<span className="underlying">
			<span>
				{d0 !== undefined ? formatAmount(a0, d0) : '—'} {s0}
			</span>
			<span>
				{d1 !== undefined ? formatAmount(a1, d1) : '—'} {s1}
			</span>
		</span>
	);
}

/** Closed / emptied LPs (0 liquidity or $0 preview value) stay hidden in the picker. */
export function isZeroValueLp(opts: {
	liquidity?: bigint;
	preview?: readonly unknown[];
	previewStatus?: string;
}): boolean {
	if (opts.liquidity === 0n) return true;
	if (opts.previewStatus === 'success' && opts.preview) {
		const valueUsd = opts.preview[3] as bigint | undefined;
		if (valueUsd === 0n) return true;
	}
	return false;
}

export function PositionRow({
	version,
	tokenId,
	fee,
	token0,
	token1,
	preview,
	previewStatus,
	previewLoading,
	selected,
	onSelect,
	compact = false,
}: {
	version: 0 | 1;
	tokenId: bigint;
	fee?: number | bigint;
	token0?: Address;
	token1?: Address;
	preview?: readonly unknown[];
	previewStatus?: string;
	previewLoading?: boolean;
	selected: boolean;
	onSelect: () => void;
	compact?: boolean;
}) {
	const net = useNetwork();
	const debtDec = debtTokenDecimals(net.addresses.debtAsset);
	const debtSym = resolveSymbol(net.addresses.debtAsset, undefined, 'USDC');
	const t0 = token0;
	const t1 = token1;
	/** previewBorrow: pairId, borrowAprBps, lenderApyBps, collateralValueUsd, maxBorrowUsdc, poolAvailable */
	const valueUsd = preview?.[3] as bigint | undefined;
	const maxBorrow = preview?.[4] as bigint | undefined;
	const poolAvailable = preview?.[5] as bigint | undefined;
	const eligible =
		previewStatus === 'success' && maxBorrow !== undefined && maxBorrow > 0n;
	const feeLabel = formatPoolFee(fee);
	const ltv = useReadContract({
		address: net.addresses.lendingModule,
		abi: marketLendingAbi,
		functionName: 'defaultLtvBps',
		chainId: net.chainId,
		query: { enabled: net.contractsConfigured && !compact },
	});
	let status = '—';
	let statusHint: string | undefined;
	if (previewStatus === 'failure') status = 'Unsupported';
	else if (eligible) status = 'Ready';
	else if (preview && poolAvailable === 0n) {
		status = 'No pool liquidity';
		statusHint = `No ${debtSym} has been supplied to this pool yet, so there is nothing to borrow. Try again once lenders deposit.`;
	} else if (preview && maxBorrow === 0n) {
		status = 'Value too low';
		statusHint = 'This position is worth too little to borrow against.';
	} else if (previewLoading) status = 'Checking…';

	return (
		<tr className={selected ? 'selected' : undefined}>
			<td data-label="Position">
				<div className="pos-cell">
					<div className="pos-cell-top">
						<TokenPair token0={t0} token1={t1} />
						{feeLabel ? (
							<span className="pos-fee">{feeLabel}</span>
						) : null}
					</div>
					<div className="pos-cell-sub">
						<span className="meta">NFT #{tokenId.toString()}</span>
						<span className="pos-chip">
							{version === 0 ? 'v3' : 'v4'}
						</span>
					</div>
				</div>
			</td>
			{!compact && (
				<td data-label="Tokens">
					<PositionUnderlying
						version={version}
						tokenId={tokenId}
						token0={t0}
						token1={t1}
					/>
				</td>
			)}
			<td data-label="Value">
				{previewLoading && valueUsd === undefined ? (
					<LoadingText />
				) : previewStatus === 'failure' ? (
					'—'
				) : (
					formatUsd8(valueUsd)
				)}
			</td>
			{!compact && (
				<td data-label="LTV">
					{ltv.data !== undefined ? formatBpsAsPct(Number(ltv.data)) : '—'}
				</td>
			)}
			<td data-label="Max borrow">
				{previewLoading && maxBorrow === undefined ? (
					<LoadingText />
				) : previewStatus === 'failure' ? (
					'—'
				) : maxBorrow === undefined ? (
					'—'
				) : (
					`${formatAmount(maxBorrow, debtDec)} ${debtSym}`
				)}
			</td>
			<td data-label="Status">
				<span
					className={`status-pill ${eligible ? 'ok' : 'muted'}`}
					title={statusHint}
				>
					{status}
				</span>
			</td>
			<td data-label="Action">
				<button type="button" className="btn ghost sm" onClick={onSelect}>
					{selected ? 'Selected' : 'Select'}
				</button>
			</td>
		</tr>
	);
}

export function WalletV4Nfts({
	address,
	selectedId,
	onSelect,
	marketFilter,
	onStatus,
	compact = false,
	refreshKey = 0,
}: {
	address?: `0x${string}`;
	selectedId?: bigint;
	onSelect: (id: string) => void;
	marketFilter?: AppMarket;
	onStatus?: (status: 'loading' | 'empty' | 'ready') => void;
	compact?: boolean;
	refreshKey?: number;
}) {
	const net = useNetwork();
	const client = usePublicClient({ chainId: net.chainId });
	const v4Npm = net.addresses.v4Npm;
	const idsQuery = useQuery({
		queryKey: ['v4-owned-nfts', net.chainId, v4Npm, address, refreshKey],
		enabled: !!address && !!client && v4Npm !== zeroAddress,
		staleTime: Infinity,
		gcTime: 30 * 60_000,
		refetchOnMount: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		queryFn: () => fetchOwnedV4Ids(client!, v4Npm, address as Address),
	});

	const tokenIds = (idsQuery.data ?? []).slice(0, WALLET_NFT_CAP);
	const details = useReadContracts({
		contracts: tokenIds.flatMap((tokenId) => [
			{
				address: v4Npm,
				abi: v4NpmAbi,
				functionName: 'getPoolAndPositionInfo' as const,
				args: [tokenId] as const,
				chainId: net.chainId,
			},
			{
				address: net.addresses.lendingModule,
				abi: marketLendingAbi,
				functionName: 'previewBorrow' as const,
				args: [1, tokenId] as const,
				chainId: net.chainId,
			},
		]),
		query: {
			enabled: tokenIds.length > 0 && net.contractsConfigured,
			placeholderData: keepPreviousData,
			staleTime: Infinity,
			refetchOnMount: false,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		},
		scopeKey: `v4-nft-details-${refreshKey}`,
	});

	const matchedCount = useMemo(() => {
		if (!details.data) return 0;
		return tokenIds.filter((_, i) => {
			const pos = details.data?.[i * 2];
			const prev = details.data?.[i * 2 + 1];
			const posOk = pos?.status === 'success' ? pos.result : undefined;
			const prevOk = prev?.status === 'success' ? prev.result : undefined;
			const poolKey =
				posOk && typeof posOk[0] === 'object' ? posOk[0] : undefined;
			if (
				marketFilter &&
				!matchesMarketPair(
					poolKey?.currency0 as Address | undefined,
					poolKey?.currency1 as Address | undefined,
					marketFilter,
				)
			) {
				return false;
			}
			return !isZeroValueLp({
				preview: prevOk,
				previewStatus: prev?.status,
			});
		}).length;
	}, [details.data, marketFilter, tokenIds]);

	const detailsPending =
		tokenIds.length > 0 &&
		details.data === undefined &&
		(details.isPending || details.isLoading);

	const status: 'loading' | 'empty' | 'ready' =
		!address || v4Npm === zeroAddress
			? 'empty'
			: (idsQuery.isPending || idsQuery.isLoading) && !idsQuery.data
			? 'loading'
			: !tokenIds.length
			? 'empty'
			: detailsPending
			? 'loading'
			: matchedCount > 0
			? 'ready'
			: 'empty';

	useEffect(() => {
		onStatus?.(status);
	}, [onStatus, status]);

	if (!address || v4Npm === zeroAddress) return null;
	if (status === 'loading') {
		return onStatus ? null : (
			<TableMessage>
				<LoadingText label="Scanning LP positions…" />
			</TableMessage>
		);
	}
	if (status === 'empty') return null;

	return (
		<>
			{tokenIds.map((tokenId, i) => {
				const pos = details.data?.[i * 2];
				const prev = details.data?.[i * 2 + 1];
				const posOk = pos?.status === 'success' ? pos.result : undefined;
				const prevOk = prev?.status === 'success' ? prev.result : undefined;
				const poolKey =
					posOk && typeof posOk[0] === 'object' ? posOk[0] : undefined;
				const t0 = poolKey?.currency0 as Address | undefined;
				const t1 = poolKey?.currency1 as Address | undefined;
				if (
					marketFilter &&
					details.data &&
					!matchesMarketPair(t0, t1, marketFilter)
				) {
					return null;
				}
				if (
					isZeroValueLp({
						preview: prevOk,
						previewStatus: prev?.status,
					})
				) {
					return null;
				}
				return (
					<PositionRow
						key={`v4-${tokenId.toString()}`}
						version={1}
						tokenId={tokenId}
						fee={poolKey?.fee}
						token0={t0}
						token1={t1}
						preview={prevOk}
						previewStatus={prev?.status}
						previewLoading={details.isLoading || details.isFetching}
						selected={selectedId === tokenId}
						onSelect={() => onSelect(tokenId.toString())}
						compact={compact}
					/>
				);
			})}
		</>
	);
}

export function WalletV3Nfts({
	address,
	selectedId,
	onSelect,
	marketFilter,
	onStatus,
	compact = false,
	refreshKey = 0,
}: {
	address?: `0x${string}`;
	selectedId?: bigint;
	onSelect: (id: string) => void;
	marketFilter?: AppMarket;
	onStatus?: (status: 'loading' | 'empty' | 'ready') => void;
	compact?: boolean;
	refreshKey?: number;
}) {
	const net = useNetwork();
	const balance = useReadContract({
		address: net.addresses.v3Npm,
		abi: erc721Abi,
		functionName: 'balanceOf',
		args: address ? [address] : undefined,
		chainId: net.chainId,
		scopeKey: `v3-nft-bal-${refreshKey}`,
		query: {
			enabled: !!address,
			staleTime: Infinity,
			refetchOnMount: false,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		},
	});

	const total = balance.data ?? 0n;
	const count =
		total > BigInt(WALLET_NFT_CAP) ? WALLET_NFT_CAP : Number(total);

	const idReads = useReadContracts({
		contracts:
			address && count > 0
				? Array.from({ length: count }, (_, i) => ({
						address: net.addresses.v3Npm,
						abi: erc721Abi,
						functionName: 'tokenOfOwnerByIndex' as const,
						args: [address, BigInt(i)] as const,
						chainId: net.chainId,
				  }))
				: [],
		scopeKey: `v3-nft-ids-${refreshKey}`,
		query: {
			enabled: !!address && count > 0,
			staleTime: Infinity,
			refetchOnMount: false,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		},
	});

	const tokenIds = useMemo(() => {
		const ids: bigint[] = [];
		for (const row of idReads.data ?? []) {
			if (row.status === 'success' && typeof row.result === 'bigint')
				ids.push(row.result);
		}
		return ids;
	}, [idReads.data]);

	const details = useReadContracts({
		contracts: tokenIds.flatMap((tokenId) => [
			{
				address: net.addresses.v3Npm,
				abi: v3NpmAbi,
				functionName: 'positions' as const,
				args: [tokenId] as const,
				chainId: net.chainId,
			},
			{
				address: net.addresses.lendingModule,
				abi: marketLendingAbi,
				functionName: 'previewBorrow' as const,
				args: [0, tokenId] as const,
				chainId: net.chainId,
			},
		]),
		scopeKey: `v3-nft-details-${refreshKey}`,
		query: {
			enabled: tokenIds.length > 0 && net.contractsConfigured,
			placeholderData: keepPreviousData,
			staleTime: Infinity,
			refetchOnMount: false,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		},
	});

	const matchedCount = useMemo(() => {
		if (!details.data) return 0;
		return tokenIds.filter((_, i) => {
			const pos = details.data?.[i * 2];
			const prev = details.data?.[i * 2 + 1];
			const posOk = pos?.status === 'success' ? pos.result : undefined;
			const prevOk = prev?.status === 'success' ? prev.result : undefined;
			const liquidity = posOk ? (posOk[7] as bigint) : undefined;
			if (
				marketFilter &&
				!matchesMarketPair(
					posOk ? (posOk[2] as Address) : undefined,
					posOk ? (posOk[3] as Address) : undefined,
					marketFilter,
				)
			) {
				return false;
			}
			return !isZeroValueLp({
				liquidity,
				preview: prevOk,
				previewStatus: prev?.status,
			});
		}).length;
	}, [details.data, marketFilter, tokenIds]);

	const detailsPending =
		tokenIds.length > 0 &&
		details.data === undefined &&
		(details.isPending || details.isLoading);

	const status: 'loading' | 'empty' | 'ready' = !address
		? 'empty'
		: (balance.isPending || balance.isLoading) && balance.data === undefined
		? 'loading'
		: balance.isError
		? 'empty'
		: total === 0n
		? 'empty'
		: (idReads.isPending || idReads.isLoading) && !idReads.data && count > 0
		? 'loading'
		: idReads.isError || (count > 0 && tokenIds.length === 0)
		? 'empty'
		: detailsPending
		? 'loading'
		: matchedCount > 0
		? 'ready'
		: 'empty';

	useEffect(() => {
		onStatus?.(status);
	}, [onStatus, status]);

	if (!address) return null;
	if (status === 'loading') {
		return onStatus ? null : (
			<TableMessage>
				<LoadingText label="Scanning LP positions…" />
			</TableMessage>
		);
	}
	if (status === 'empty') return null;

	return (
		<>
			{tokenIds.map((tokenId, i) => {
				const pos = details.data?.[i * 2];
				const prev = details.data?.[i * 2 + 1];
				const posOk = pos?.status === 'success' ? pos.result : undefined;
				const prevOk = prev?.status === 'success' ? prev.result : undefined;
				const t0 = posOk ? (posOk[2] as Address) : undefined;
				const t1 = posOk ? (posOk[3] as Address) : undefined;
				const liquidity = posOk ? (posOk[7] as bigint) : undefined;
				if (
					marketFilter &&
					details.data &&
					!matchesMarketPair(t0, t1, marketFilter)
				) {
					return null;
				}
				if (
					isZeroValueLp({
						liquidity,
						preview: prevOk,
						previewStatus: prev?.status,
					})
				) {
					return null;
				}
				return (
					<PositionRow
						key={`v3-${tokenId.toString()}`}
						version={0}
						tokenId={tokenId}
						fee={posOk ? posOk[4] : undefined}
						token0={t0}
						token1={t1}
						preview={prevOk}
						previewStatus={prev?.status}
						previewLoading={details.isLoading || details.isFetching}
						selected={selectedId === tokenId}
						onSelect={() => onSelect(tokenId.toString())}
						compact={compact}
					/>
				);
			})}
		</>
	);
}
