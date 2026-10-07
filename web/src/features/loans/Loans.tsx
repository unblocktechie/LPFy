import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
	encodeFunctionData,
	maxUint256,
	parseAbiItem,
	parseUnits,
	zeroAddress,
	type Address,
	type Hex,
	type PublicClient,
} from 'viem';
import {
	usePublicClient,
	useReadContract,
	useReadContracts,
} from 'wagmi';
import {
	adapterAbi,
	erc20Abi,
	marketLendingAbi,
	pairVaultAbi,
} from '../../abi';
import { AmountField } from '../../components/AmountField';
import { LoadingText, Spinner } from '../../components/Loader';
import { TokenPair } from '../../components/TokenPair';
import { formatAmount, shortAddr } from '../../lib/format';
import { useNetwork } from '../../lib/networkContext';
import { allMarketPairIds, marketPoolIds } from '../../lib/pairId';
import {
	debtTokenDecimals,
	formatBpsAsPct,
	resolveSymbol,
} from '../../lib/tokens';
import { useTxAction, useTxScope, TxStatus, type TxCall } from '../../hooks/tx';

const VAULT_DEPOSIT_EVENT = parseAbiItem(
	'event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)',
);
const VAULT_WITHDRAW_EVENT = parseAbiItem(
	'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
);

/** Average-cost basis remaining in each pair, from ERC-4626 vault Deposit/Withdraw. */
async function fetchLenderCostByPair(
	client: PublicClient,
	vaultByPair: Map<string, Address>,
	lender: Address,
): Promise<Map<string, bigint>> {
	const latest = await client.getBlockNumber();
	const lookback = 800_000n;
	let from = latest > lookback ? latest - lookback : 0n;
	const span = 9_000n;
	type Row = {
		pairId: Hex;
		block: bigint;
		index: number;
		kind: 'in' | 'out';
		assets: bigint;
		shares: bigint;
	};
	const rows: Row[] = [];
	const vaultEntries = [...vaultByPair.entries()].filter(
		([, v]) => v && v !== zeroAddress,
	);
	if (vaultEntries.length === 0) return new Map();

	while (from <= latest) {
		const to = from + span > latest ? latest : from + span;
		try {
			const logs = await Promise.all(
				vaultEntries.flatMap(([pairId, vault]) => [
					client
						.getLogs({
							address: vault,
							event: VAULT_DEPOSIT_EVENT,
							args: { owner: lender },
							fromBlock: from,
							toBlock: to,
						})
						.then((ins) => ({ pairId: pairId as Hex, kind: 'in' as const, logs: ins })),
					client
						.getLogs({
							address: vault,
							event: VAULT_WITHDRAW_EVENT,
							args: { owner: lender },
							fromBlock: from,
							toBlock: to,
						})
						.then((outs) => ({ pairId: pairId as Hex, kind: 'out' as const, logs: outs })),
				]),
			);
			for (const batch of logs) {
				for (const log of batch.logs) {
					rows.push({
						pairId: batch.pairId,
						block: log.blockNumber ?? 0n,
						index: log.logIndex ?? 0,
						kind: batch.kind,
						assets: log.args.assets ?? 0n,
						shares: log.args.shares ?? 0n,
					});
				}
			}
		} catch {
			/* skip window */
		}
		from = to + 1n;
	}
	rows.sort((a, b) => {
		if (a.block === b.block) return a.index - b.index;
		return a.block < b.block ? -1 : 1;
	});
	const acc = new Map<string, { shares: bigint; cost: bigint }>();
	for (const row of rows) {
		const key = row.pairId.toLowerCase();
		const cur = acc.get(key) ?? { shares: 0n, cost: 0n };
		if (row.kind === 'in') {
			cur.shares += row.shares;
			cur.cost += row.assets;
		} else if (cur.shares > 0n) {
			const take = (cur.cost * row.shares) / cur.shares;
			cur.cost = cur.cost > take ? cur.cost - take : 0n;
			cur.shares = cur.shares > row.shares ? cur.shares - row.shares : 0n;
		}
		acc.set(key, cur);
	}
	const out = new Map<string, bigint>();
	for (const [k, v] of acc) out.set(k, v.cost);
	return out;
}

