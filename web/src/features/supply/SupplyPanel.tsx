import { useMemo, useState } from 'react';
import {
	encodeFunctionData,
	parseUnits,
	zeroAddress,
	type Address,
	type Hex,
} from 'viem';
import { useReadContract } from 'wagmi';
import { erc20Abi, marketLendingAbi, pairVaultAbi } from '../../abi';
import { AmountField } from '../../components/AmountField';
import { formatAmount } from '../../lib/format';
import { toInputAmount } from '../../lib/amounts';
import { useNetwork } from '../../lib/networkContext';
import { marketPoolIds } from '../../lib/pairId';
import {
	debtTokenDecimals,
	formatBpsAsPct,
	resolveSymbol,
} from '../../lib/tokens';
import { useTxAction, useTxScope, TxStatus, type TxCall } from '../../hooks/tx';
import { PoolLiquidity } from '../pool/PoolLiquidity';

export function SupplyPanel({
	connected,
	address,
	pairId,
	label,
	embedded = false,
	compact = false,
}: {
	connected: boolean;
	address?: `0x${string}`;
	pairId: Hex;
	label?: string;
	embedded?: boolean;
	compact?: boolean;
}) {
	const net = useNetwork();
	const txScope = useTxScope();
	const debtDec = debtTokenDecimals(net.addresses.debtAsset);
	const debtSym = resolveSymbol(net.addresses.debtAsset, undefined, 'USDC');
	const [amount, setAmount] = useState('');
	const [withdrawAmt, setWithdrawAmt] = useState('');
	const { sendBatch, busy, status, isError } = useTxAction();
	const module = net.addresses.lendingModule;
	const asset = net.addresses.debtAsset;

	const configuredVault = useMemo(() => {
		const market = net.markets.find((m) => marketPoolIds(m).primary === pairId);
		const v = market?.vault as Address | undefined;
		return v && v !== zeroAddress ? v : undefined;
	}, [net.markets, pairId]);

	const vaultOfRead = useReadContract({
		address: module,
		abi: marketLendingAbi,
		functionName: 'vaultOf',
		args: [pairId],
		chainId: net.chainId,
		scopeKey: txScope,
		query: {
			enabled: net.contractsConfigured && !!pairId,
			staleTime: 0,
		},
	});
	const vaultAddr =
		vaultOfRead.data && vaultOfRead.data !== zeroAddress
			? vaultOfRead.data
			: configuredVault;
	const vaultReady = !!vaultAddr && vaultAddr !== zeroAddress;

	const walletBal = useReadContract({
		address: asset,
		abi: erc20Abi,
		functionName: 'balanceOf',
		args: address ? [address] : undefined,
		chainId: net.chainId,
		scopeKey: txScope,
		query: { enabled: !!address && asset !== zeroAddress, staleTime: 0 },
	});
	const allowance = useReadContract({
		address: asset,
		abi: erc20Abi,
		functionName: 'allowance',
		args: address && vaultReady ? [address, vaultAddr!] : undefined,
		chainId: net.chainId,
		scopeKey: txScope,
		query: {
			enabled: !!address && asset !== zeroAddress && vaultReady,
			staleTime: 0,
		},
	});
	const shares = useReadContract({
		address: vaultAddr,
		abi: pairVaultAbi,
		functionName: 'balanceOf',
		args: address ? [address] : undefined,
		chainId: net.chainId,
		scopeKey: txScope,
		query: {
			enabled: vaultReady && !!address,
			staleTime: 0,
		},
	});
	const assetsOfShares = useReadContract({
		address: vaultAddr,
		abi: pairVaultAbi,
		functionName: 'convertToAssets',
		args: shares.data !== undefined ? [shares.data] : undefined,
		chainId: net.chainId,
		scopeKey: txScope,
		query: {
			enabled: vaultReady && shares.data !== undefined,
			staleTime: 0,
		},
	});
	const maxWithdrawable = useReadContract({
		address: vaultAddr,
		abi: pairVaultAbi,
		functionName: 'maxWithdraw',
		args: address ? [address] : undefined,
		chainId: net.chainId,
		scopeKey: txScope,
		query: {
			enabled: vaultReady && !!address,
			staleTime: 0,
		},
	});
	const cash = useReadContract({
		address: vaultAddr,
		abi: pairVaultAbi,
		functionName: 'idleAssets',
		chainId: net.chainId,
		scopeKey: txScope,
		query: { enabled: vaultReady, staleTime: 0 },
	});
	const apy = useReadContract({
		address: module,
		abi: marketLendingAbi,
		functionName: 'getLenderApyBps',
		args: [pairId],
		chainId: net.chainId,
		scopeKey: txScope,
		query: { enabled: net.contractsConfigured && !!pairId, staleTime: 0 },
	});
	const util = useReadContract({
		address: module,
		abi: marketLendingAbi,
		functionName: 'utilizationBps',
		args: [pairId],
		chainId: net.chainId,
		scopeKey: txScope,
		query: { enabled: net.contractsConfigured && !!pairId, staleTime: 0 },
	});

	const withdrawCap =
		maxWithdrawable.data !== undefined
			? maxWithdrawable.data
			: assetsOfShares.data;

	let supplyOverBal = false;
	let supplyParsed: bigint | undefined;
	try {
		if (amount) {
			supplyParsed = parseUnits(amount, debtDec);
			supplyOverBal =
				walletBal.data !== undefined && supplyParsed > walletBal.data;
		}
	} catch {
		supplyOverBal = true;
	}

	let withdrawOverShares = false;
	let withdrawAssets: bigint | undefined;
	let withdrawShares: bigint | undefined;
	/** True when the user means “withdraw everything” (Max or rounded Available label). */
	let withdrawFullPosition = false;
	try {
		if (
			withdrawAmt &&
			assetsOfShares.data !== undefined &&
			shares.data !== undefined &&
			shares.data > 0n &&
			withdrawCap !== undefined
		) {
			const maxAssets = withdrawCap;
			const want = parseUnits(withdrawAmt, debtDec);
			const exactMax = toInputAmount(maxAssets, debtDec);
			const roundedLabel = formatAmount(maxAssets, debtDec).replace(
				/,/g,
				'',
			);
			const inputNorm = withdrawAmt.trim().replace(/,/g, '');
			withdrawFullPosition =
				want === maxAssets ||
				inputNorm === exactMax ||
				inputNorm === roundedLabel ||
				(assetsOfShares.data > 0n &&
					want >= assetsOfShares.data &&
					maxAssets >= assetsOfShares.data);

			if (want > maxAssets && !withdrawFullPosition) {
				withdrawOverShares = true;
			} else if (withdrawFullPosition || want >= maxAssets) {
				withdrawShares = shares.data;
				withdrawAssets = maxAssets;
				withdrawFullPosition = true;
			} else {
				withdrawAssets = want;
				withdrawShares =
					assetsOfShares.data > 0n
						? (want * shares.data) / assetsOfShares.data
						: 0n;
				if (withdrawShares > shares.data) withdrawShares = shares.data;
			}
		}
	} catch {
		withdrawOverShares = true;
	}

	function supply() {
		if (!supplyParsed || supplyParsed <= 0n || !pairId || !vaultAddr || !address)
			return;
		const calls: TxCall[] = [];
		if (!allowance.data || allowance.data < supplyParsed) {
			calls.push({
				to: asset,
				data: encodeFunctionData({
					abi: erc20Abi,
					functionName: 'approve',
					args: [vaultAddr, supplyParsed],
				}),
			});
		}
		calls.push({
			to: vaultAddr,
			data: encodeFunctionData({
				abi: pairVaultAbi,
				functionName: 'deposit',
				args: [supplyParsed, address],
			}),
		});
		void sendBatch(calls).then((ok) => {
			if (ok) setAmount('');
		});
	}

	function withdraw() {
		if (!vaultAddr || !address) return;
		if (withdrawFullPosition && withdrawShares && withdrawShares > 0n) {
			void sendBatch([
				{
					to: vaultAddr,
					data: encodeFunctionData({
						abi: pairVaultAbi,
						functionName: 'redeem',
						args: [withdrawShares, address, address],
					}),
				},
			]).then((ok) => {
				if (ok) setWithdrawAmt('');
			});
			return;
		}
		if (!withdrawAssets || withdrawAssets <= 0n) return;
		if (cash.data !== undefined && withdrawAssets > cash.data) return;
		void sendBatch([
			{
				to: vaultAddr,
				data: encodeFunctionData({
					abi: pairVaultAbi,
					functionName: 'withdraw',
					args: [withdrawAssets, address, address],
				}),
			},
		]).then((ok) => {
			if (ok) setWithdrawAmt('');
		});
	}

	const withdrawCashBlocked =
		!!withdrawAmt &&
		!withdrawOverShares &&
		cash.data !== undefined &&
		withdrawAssets !== undefined &&
		withdrawAssets > cash.data;

	const form = (
		<>
			<div className={compact ? 'md-action-form' : 'card form'}>
				{!compact && (
					<>
						<div className="eyebrow">Supply</div>
						<h3>{label ? `Lend to ${label}` : `Lend ${debtSym}`}</h3>
					</>
				)}
				{compact ? (
					<>
						<div className="md-lend-grid">
							<section className="md-lend-block">
								<div className="md-action-title">
									Lend {debtSym}
									{apy.data !== undefined && (
										<span className="meta">
											· {formatBpsAsPct(Number(apy.data))} APY
										</span>
									)}
								</div>
								<label>
									Amount ({debtSym})
									<AmountField
										value={amount}
										onChange={setAmount}
										disabled={busy || !connected}
										max={walletBal.data}
										decimals={debtDec}
									/>
								</label>
								{walletBal.data !== undefined && (
									<p className="meta">
										Wallet: {formatAmount(walletBal.data, debtDec)}{' '}
										{debtSym}
									</p>
								)}
								{supplyOverBal && (
									<p className="meta bad">
										Amount exceeds wallet balance.
									</p>
								)}
								<button
									className="btn md-lend-btn"
									disabled={
										!connected ||
										!supplyParsed ||
										supplyParsed <= 0n ||
										busy ||
										supplyOverBal ||
										!net.contractsConfigured ||
										!vaultReady
									}
									onClick={supply}
								>
									Supply {debtSym}
								</button>
							</section>
							<section className="md-lend-block">
								<div className="md-action-title">Withdraw</div>
								<label>
									Amount ({debtSym})
									<AmountField
										value={withdrawAmt}
										onChange={setWithdrawAmt}
										disabled={busy || !connected || !shares.data}
										max={withdrawCap}
										decimals={debtDec}
									/>
								</label>
								{withdrawOverShares && (
									<p className="meta bad">
										Amount exceeds your supply position.
									</p>
								)}
								{withdrawCashBlocked && (
									<p className="meta bad">
										Not enough pool cash right now (borrowed). Try a
										smaller amount.
									</p>
								)}
								{withdrawCap !== undefined && (
									<p className="meta">
										Available:{' '}
										{formatAmount(withdrawCap, debtDec)}{' '}
										{debtSym}
									</p>
								)}
								<button
									className="btn ghost md-lend-btn"
									disabled={
										!connected ||
										!vaultReady ||
										(!(withdrawAssets && withdrawAssets > 0n) &&
											!(withdrawShares && withdrawShares > 0n)) ||
										busy ||
										withdrawOverShares ||
										withdrawCashBlocked
									}
									onClick={withdraw}
								>
									Withdraw
								</button>
							</section>
						</div>
						<div className="md-my-pos">
							<span className="meta">Your supply</span>
							<strong>
								{assetsOfShares.data !== undefined
									? `${formatAmount(
											assetsOfShares.data,
											debtDec,
									  )} ${debtSym}`
									: '—'}
							</strong>
						</div>
						<TxStatus busy={busy} status={status} isError={isError} />
					</>
				) : (
					<>
						{label && (
							<p className="meta">
								Isolated pool · APY{' '}
								{formatBpsAsPct(
									apy.data !== undefined
										? Number(apy.data)
										: undefined,
								)}
							</p>
						)}
						<label>
							Amount
							<AmountField
								value={amount}
								onChange={setAmount}
								disabled={busy || !connected}
								max={walletBal.data}
								decimals={debtDec}
							/>
						</label>
						{walletBal.data !== undefined && (
							<p className="meta">
								Wallet: {formatAmount(walletBal.data, debtDec)}{' '}
								{debtSym}
							</p>
						)}
						{supplyOverBal && (
							<p className="meta bad">Amount exceeds wallet balance.</p>
						)}
						<div className="actions">
							<button
								className="btn"
								disabled={
									!connected ||
									!supplyParsed ||
									supplyParsed <= 0n ||
									busy ||
									supplyOverBal ||
									!net.contractsConfigured ||
									!vaultReady
								}
								onClick={supply}
							>
								Supply {debtSym}
							</button>
						</div>
						<hr style={{ margin: '16px 0', opacity: 0.15 }} />
						<div className="eyebrow">Withdraw</div>
						<h3>Redeem shares</h3>
						<label>
							Amount ({debtSym})
							<AmountField
								value={withdrawAmt}
								onChange={setWithdrawAmt}
								disabled={busy || !connected || !shares.data}
								max={withdrawCap}
								decimals={debtDec}
							/>
						</label>
						{withdrawOverShares && (
							<p className="meta bad">
								Amount exceeds your supply position.
							</p>
						)}
						{withdrawCashBlocked && (
							<p className="meta bad">
								Not enough pool cash right now (borrowed). Try a smaller
								amount.
							</p>
						)}
						<div className="actions">
							<button
								className="btn ghost"
								disabled={
									!connected ||
									!vaultReady ||
									(!(withdrawAssets && withdrawAssets > 0n) &&
										!(withdrawShares && withdrawShares > 0n)) ||
									busy ||
									withdrawOverShares ||
									withdrawCashBlocked
								}
								onClick={withdraw}
							>
								Withdraw
							</button>
						</div>
						<TxStatus busy={busy} status={status} isError={isError} />
					</>
				)}
			</div>
			{!compact && (
				<aside className="card snapshot">
					<div className="eyebrow">Your position</div>
					<h3>Lender shares</h3>
					<div className="row">
						<span>Supplied</span>
						<strong>
							{assetsOfShares.data !== undefined
								? `${formatAmount(
										assetsOfShares.data,
										debtDec,
								  )} ${debtSym}`
								: '—'}
						</strong>
					</div>
					<div className="row">
						<span>Shares</span>
						<strong>
							{shares.data !== undefined ? shares.data.toString() : '—'}
						</strong>
					</div>
					<div className="row">
						<span>Display APY</span>
						<strong>
							{formatBpsAsPct(
								apy.data !== undefined ? Number(apy.data) : undefined,
							)}
						</strong>
					</div>
					<div className="row">
						<span>Pool cash</span>
						<strong>
							{cash.data !== undefined
								? `${formatAmount(cash.data, debtDec)} ${debtSym}`
								: '—'}
						</strong>
					</div>
					<div className="row">
						<span>Utilization</span>
						<strong>
							{util.data !== undefined
								? `${(Number(util.data) / 100).toFixed(1)}%`
								: '—'}
						</strong>
					</div>
					<PoolLiquidity compact pairId={pairId} />
				</aside>
			)}
		</>
	);

	if (compact) {
		return <div className="md-compact-supply">{form}</div>;
	}

	if (embedded) {
		return <div className="split">{form}</div>;
	}

	return (
		<div className="deposit-flow">
			<div className="page-head">
				<div>
					<p className="eyebrow">Lender</p>
					<h2>Supply {debtSym}</h2>
					<p className="meta">
						Deposit {debtSym} into this pair&apos;s isolated pool. You
						earn interest paid by borrowers of the same pair. Withdrawals
						come from that pool&apos;s available cash.
					</p>
				</div>
			</div>
			<div className="split">{form}</div>
		</div>
	);
}
