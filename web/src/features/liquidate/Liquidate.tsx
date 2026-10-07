import { useState } from 'react';
import { encodeFunctionData, zeroAddress } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import { marketLendingAbi } from '../../abi';
import { Spinner } from '../../components/Loader';
import { formatAmount } from '../../lib/format';
import { useNetwork } from '../../lib/networkContext';
import { debtTokenDecimals, resolveSymbol } from '../../lib/tokens';
import { useTxAction, TxStatus } from '../../hooks/tx';

export function Liquidate() {
	const net = useNetwork();
	const { address, isConnected } = useAccount();
	const { sendBatch, busy, status, isError } = useTxAction();
	const debtAsset = net.addresses.debtAsset;
	const debtDec = debtTokenDecimals(debtAsset);
	const debtSym = resolveSymbol(debtAsset, undefined, 'USDC');
	const [loanIdInput, setLoanIdInput] = useState('');
	const loanId = (() => {
		try {
			const n = BigInt(loanIdInput.trim() || '0');
			return n > 0n ? n : undefined;
		} catch {
			return undefined;
		}
	})();

	const moduleReady =
		net.contractsConfigured && net.addresses.lendingModule !== zeroAddress;

	const { data: owner } = useReadContract({
		address: net.addresses.lendingModule,
		abi: marketLendingAbi,
		functionName: 'owner',
		chainId: net.chainId,
		query: { enabled: moduleReady },
	});

	const { data: isAuthorized } = useReadContract({
		address: net.addresses.lendingModule,
		abi: marketLendingAbi,
		functionName: 'authorizedLiquidators',
		args: address ? [address] : undefined,
		chainId: net.chainId,
		query: { enabled: moduleReady && !!address },
	});

	const { data: firstAtRisk, refetch: refetchScan } = useReadContract({
		address: net.addresses.lendingModule,
		abi: marketLendingAbi,
		functionName: 'findFirstLiquidatableLoan',
		chainId: net.chainId,
		query: { enabled: moduleReady, staleTime: 0 },
	});

	const canLiquidate =
		!!address &&
		((!!owner && address.toLowerCase() === (owner as string).toLowerCase()) ||
			Boolean(isAuthorized));

	const isOwner =
		!!address &&
		!!owner &&
		address.toLowerCase() === (owner as string).toLowerCase();

	const enabled = !!loanId && moduleReady;

	const {
		data: preview,
		isFetching,
		refetch,
		isError: previewError,
	} = useReadContract({
		address: net.addresses.lendingModule,
		abi: marketLendingAbi,
		functionName: 'previewLiquidation',
		args: loanId ? [loanId] : undefined,
		chainId: net.chainId,
		query: { enabled, staleTime: 0 },
	});

	const liquidatable = preview?.[0];
	const estimatedUsdc = preview?.[5];
	const debt = preview?.[6];
	const shortfall = preview?.[7];
	const recoveryOk =
		debt !== undefined &&
		estimatedUsdc !== undefined &&
		estimatedUsdc >= debt;

	async function onLiquidate() {
		if (!loanId) return;
		await sendBatch([
			{
				to: net.addresses.lendingModule,
				data: encodeFunctionData({
					abi: marketLendingAbi,
					functionName: 'liquidate',
					args: [loanId],
				}),
			},
		]);
		await refetch();
		await refetchScan();
	}

	function loadFirstAtRisk() {
		const found = firstAtRisk?.[0];
		const id = firstAtRisk?.[1];
		if (found && id !== undefined && id > 0n) {
			setLoanIdInput(id.toString());
		}
	}

	const authLabel = !isConnected
		? 'Wallet disconnected'
		: isOwner
		? 'Admin — can execute'
		: canLiquidate
		? 'Authorized liquidator'
		: 'View only — preview allowed';

	return (
		<div className="liquidate-page">
			<div className="page-head">
				<div>
					<p className="eyebrow">Risk desk</p>
					<h2>Liquidate</h2>
					<p className="meta">
						Preview recovery for a loan. Execution is limited to the
						market admin or the CRE keeper.
					</p>
				</div>
				<span
					className={`status-pill ${canLiquidate ? 'ok' : 'muted'}`}
					title={authLabel}
				>
					{authLabel}
				</span>
			</div>

			{!moduleReady ? (
				<div className="empty">
					Markets are not configured on this network yet.
				</div>
			) : (
				<div className="liq-layout">
					<section className="surface-card liq-panel">
						<div className="liq-panel-head">
							<div>
								<p className="eyebrow">Lookup</p>
								<h3>Loan preview</h3>
							</div>
							<button
								type="button"
								className="btn ghost sm"
								disabled={busy || !firstAtRisk?.[0]}
								onClick={loadFirstAtRisk}
							>
								Load at-risk loan
							</button>
						</div>

						<label className="liq-field">
							<span>Loan ID</span>
							<div className="liq-input-row">
								<input
									value={loanIdInput}
									onChange={(e) =>
										setLoanIdInput(
											e.target.value.replace(/[^\d]/g, ''),
										)
									}
									placeholder="Enter loan id"
									inputMode="numeric"
								/>
								<button
									type="button"
									className="btn ghost"
									disabled={!loanId || busy || isFetching}
									onClick={() => void refetch()}
								>
									{isFetching ? '…' : 'Refresh'}
								</button>
							</div>
						</label>

						{!loanId ? (
							<p className="meta liq-hint">
								Enter a loan ID, or tap “Load at-risk loan” if the
								scanner finds one.
							</p>
						) : null}

						{loanId && isFetching && !preview ? (
							<div className="loading-panel" style={{ minHeight: 88 }}>
								<Spinner size={20} />
								<span>Loading preview…</span>
							</div>
						) : null}

						{loanId && previewError ? (
							<div className="liq-banner error">
								Preview failed — loan may be inactive or not found on
								this market.
							</div>
						) : null}

						{loanId && preview && !previewError ? (
							<div
								className={`liq-metrics ${
									liquidatable ? 'at-risk' : 'healthy'
								}`}
							>
								<div className="liq-metric">
									<span>Status</span>
									<strong>
										{liquidatable ? (
											<span className="status-pill warn">
												Liquidatable
											</span>
										) : (
											<span className="status-pill ok">Healthy</span>
										)}
									</strong>
								</div>
								<div className="liq-metric">
									<span>Debt</span>
									<strong>
										{debt !== undefined
											? `${formatAmount(debt, debtDec)} ${debtSym}`
											: '—'}
									</strong>
								</div>
								<div className="liq-metric">
									<span>Est. recovery</span>
									<strong>
										{estimatedUsdc !== undefined
											? `${formatAmount(
													estimatedUsdc,
													debtDec,
											  )} ${debtSym}`
											: '—'}
									</strong>
								</div>
								<div className="liq-metric">
									<span>{recoveryOk ? 'Surplus' : 'Shortfall'}</span>
									<strong>
										{debt !== undefined && estimatedUsdc !== undefined
											? recoveryOk
												? `${formatAmount(
														estimatedUsdc - debt,
														debtDec,
												  )} ${debtSym}`
												: `${formatAmount(
														shortfall ?? 0n,
														debtDec,
												  )} ${debtSym}`
											: '—'}
									</strong>
								</div>
							</div>
						) : null}

						{isConnected && !canLiquidate ? (
							<div className="liq-banner">
								Your wallet can preview only. Liquidate is reserved for
								the market admin or CRE.
							</div>
						) : null}

						<div className="liq-actions">
							<button
								type="button"
								className="btn"
								disabled={
									!loanId ||
									!liquidatable ||
									busy ||
									!isConnected ||
									!canLiquidate
								}
								onClick={() => void onLiquidate()}
							>
								{busy ? 'Confirm in wallet…' : 'Liquidate loan'}
							</button>
						</div>
						<TxStatus busy={busy} status={status} isError={isError} />
					</section>

					<aside className="surface-card liq-side">
						<p className="eyebrow">How it works</p>
						<h3>Unwind path</h3>
						<ol className="liq-steps">
							<li>Check debt vs collateral (liquidation threshold).</li>
							<li>Remove LP liquidity and collect both tokens.</li>
							<li>
								Swap non-{debtSym} into {debtSym}.
							</li>
							<li>
								Repay the pair pool; surplus returns to the borrower.
							</li>
						</ol>
						<p className="meta">
							CRE polls on a schedule and calls the same path when a loan
							is underwater. Manual execute stays available for admin.
						</p>
						{firstAtRisk?.[0] ? (
							<p className="liq-scan-hit">
								Scanner: loan #{firstAtRisk[1]?.toString()} is at risk.
							</p>
						) : (
							<p className="meta">
								Scanner: no liquidatable loans right now.
							</p>
						)}
					</aside>
				</div>
			)}
		</div>
	);
}
