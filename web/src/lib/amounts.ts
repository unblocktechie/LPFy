import { formatUnits, parseUnits } from 'viem';
import { debtAmountToUsd8, formatAmount, formatUsd8 } from './format';

export function formatDebtWithUsd(
	amount: bigint | undefined,
	decimals: number,
	symbol: string,
) {
	if (amount === undefined) return undefined;
	return `${formatAmount(amount, decimals)} ${symbol} ≈ ${formatUsd8(
		debtAmountToUsd8(amount, decimals),
	)}`;
}

export function toInputAmount(value: bigint, decimals: number) {
	const s = formatUnits(value, decimals);
	if (!s.includes('.')) return s;
	return s.replace(/(\.d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
}

/** Prefer the rounded display label for Max when it still covers the full balance. */
export function toMaxInputAmount(value: bigint, decimals: number) {
	const exact = toInputAmount(value, decimals);
	const rounded = formatAmount(value, decimals).replace(/,/g, '');
	if (!rounded || rounded === '—' || rounded.startsWith('<')) return exact;
	try {
		if (parseUnits(rounded, decimals) >= value) return rounded;
	} catch {
		/* keep exact */
	}
	return exact;
}

/**
 * Borrow amount to submit. A rounded label that sits above the cap is
 * not a valid input, so it resolves to the full on-chain max.
 */
export function cappedBorrowAmount(
	input: string,
	max: bigint | undefined,
	decimals: number,
): { amount?: bigint; overMax: boolean } {
	const norm = input.trim().replace(/,/g, '');
	if (!norm) return { overMax: false };
	let parsed: bigint;
	try {
		parsed = parseUnits(norm, decimals);
	} catch {
		return { overMax: true };
	}
	if (max !== undefined && parsed > max) {
		const rounded = formatAmount(max, decimals).replace(/,/g, '');
		if (
			rounded &&
			rounded !== '—' &&
			!rounded.startsWith('<') &&
			norm === rounded
		) {
			return { amount: max, overMax: false };
		}
		return { overMax: true };
	}
	return { amount: parsed > 0n ? parsed : undefined, overMax: false };
}
