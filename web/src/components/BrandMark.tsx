import lpfiMark from '@lpfi-mark';
import lpfiWordmark from '@lpfi-wordmark';

export function BrandMark({ className = 'mark' }: { className?: string }) {
	return (
		<img
			className={className}
			src={lpfiMark}
			alt="LPFY"
			width={36}
			height={36}
		/>
	);
}

export function BrandLockup() {
	return (
		<span className="brand-lockup">
			<img className="brand-lockup-mark" src={lpfiMark} alt="" />
			<img className="brand-lockup-name" src={lpfiWordmark} alt="LPFY" />
		</span>
	);
}