export function Loans({ address }: { address?: `0x${string}` }) {
	const net = useNetwork();
	const txScope = useTxScope();
	const publicClient = usePublicClient({ chainId: net.chainId });
	const debtDec = debtTokenDecimals(net.addresses.debtAsset);
	const debtSym = resolveSymbol(net.addresses.debtAsset, undefined, 'USDC');
	const ids = useReadContract({
		address: net.addresses.lendingModule,
		abi: marketLendingAbi,
		functionName: 'getBorrowerLoans',
		args: address ? [address] : undefined,
		chainId: net.chainId,
		scopeKey: txScope,
		query: { enabled: net.contractsConfigured && !!address, staleTime: 0 },
	});
	const pairIds = useMemo(() => allMarketPairIds(net.markets), [net.markets]);
	const vaultOfReads = useReadContracts({
		contracts: pairIds.map((pid) => ({
			address: net.addresses.lendingModule,
			abi: marketLendingAbi,
			functionName: 'vaultOf' as const,
			args: [pid] as const,
			chainId: net.chainId,
		})),
		query: {
			enabled: net.contractsConfigured && pairIds.length > 0,
			staleTime: 0,
		},
		scopeKey: txScope,
	});
	const vaultAddrs = useMemo(() => {
		return pairIds.map((pid, i) => {
			const onChain = vaultOfReads.data?.[i];
			if (onChain?.status === 'success') {
				const v = onChain.result as Address;
				if (v && v !== zeroAddress) return v;
			}
			const market = net.markets.find((m) => marketPoolIds(m).primary === pid);
			const configured = market?.vault as Address | undefined;
			return configured && configured !== zeroAddress ? configured : zeroAddress;
		});
	}, [pairIds, vaultOfReads.data, net.markets]);
	const supplyReads = useReadContracts({
		contracts: pairIds.flatMap((pid, i) => {
			const vault = vaultAddrs[i];
			return [
				{
					address: vault,
					abi: pairVaultAbi,
					functionName: 'balanceOf' as const,
					args: address ? ([address] as const) : undefined,
					chainId: net.chainId,
				},
				{
					address: net.addresses.lendingModule,
					abi: marketLendingAbi,
					functionName: 'getLenderApyBps' as const,
					args: [pid] as const,
					chainId: net.chainId,
				},
			];
		}),
		query: {
			enabled:
				net.contractsConfigured &&
				!!address &&
				pairIds.length > 0 &&
				vaultAddrs.some((v) => v !== zeroAddress),
			staleTime: 0,
		},
		scopeKey: txScope,
	});
	const assetsReads = useReadContracts({
		contracts: pairIds.map((_, i) => {
			const sharesRow = supplyReads.data?.[i * 2];
			const shares =
				sharesRow?.status === 'success' ? (sharesRow.result as bigint) : 0n;
			return {
				address: vaultAddrs[i],
				abi: pairVaultAbi,
				functionName: 'convertToAssets' as const,
				args: [shares] as const,
				chainId: net.chainId,
			};
		}),
		query: {
			enabled:
				net.contractsConfigured &&
				!!address &&
				pairIds.length > 0 &&
				!!supplyReads.data &&
				vaultAddrs.some((v) => v !== zeroAddress),
			staleTime: 0,
		},
		scopeKey: txScope,
	});
	const supplyRows = useMemo(() => {
		return pairIds
			.map((pid, i) => {
				const sharesRow = supplyReads.data?.[i * 2];
				const apyRow = supplyReads.data?.[i * 2 + 1];
				const assetsRow = assetsReads.data?.[i];
				const shares =
					sharesRow?.status === 'success'
						? (sharesRow.result as bigint)
						: undefined;
				const assets =
					assetsRow?.status === 'success'
						? (assetsRow.result as bigint)
						: undefined;
				const apyBps =
					apyRow?.status === 'success' ? Number(apyRow.result) : undefined;
				const market = net.markets.find((m) => {
					const p = marketPoolIds(m);
					return p.primary === pid;
				});
				const label = market?.pair ?? shortAddr(pid);
				return { pid, shares, assets, apyBps, label };
			})
			.filter((r) => r.shares !== undefined && r.shares > 0n);
	}, [pairIds, supplyReads.data, assetsReads.data, net.markets]);
	const vaultByPair = useMemo(() => {
		const m = new Map<string, Address>();
		pairIds.forEach((pid, i) => {
			const v = vaultAddrs[i];
			if (v && v !== zeroAddress) m.set(pid.toLowerCase(), v);
		});
		return m;
	}, [pairIds, vaultAddrs]);
	const costQuery = useQuery({
		queryKey: [
			'lender-cost',
			net.chainId,
			[...vaultByPair.entries()],
			address,
			txScope,
		],
		enabled:
			!!publicClient &&
			net.contractsConfigured &&
			!!address &&
			vaultByPair.size > 0,
		queryFn: () =>
			fetchLenderCostByPair(publicClient!, vaultByPair, address!),
		staleTime: 15_000,
	});

	const supplyRowsWithIncome = useMemo(() => {
		return supplyRows.map((r) => {
			const cost = costQuery.data?.get(r.pid.toLowerCase());
			let income: bigint | undefined;
			if (r.assets === undefined) income = undefined;
			else if (cost !== undefined) {
				income = r.assets > cost ? r.assets - cost : 0n;
			} else if (r.shares !== undefined) {
				income = r.assets > r.shares ? r.assets - r.shares : 0n;
			}
			const principal =
				r.assets !== undefined && income !== undefined
					? r.assets > income
						? r.assets - income
						: 0n
					: undefined;
			return { ...r, income, principal };
		});
	}, [supplyRows, costQuery.data]);

	const totalSupplied = useMemo(() => {
		let sum = 0n;
		for (const r of supplyRowsWithIncome) {
			if (r.assets !== undefined) sum += r.assets;
		}
		return supplyRowsWithIncome.length ? sum : undefined;
	}, [supplyRowsWithIncome]);

	const totalIncome = useMemo(() => {
		let sum = 0n;
		let any = false;
		for (const r of supplyRowsWithIncome) {
			if (r.income !== undefined) {
				sum += r.income;
				any = true;
			}
		}
		return any ? sum : undefined;
	}, [supplyRowsWithIncome]);
	const [openLoanId, setOpenLoanId] = useState<string | null>(null);
	const [busyLoanId, setBusyLoanId] = useState<string | null>(null);

	const page = (
		<div className="page-head">
			<div>
				<p className="eyebrow">Portfolio</p>
				<h2>Assets</h2>
				<p className="meta">Your deposits and loans across all markets.</p>
			</div>
		</div>
	);

	if (!address)
		return (
			<div className="assets-page">
				{page}
				<div className="empty">Connect a wallet to view your assets.</div>
			</div>
		);
	if (!net.contractsConfigured)
		return (
			<div className="assets-page">
				{page}
				<div className="empty">
					Markets are not configured on this network yet.
				</div>
			</div>
		);

	const hasLoans = !!ids.data?.length;
	const hasSupply = supplyRows.length > 0;

	return (
		<div className="assets-page">
			{page}
			{hasSupply && (
				<div className="surface-card assets-supply">
					<div className="eyebrow">Supply</div>
					<h3>Your deposits</h3>
					<div className="assets-kpis">
						<div className="assets-kpi">
							<span>Total supplied</span>
							<strong>
								{totalSupplied !== undefined
									? `${formatAmount(
											totalSupplied,
											debtDec,
									  )} ${debtSym}`
									: '—'}
							</strong>
						</div>
						<div className="assets-kpi">
							<span>Reward earned</span>
							<strong className="income-pos">
								{totalIncome !== undefined
									? `+${formatAmount(totalIncome, debtDec)} ${debtSym}`
									: '—'}
							</strong>
						</div>
					</div>
					<div className="assets-supply-table-wrap">
						<table className="data-table assets-supply-table">
							<thead>
								<tr>
									<th>Market</th>
									<th className="num">APY</th>
									<th className="num">Principal</th>
									<th className="num">Reward earned</th>
									<th className="num">Current value</th>
								</tr>
							</thead>
							<tbody>
								{supplyRowsWithIncome.map((r) => (
									<tr key={r.pid}>
										<td>{r.label}</td>
										<td className="num">
											{formatBpsAsPct(r.apyBps)}
										</td>
										<td className="num">
											{r.principal !== undefined
												? `${formatAmount(
														r.principal,
														debtDec,
												  )} ${debtSym}`
												: '—'}
										</td>
										<td
											className="num income-pos"
											data-label="Reward earned"
										>
											{r.income !== undefined
												? `+${formatAmount(
														r.income,
														debtDec,
												  )} ${debtSym}`
												: '—'}
										</td>
										<td className="num">
											{r.assets !== undefined
												? `${formatAmount(
														r.assets,
														debtDec,
												  )} ${debtSym}`
												: '—'}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<p className="meta">
						Reward is interest accrued on your supply (current value minus
						deposit cost). Manage supply from any market detail page.
					</p>
				</div>
			)}
			{ids.isLoading && !ids.data ? (
				<div className="empty">
					<div className="loading-panel" style={{ minHeight: 120 }}>
						<Spinner size={24} />
						<strong>Loading loans…</strong>
					</div>
				</div>
			) : !hasLoans ? (
				<div className="empty">
					No open loans. Open a market, select an LP NFT, and borrow{' '}
					{debtSym}.
				</div>
			) : (
				<div className="pos-table-wrap">
					<table className="data-table assets-table">
						<colgroup>
							<col className="col-pos" />
							<col className="col-usd" />
							<col className="col-debt" />
							<col className="col-hf" />
							<col className="col-status" />
							<col className="col-actions" />
						</colgroup>
						<thead>
							<tr>
								<th>Position</th>
								<th>Borrow APR</th>
								<th>Debt</th>
								<th>Interest</th>
								<th>Status</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{ids.data!.map((loanId) => (
								<LoanCard
									key={loanId.toString()}
									loanId={loanId}
									open={openLoanId === loanId.toString()}
									onBusyChange={(isBusy) =>
										setBusyLoanId(isBusy ? loanId.toString() : null)
									}
									onToggle={() => {
										if (busyLoanId) return;
										setOpenLoanId((cur) =>
											cur === loanId.toString()
												? null
												: loanId.toString(),
										);
									}}
								/>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

function LoanCard({
	loanId,
	open,
	onToggle,
	onBusyChange,
}: {
	loanId: bigint;
	open: boolean;
	onToggle: () => void;
	onBusyChange?: (busy: boolean) => void;
}) {
	const net = useNetwork();
	const txScope = useTxScope();
	const { sendBatch, busy, status, isError } = useTxAction();
	const detailsRef = useRef<HTMLDivElement>(null);
	const debtAsset = net.addresses.debtAsset;
	const debtDec = debtTokenDecimals(debtAsset);
	const debtSym = resolveSymbol(debtAsset, undefined, 'USDC');

	useEffect(() => {
		onBusyChange?.(busy);
		return () => onBusyChange?.(false);
	}, [busy, onBusyChange]);

	useEffect(() => {
		if (!open) return;
		function onPointerDown(e: MouseEvent) {
			if (busy) return;
			const root = detailsRef.current;
			if (root && !root.contains(e.target as Node)) onToggle();
		}
		document.addEventListener('mousedown', onPointerDown);
		return () => document.removeEventListener('mousedown', onPointerDown);
	}, [open, busy, onToggle]);

	const { data, refetch } = useReadContracts({
		contracts: [
			{
				address: net.addresses.lendingModule,
				abi: marketLendingAbi,
				functionName: 'loans',
				args: [loanId],
				chainId: net.chainId,
			},
			{
				address: net.addresses.lendingModule,
				abi: marketLendingAbi,
				functionName: 'currentDebt',
				args: [loanId],
				chainId: net.chainId,
			},
		],
		scopeKey: txScope,
		query: { staleTime: 0, refetchOnMount: 'always' },
	});

	async function runCalls(calls: TxCall[]) {
		const ok = await sendBatch(calls);
		if (ok) await refetch();
	}

	const loan = data?.[0]?.result;
	const debtInfo = data?.[1]?.result;
	const version = loan ? Number(loan[1]) : 0;
	const tokenId = loan?.[2];
	const principal = debtInfo?.[0] ?? loan?.[4] ?? 0n;
	const interest = debtInfo?.[1] ?? 0n;
	const totalDebt = debtInfo?.[2] ?? principal + interest;
	const borrowAprBps = loan?.[6];
	const active = loan?.[10];
	const borrower = loan?.[0];

	const { data: liqPreview } = useReadContract({
		address: net.addresses.lendingModule,
		abi: marketLendingAbi,
		functionName: 'previewLiquidation',
		args: [loanId],
		chainId: net.chainId,
		query: {
			enabled:
				!!active &&
				net.contractsConfigured &&
				net.addresses.lendingModule !== zeroAddress,
			staleTime: 0,
			refetchInterval: 15_000,
		},
	});
	const underwater = Boolean(liqPreview?.[0]);

	const adapter =
		version === 0 ? net.addresses.v3Adapter : net.addresses.v4Adapter;
	const posMeta = useReadContract({
		address: adapter,
		abi: adapterAbi,
		functionName: 'getPositionMeta',
		args: tokenId !== undefined ? [tokenId] : undefined,
		chainId: net.chainId,
		query: {
			enabled: !!loan && adapter !== zeroAddress && tokenId !== undefined,
		},
	});
	const preview = useReadContract({
		address: net.addresses.lendingModule,
		abi: marketLendingAbi,
		functionName: 'previewBorrow',
		args: tokenId !== undefined ? [version, tokenId] : undefined,
		chainId: net.chainId,
		scopeKey: txScope,
		query: {
			enabled: !!loan && active === true && tokenId !== undefined,
			staleTime: 0,
		},
	});
	const pair0 = posMeta.data?.[0];
	const pair1 = posMeta.data?.[1];
	const maxBorrowTotal = preview.data?.[4];
	const maxMore =
		maxBorrowTotal !== undefined && maxBorrowTotal > totalDebt
			? maxBorrowTotal - totalDebt
			: 0n;
	const [amt, setAmt] = useState('');
	const { data: allowance } = useReadContract({
		address: debtAsset,
		abi: erc20Abi,
		functionName: 'allowance',
		args:
			borrower && debtAsset !== zeroAddress
				? [borrower, net.addresses.lendingModule]
				: undefined,
		chainId: net.chainId,
		query: { enabled: !!borrower && debtAsset !== zeroAddress },
	});

	if (!loan) {
		return (
			<tr>
				<td colSpan={6} className="table-msg">
					<LoadingText label={`Loading loan #${loanId.toString()}…`} />
				</td>
			</tr>
		);
	}

	const versionChip = (
		<span className="pos-chip">{version === 0 ? 'v3' : 'v4'}</span>
	);

	if (!active) {
		return (
			<tr className="closed">
				<td data-label="Position">
					<div className="pos-cell">
						<div className="pos-cell-top">
							<TokenPair token0={pair0} token1={pair1} />
							{versionChip}
						</div>
						<span className="meta">
							NFT #{tokenId?.toString()} · Loan #{loanId.toString()}
						</span>
					</div>
				</td>
				<td data-label="APR">
					{borrowAprBps !== undefined
						? formatBpsAsPct(Number(borrowAprBps))
						: '—'}
				</td>
				<td data-label="Debt">0 {debtSym}</td>
				<td data-label="Interest">—</td>
				<td data-label="Status">
					<span className="status-pill muted">Closed</span>
				</td>
				<td data-label="Actions"></td>
			</tr>
		);
	}

	let borrowOverMax = false;
	try {
		borrowOverMax =
			!!amt && maxMore !== undefined && parseUnits(amt, debtDec) > maxMore;
	} catch {
		borrowOverMax = true;
	}
	const borrowDisabled = busy || !amt || borrowOverMax;
	const repayDisabled = busy || (!amt && totalDebt === 0n);

	/** Full close over-requests amount (max uint); contract caps to debt due. */
	function repayCalls(amount: bigint, alsoWithdraw: boolean): TxCall[] {
		const calls: TxCall[] = [];
		const needAllowance = amount === maxUint256 ? totalDebt : amount;
		if (!allowance || allowance < needAllowance) {
			calls.push({
				to: debtAsset,
				data: encodeFunctionData({
					abi: erc20Abi,
					functionName: 'approve',
					args: [
						net.addresses.lendingModule,
						amount === maxUint256 ? maxUint256 : amount,
					],
				}),
			});
		}
		if (alsoWithdraw) {
			// One on-chain call: accrue → repay → return NFT
			calls.push({
				to: net.addresses.lendingModule,
				data: encodeFunctionData({
					abi: marketLendingAbi,
					functionName: 'repayAndWithdraw',
					args: [loanId, amount],
				}),
			});
			return calls;
		}
		calls.push({
			to: net.addresses.lendingModule,
			data: encodeFunctionData({
				abi: marketLendingAbi,
				functionName: 'repay',
				args: [loanId, amount],
			}),
		});
		return calls;
	}

	function parseRepayAmount(fullClose: boolean): bigint | undefined {
		if (fullClose || !amt) return maxUint256;
		try {
			const parsed = parseUnits(amt, debtDec);
			return parsed > 0n ? parsed : undefined;
		} catch {
			return undefined;
		}
	}

	return (
		<tr className="loan-row">
			<td data-label="Position">
				<div className="pos-cell">
					<div className="pos-cell-top">
						<TokenPair token0={pair0} token1={pair1} />
						{versionChip}
					</div>
					<span className="meta">
						NFT #{tokenId?.toString()} · Loan #{loanId.toString()}
					</span>
				</div>
			</td>
			<td data-label="APR">
				{borrowAprBps !== undefined
					? formatBpsAsPct(Number(borrowAprBps))
					: '—'}
			</td>
			<td data-label="Debt">
				{formatAmount(totalDebt, debtDec)} {debtSym}
			</td>
			<td data-label="Interest">
				{formatAmount(interest, debtDec)} {debtSym}
			</td>
			<td data-label="Status">
				{underwater ? (
					<span className="status-pill warn">At risk</span>
				) : (
					<span className="status-pill ok">Active</span>
				)}
			</td>
			<td data-label="Actions">
				<div
					ref={detailsRef}
					className={`details-wrap ${open ? 'open' : ''}`}
				>
					<button
						type="button"
						className={`btn ghost sm details-btn ${open ? 'on' : ''}`}
						aria-expanded={open}
						onClick={() => {
							if (busy && open) return;
							onToggle();
						}}
					>
						Details
						<span className="chevron" aria-hidden>
							{open ? '▴' : '▾'}
						</span>
					</button>
					{open ? (
						<div className="details-panel" role="region">
							<div className="loan-inline">
								<p className="meta cap-note">
									Principal {formatAmount(principal, debtDec)} ·
									interest {formatAmount(interest, debtDec)} {debtSym}
								</p>
								<AmountField
									value={amt}
									onChange={setAmt}
									disabled={busy}
									max={totalDebt > 0n ? totalDebt : maxMore}
									decimals={debtDec}
									placeholder="Amount"
								/>
								{borrowOverMax ? (
									<p className="meta cap-note">
										Above remaining borrow capacity.
									</p>
								) : (
									<p className="meta cap-note">
										Debt {formatAmount(totalDebt, debtDec)} {debtSym}
										{' · '}
										capacity {formatAmount(maxMore, debtDec)}{' '}
										{debtSym}. Empty amount + Repay all clears full
										debt on-chain.
									</p>
								)}
								<div className="loan-actions">
									<button
										className="btn ghost sm"
										disabled={borrowDisabled || maxMore === 0n}
										onClick={() =>
											void runCalls([
												{
													to: net.addresses.lendingModule,
													data: encodeFunctionData({
														abi: marketLendingAbi,
														functionName: 'borrowMore',
														args: [
															loanId,
															parseUnits(amt, debtDec),
														],
													}),
												},
											])
										}
									>
										Borrow more
									</button>
									<button
										className="btn ghost sm"
										disabled={repayDisabled}
										onClick={() => {
											const parsed = parseRepayAmount(false);
											if (parsed === undefined) return;
											void runCalls(repayCalls(parsed, false));
										}}
									>
										{amt ? 'Repay' : 'Repay all'}
									</button>
									<button
										className="btn sm"
										disabled={busy}
										onClick={() => {
											if (totalDebt === 0n) {
												void runCalls([
													{
														to: net.addresses.lendingModule,
														data: encodeFunctionData({
															abi: marketLendingAbi,
															functionName: 'withdrawCollateral',
															args: [loanId],
														}),
													},
												]);
												return;
											}
											// Always repay max-uint so accrued interest
											// between clicks cannot leave dust.
											void runCalls(repayCalls(maxUint256, true));
										}}
									>
										{totalDebt === 0n
											? 'Withdraw NFT'
											: 'Repay & withdraw'}
									</button>
								</div>
								<TxStatus
									busy={busy}
									status={status}
									isError={isError}
								/>
							</div>
						</div>
					) : null}
				</div>
			</td>
		</tr>
	);
}
