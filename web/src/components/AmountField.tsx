export function AmountField({ value, onChange, disabled, placeholder }: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="amount-field">
      <input value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '0.00'} disabled={disabled} />
    </div>
  );
}
