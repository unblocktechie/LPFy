import { useEffect, useMemo, useState } from 'react';
import {
	encodeFunctionData,
	parseUnits,
	zeroAddress,
	type Address,
} from 'viem';
import { useReadContract } from 'wagmi';
import {
	erc721Abi,
	marketLendingAbi,
	v3NpmAbi,
	v4NpmAbi,
} from '../../abi';
import { AmountField } from '../../components/AmountField';
import { LoadingText, MaybeLoading, Spinner } from '../../components/Loader';
import { cappedBorrowAmount, toInputAmount } from '../../lib/amounts';
import {
	debtAmountToUsd8,
	formatAmount,
	formatUsd8,
	shortAddr,
} from '../../lib/format';
import { useNetwork } from '../../lib/networkContext';
import type { AppMarket } from '../../lib/networks';
import {
	debtTokenDecimals,
	formatBpsAsPct,
	resolveSymbol,
} from '../../lib/tokens';
import { decodeV4PositionInfo } from '../../lib/v4Position';
import { useTxAction, useTxScope, TxStatus, type TxCall } from '../../hooks/tx';
import {
	TableMessage,
	WalletV3Nfts,
	WalletV4Nfts,
} from '../positions/positions';

export function DepositPanel({
	connected,
	address,
	marketFilter,
	compact = false,
}: {
	connected: boolean;
	address?: `0x${string}`;
	marketFilter?: AppMarket;
	compact?: boolean;
}) {
	const net = useNetwork();
	const txScope = useTxScope();
	const debtDec = debtTokenDecimals(net.addresses.debtAsset);
	const debtSym = resolveSymbol(net.addresses.debtAsset, undefined, 'USDC');
	const [version, setVersion] = useState<0 | 1>(0);
	const [tokenId, setTokenId] = useState('');
	const [borrowAmt, setBorrowAmt] = useState('');
	const [filter, setFilter] = useState<'all' | 'v3' | 'v4'>('all');
	const [lockedLocal, setLockedLocal] = useState(false);
	const [v3Status, setV3Status] = useState<'loading' | 'empty' | 'ready'>(
		'loading',
	);
	const [v4Status, setV4Status] = useState<'loading' | 'empty' | 'ready'>(
		'loading',
	);
	const [nftScanKey, setNftScanKey] = useState(0);
	const id = tokenId ? BigInt(tokenId) : undefined;
	const npm = version === 0 ? net.addresses.v3Npm : net.addresses.v4Npm;
	const adapter =
		version === 0 ? net.addresses.v3Adapter : net.addresses.v4Adapter;
	const { sendBatch, busy, status, isError } = useTxAction();

	useEffect(() => {
		setLockedLocal(false);
	}, [tokenId, version]);

	useEffect(() => {
		setTokenId('');
		setBorrowAmt('');
		setV3Status('loading');
		setV4Status('loading');
	}, [marketFilter?.id, address]);

	const showV3 = filter === 'all' || filter === 'v3';
	const showV4 = filter === 'all' || filter === 'v4';

	useEffect(() => {
		if (!showV3) setV3Status('empty');
		if (!showV4) setV4Status('empty');
	}, [showV3, showV4]);

	const refreshLpNfts = () => {
		if (showV3) setV3Status('loading');
		if (showV4) setV4Status('loading');
		setNftScanKey((k) => k + 1);
	};

	const hasReady =
		(showV3 && v3Status === 'ready') || (showV4 && v4Status === 'ready');
	const scanning =
		!!address &&
		!hasReady &&
		((showV3 && v3Status === 'loading') ||
			(showV4 && v4Status === 'loading'));
	const noCollateral =
		!!address &&
		!scanning &&
		(!showV3 || v3Status === 'empty') &&
		(!showV4 || v4Status === 'empty');

	const posV3 = useReadContract({
		address: npm,
		abi: v3NpmAbi,
		functionName: 'positions',
		args: id !== undefined ? [id] : undefined,
		chainId: net.chainId,
		query: { enabled: version === 0 && id !== undefined },
	});

	const posV4 = useReadContract({
		address: npm,
		abi: v4NpmAbi,
		functionName: 'getPoolAndPositionInfo',
		args: id !== undefined ? [id] : undefined,
		chainId: net.chainId,
		query: {
			enabled: version === 1 && id !== undefined && npm !== zeroAddress,
		},
	});

	const owner = useReadContract({
		address: npm,
		abi: erc721Abi,
		functionName: 'ownerOf',
		args: id !== undefined ? [id] : undefined,
		chainId: net.chainId,
		scopeKey: txScope,
		query: { enabled: id !== undefined && npm !== zeroAddress, staleTime: 0 },
	});

	const preview = useReadContract({
		address: net.addresses.lendingModule,
		abi: marketLendingAbi,
		functionName: 'previewBorrow',
		args: id !== undefined ? [version, id] : undefined,
		chainId: net.chainId,
		scopeKey: txScope,
		query: {
			enabled: net.contractsConfigured && id !== undefined,
			staleTime: 0,
		},
	});

	/** If V4 preview fails, check whether the same id works as V3 (common mistake). */
	const previewAltV3 = useReadContract({
		address: net.addresses.lendingModule,
		abi: marketLendingAbi,
		functionName: 'previewBorrow',
		args: id !== undefined ? [0, id] : undefined,
		chainId: net.chainId,
		scopeKey: txScope,
		query: {
			enabled:
				net.contractsConfigured &&
				id !== undefined &&
				version === 1 &&
				preview.isError,
			staleTime: 0,
		},
	});

	const approved = useReadContract({
		address: npm,
		abi: erc721Abi,
		functionName: 'getApproved',
		args: id !== undefined ? [id] : undefined,
		chainId: net.chainId,
		scopeKey: txScope,
		query: { enabled: id !== undefined && npm !== zeroAddress, staleTime: 0 },
	});

	const approvedForAll = useReadContract({
		address: npm,
		abi: erc721Abi,
		functionName: 'isApprovedForAll',
		args: address && adapter !== zeroAddress ? [address, adapter] : undefined,
		chainId: net.chainId,
		query: { enabled: !!address && adapter !== zeroAddress },
	});

	const pair = useMemo(() => {
		if (version === 0 && posV3.data) {
			return `${shortAddr(posV3.data[2])} / ${shortAddr(
				posV3.data[3],
			)} · fee ${posV3.data[4]}`;
		}
		if (version === 1 && posV4.data) {
			const key = posV4.data[0];
			const ticks = decodeV4PositionInfo(posV4.data[1] as bigint);
			const s0 = resolveSymbol(
				key.currency0 as Address,
				undefined,
				'token0',
			);
			const s1 = resolveSymbol(
				key.currency1 as Address,
				undefined,
				'token1',
			);
			return `${s0} / ${s1} · fee ${key.fee} · ticks ${ticks.tickLower}→${ticks.tickUpper}`;
		}
		return 'Enter a tokenId to inspect the NFT';
	}, [version, posV3.data, posV4.data]);

	function nftApproveCall(): TxCall | undefined {
		if (id === undefined) return undefined;
		return {
			to: npm,
			data: encodeFunctionData({
				abi: erc721Abi,
				functionName: 'approve',
				args: [adapter, id],
			}),
		};
	}

	function lockNft(borrow: bigint) {
		if (id === undefined) return;
		if (nftHeldByAdapter) return;
		const calls: TxCall[] = [];
		if (!nftApproved) {
			const approveCall = nftApproveCall();
			if (approveCall) calls.push(approveCall);
		}
		calls.push({
			to: net.addresses.lendingModule,
			data: encodeFunctionData({
				abi: marketLendingAbi,
				functionName: 'borrowWithCollateral',
				args: [version, id, borrow],
			}),
		});
		void sendBatch(calls, {
			successNote: 'Loan opened — manage it in Assets.',
		}).then((ok) => {
			if (!ok) return;
			// Clear selection immediately so post-borrow owner===adapter
			// does not flash "Already deposited" on this form.
			setTokenId('');
			setBorrowAmt('');
			setLockedLocal(false);
		});
	}

	const nftApproved =
		adapter !== zeroAddress &&
		(approved.data?.toLowerCase() === adapter.toLowerCase() ||
			approvedForAll.data === true);
	/** NFT already custody'd by the adapter (active or stuck loan). */
	const nftHeldByAdapter =
		!!owner.data &&
		adapter !== zeroAddress &&
		owner.data.toLowerCase() === adapter.toLowerCase();
	/**
	 * Block a new borrow only when not mid-flight. While approve+borrow
	 * are confirming, owner flips to the adapter — that is success, not an error.
	 */
	const alreadyLocked = !busy && (lockedLocal || nftHeldByAdapter);
	/** previewBorrow: pairId, borrowAprBps, lenderApyBps, collateralValueUsd, maxBorrowUsdc, poolAvailable */
	const maxBorrow = preview.data?.[4];
	const poolAvailable = preview.data?.[5];
	const borrowAprBps = preview.data?.[1];
	const collateralUsd = preview.data?.[3];
	const dustCollateral =
		collateralUsd !== undefined && collateralUsd < 1_000_000n; // < $0.01 (1e8 scale)
	const cappedBorrow = cappedBorrowAmount(borrowAmt, maxBorrow, debtDec);
	const borrowOverMax = cappedBorrow.overMax;

	useEffect(() => {
		if (maxBorrow === undefined || !borrowAmt) return;
		const rounded = formatAmount(maxBorrow, debtDec).replace(/,/g, '');
		const norm = borrowAmt.trim().replace(/,/g, '');
		if (!rounded || rounded === '—' || rounded.startsWith('<')) return;
		if (norm !== rounded) return;
		try {
			if (parseUnits(rounded, debtDec) <= maxBorrow) return;
		} catch {
			return;
		}
		setBorrowAmt(toInputAmount(maxBorrow, debtDec));
	}, [borrowAmt, debtDec, maxBorrow]);

	function depositBorrow() {
		if (cappedBorrow.amount === undefined || cappedBorrow.amount <= 0n)
			return;
		lockNft(cappedBorrow.amount);
	}
	const borrowZeroPool = poolAvailable !== undefined && poolAvailable === 0n;
	const wrongProtocolHint =
		version === 1 && preview.isError && previewAltV3.isSuccess;

	return (
		<div className={compact ? 'md-borrow-panel' : 'deposit-flow'}>
			{!marketFilter && !compact && (
				<div className="page-head">
					<div>
						<p className="eyebrow">Borrower</p>
						<h2>Borrow with LP NFT</h2>
						<p className="meta">
							Post a supported DEX LP NFT as collateral and borrow{' '}
							{debtSym}. Interest accrues at the pair borrow APR. Pair
							must be enabled on-chain.
						</p>
					</div>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 8,
							width: '100%',
							flex: 1,
						}}
					>
						<div
							className="seg"
							role="tablist"
							aria-label="Protocol filter"
						>
							{(
								[
									['all', 'All'],
									['v3', 'V3'],
									['v4', 'V4'],
								] as const
							).map(([id, label]) => (
								<button
									key={id}
									type="button"
									role="tab"
									aria-selected={filter === id}
									className={filter === id ? 'on' : ''}
									onClick={() => setFilter(id)}
								>
									{label}
								</button>
							))}
						</div>
						{address ? (
							<button
								type="button"
								className="btn ghost sm"
								disabled={scanning}
								onClick={refreshLpNfts}
								style={{ marginLeft: 'auto' }}
							>
								{scanning ? 'Scanning…' : 'Refresh'}
							</button>
						) : null}
					</div>
				</div>
			)}
			{marketFilter && (
				<div
					className={compact ? 'md-borrow-head' : 'page-head'}
					style={compact ? undefined : { marginBottom: 12 }}
				>
					{!compact && (
						<div>
							<p className="eyebrow">Your LP NFTs for this pair</p>
							<h3>Select collateral</h3>
							<p className="meta">
								Only positions matching {marketFilter.pair} are listed.
							</p>
						</div>
					)}
					{compact && (
						<p className="meta" style={{ margin: '0 0 8px' }}>
							Choose an LP NFT for {marketFilter.pair}
						</p>
					)}
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 8,
							width: '100%',
						}}
					>
						<div
							className="seg"
							role="tablist"
							aria-label="Protocol filter"
						>
							{(
								[
									['all', 'All'],
									['v3', 'V3'],
									['v4', 'V4'],
								] as const
							).map(([id, label]) => (
								<button
									key={id}
									type="button"
									role="tab"
									aria-selected={filter === id}
									className={filter === id ? 'on' : ''}
									onClick={() => setFilter(id)}
								>
									{label}
								</button>
							))}
						</div>
						{address ? (
							<button
								type="button"
								className="btn ghost sm"
								disabled={scanning}
								onClick={refreshLpNfts}
								style={{ marginLeft: 'auto' }}
							>
								{scanning ? 'Scanning…' : 'Refresh'}
							</button>
						) : null}
					</div>
				</div>
			)}
			<div className={compact ? 'md-nft-scroll' : 'pos-table-wrap'}>
				<table
					className={`data-table pos-table${
						compact ? ' md-nft-table' : ''
					}`}
				>
					<thead>
						<tr>
							<th>Position</th>
							{!compact && <th>Tokens</th>}
							<th>Value</th>
							{!compact && <th>LTV</th>}
							<th>Max borrow</th>
							<th>Status</th>
							<th>Action</th>
						</tr>
					</thead>
					<tbody>
						{!address ? (
							<TableMessage colSpan={compact ? 5 : 7}>
								Connect a wallet to load LP NFTs.
							</TableMessage>
						) : (
							<>
								{showV3 && (
									<WalletV3Nfts
										address={address}
										selectedId={version === 0 ? id : undefined}
										marketFilter={marketFilter}
										compact={compact}
										refreshKey={nftScanKey}
										onStatus={setV3Status}
										onSelect={(nftId) => {
											setVersion(0);
											setTokenId(nftId);
										}}
									/>
								)}
								{showV4 && (
									<WalletV4Nfts
										address={address}
										selectedId={version === 1 ? id : undefined}
										marketFilter={marketFilter}
										compact={compact}
										refreshKey={nftScanKey}
										onStatus={setV4Status}
										onSelect={(nftId) => {
											setVersion(1);
											setTokenId(nftId);
										}}
									/>
								)}
								{scanning && (
									<TableMessage colSpan={compact ? 5 : 7}>
										<LoadingText label="Scanning LP positions…" />
									</TableMessage>
								)}
								{noCollateral && (
									<TableMessage colSpan={compact ? 5 : 7}>
										No collateral available.
									</TableMessage>
								)}
							</>
						)}
					</tbody>
				</table>
			</div>
			{compact ? (
				<div className="md-borrow-form-grid">
					<div className="md-borrow-form">
						{!id ? (
							<p className="md-borrow-empty">
								Select an LP NFT above to borrow.
							</p>
						) : (
							<>
								<div className="md-borrow-selected">
									<strong>
										{version === 0 ? 'v3' : 'v4'} #{tokenId}
									</strong>
									<span className="meta">
										{maxBorrow !== undefined
											? `Max ${toInputAmount(
													maxBorrow,
													debtDec,
											  )} ${debtSym}`
											: preview.isLoading
											? 'Loading…'
											: '—'}
										{borrowAprBps !== undefined
											? ` · ${formatBpsAsPct(
													Number(borrowAprBps),
											  )} APR`
											: ''}
									</span>
								</div>
								<label>
									Amount ({debtSym})
									<AmountField
										value={borrowAmt}
										onChange={setBorrowAmt}
										disabled={busy || alreadyLocked}
										max={maxBorrow}
										decimals={debtDec}
										capToMax
									/>
								</label>
								{alreadyLocked && (
									<p className="meta">
										This NFT is already posted as collateral — manage
										the loan in Assets.
									</p>
								)}
								{busy && nftHeldByAdapter && (
									<p className="meta">
										Collateral locked — finishing borrow…
									</p>
								)}
								{borrowOverMax && (
									<p className="meta bad">Above max borrowable.</p>
								)}
								{dustCollateral && !preview.isError && (
									<p className="meta bad">
										LP value near $0 — add liquidity first.
									</p>
								)}
								{borrowZeroPool && (
									<p className="meta bad">
										Pool has no cash to borrow.
									</p>
								)}
								{preview.isError && (
									<p className="meta bad">
										{wrongProtocolHint
											? 'Preview failed — try the other protocol (v3/v4).'
											: (preview.error as { shortMessage?: string })
													?.shortMessage ||
											  preview.error?.message ||
											  'Preview failed.'}
									</p>
								)}
								<div className="md-borrow-actions">
									<button
										className="btn ghost"
										type="button"
										disabled={busy}
										onClick={() => {
											setTokenId('');
											setBorrowAmt('');
										}}
									>
										Clear
									</button>
									<button
										className="btn"
										disabled={
											!connected ||
											!id ||
											!borrowAmt ||
											busy ||
											alreadyLocked ||
											borrowOverMax ||
											borrowZeroPool ||
											net.addresses.debtAsset === zeroAddress ||
											!net.contractsConfigured
										}
										onClick={depositBorrow}
									>
										{busy
											? 'Borrowing…'
											: alreadyLocked
											? 'Open in Assets'
											: nftApproved
											? `Borrow ${debtSym}`
											: `Approve & borrow ${debtSym}`}
									</button>
								</div>
								<TxStatus
									busy={busy}
									status={status}
									isError={isError}
								/>
							</>
						)}
					</div>
					<aside className="md-borrow-value">
						<div className="md-borrow-value-title">Valuation</div>
						{!id ? (
							<p className="md-borrow-empty">
								Select an NFT to load details.
							</p>
						) : preview.isLoading && !preview.data ? (
							<p className="md-borrow-empty">
								<LoadingText label="Loading…" />
							</p>
						) : (
							<>
								<div className="md-kv">
									<span>Value</span>
									<strong>
										{collateralUsd !== undefined
											? formatUsd8(collateralUsd)
											: '—'}
									</strong>
								</div>
								<div className="md-kv">
									<span>Max borrow</span>
									<strong>
										{maxBorrow !== undefined
											? `${toInputAmount(
													maxBorrow,
													debtDec,
											  )} ${debtSym}`
											: '—'}
									</strong>
								</div>
								<div className="md-kv">
									<span>Borrow APR</span>
									<strong>
										{borrowAprBps !== undefined
											? formatBpsAsPct(Number(borrowAprBps))
											: '—'}
									</strong>
								</div>
								<div className="md-kv">
									<span>Pool room</span>
									<strong>
										{poolAvailable !== undefined
											? `${formatAmount(
													poolAvailable,
													debtDec,
											  )} ${debtSym}`
											: '—'}
									</strong>
								</div>
								{preview.isError && (
									<p className="meta bad" style={{ marginTop: 8 }}>
										Valuation unavailable.
									</p>
								)}
							</>
						)}
					</aside>
				</div>
			) : (
				<div className="split">
					<div className="card form">
						<div className="eyebrow">Selected NFT</div>
						{!id ? (
							<>
								<h3>Pick a position</h3>
								<p className="meta">
									Select an LP NFT from the table above to borrow{' '}
									{debtSym}.
								</p>
							</>
						) : (
							<>
								<h3>
									{version === 0 ? 'v3' : 'v4'} #{tokenId}
								</h3>
								<p className="meta">{pair}</p>
								<label>
									Borrow amount ({debtSym})
									<AmountField
										value={borrowAmt}
										onChange={setBorrowAmt}
										disabled={busy || alreadyLocked}
										max={maxBorrow}
										decimals={debtDec}
										capToMax
									/>
								</label>
								{maxBorrow !== undefined && (
									<p className="meta">
										Max{' '}
										{toInputAmount(maxBorrow, debtDec)}{' '}
										{debtSym} ≈{' '}
										{formatUsd8(
											debtAmountToUsd8(maxBorrow, debtDec),
										)}
										{borrowAprBps !== undefined
											? ` · ${formatBpsAsPct(
													Number(borrowAprBps),
											  )} APR`
											: ''}
									</p>
								)}
								{alreadyLocked && (
									<p className="meta">
										This NFT is already posted as collateral. Manage
										the loan from Assets.
									</p>
								)}
								{busy && nftHeldByAdapter && (
									<p className="meta">
										Collateral locked — finishing borrow…
									</p>
								)}
								{borrowOverMax && (
									<p className="meta bad">
										Amount is above max borrowable.
									</p>
								)}
								{dustCollateral && !preview.isError && (
									<p className="meta bad">
										This LP is valued near $0. Add more liquidity
										first.
									</p>
								)}
								{borrowZeroPool && (
									<p className="meta bad">
										Pool has no borrowable cash.
									</p>
								)}
								{preview.isError && !wrongProtocolHint && (
									<p className="meta bad">
										{(preview.error as { shortMessage?: string })
											?.shortMessage ||
											preview.error?.message ||
											'Preview failed.'}
									</p>
								)}
								{wrongProtocolHint && (
									<p className="meta bad">
										Preview failed for v4 — this id may be a v3
										position.
									</p>
								)}
								<div className="actions">
									<button
										className="btn ghost"
										type="button"
										disabled={busy}
										onClick={() => {
											setTokenId('');
											setBorrowAmt('');
										}}
									>
										Clear
									</button>
									<button
										className="btn"
										disabled={
											!connected ||
											!id ||
											!borrowAmt ||
											busy ||
											alreadyLocked ||
											borrowOverMax ||
											borrowZeroPool ||
											net.addresses.debtAsset === zeroAddress ||
											!net.contractsConfigured
										}
										onClick={depositBorrow}
									>
										{busy
											? 'Borrowing…'
											: alreadyLocked
											? 'Open in Assets'
											: nftApproved
											? `Borrow ${debtSym}`
											: `Approve & borrow ${debtSym}`}
									</button>
								</div>
								<TxStatus
									busy={busy}
									status={status}
									isError={isError}
								/>
							</>
						)}
					</div>
					<aside className="card snapshot">
						<div className="eyebrow">Valuation</div>
						<h3>Position</h3>
						{!id ? (
							<p className="meta">Select an NFT to load valuation.</p>
						) : preview.isLoading && !preview.data ? (
							<div className="loading-panel" style={{ minHeight: 140 }}>
								<Spinner size={24} />
								<strong>Loading valuation…</strong>
							</div>
						) : (
							<>
								<p className="meta">
									{preview.isError
										? (preview.error as { shortMessage?: string })
												?.shortMessage ||
										  preview.error?.message ||
										  'Valuation failed.'
										: preview.data
										? 'Max borrow = min(LTV, pool available).'
										: 'Reading position…'}
								</p>
								<div className="row">
									<span>Oracle USD</span>
									<strong>
										<MaybeLoading
											loading={
												preview.isLoading || preview.isFetching
											}
										>
											{collateralUsd !== undefined
												? formatUsd8(collateralUsd)
												: undefined}
										</MaybeLoading>
									</strong>
								</div>
								<div className="row">
									<span>Borrow APR</span>
									<strong>
										{borrowAprBps !== undefined
											? formatBpsAsPct(Number(borrowAprBps))
											: '—'}
									</strong>
								</div>
								<div className="row">
									<span>Max borrow</span>
									<strong>
										<MaybeLoading
											loading={
												preview.isLoading || preview.isFetching
											}
										>
											{maxBorrow !== undefined
												? `${toInputAmount(
														maxBorrow,
														debtDec,
												  )} ${debtSym} ≈ ${formatUsd8(
														debtAmountToUsd8(
															maxBorrow,
															debtDec,
														),
												  )}`
												: undefined}
										</MaybeLoading>
									</strong>
								</div>
							</>
						)}
					</aside>
				</div>
			)}
		</div>
	);
}
