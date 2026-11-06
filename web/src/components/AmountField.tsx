import { toInputAmount, toMaxInputAmount } from '../lib/amounts';

export function AmountField({
	value,
	onChange,
	disabled,
	max,
	decimals,
	placeholder,
	capToMax,
}: {
	value: string;
	onChange: (next: string) => void;
	disabled?: boolean;
	max?: bigint;
	decimals: number;
	placeholder?: string;
	/** Never fill a Max amount that parses above `max`. */
	capToMax?: boolean;
}) {
	return (
		<div className="amount-field">
			<input
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder ?? '0.00'}
				disabled={disabled}
			/>
			<button
				type="button"
				className="btn ghost max-btn"
				disabled={disabled || max === undefined || max <= 0n}
				onClick={() =>
					onChange(
						capToMax
							? toInputAmount(max!, decimals)
							: toMaxInputAmount(max!, decimals),
					)
				}
			>
				Max
			</button>
		</div>
	);
}
