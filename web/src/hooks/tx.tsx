import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Address, Hex } from 'viem';
import {
	usePublicClient,
	useWaitForTransactionReceipt,
	useWalletClient,
	useWriteContract,
} from 'wagmi';
import { Spinner } from '../components/Loader';

function txErrorMessage(error: unknown) {
	if (!error || typeof error !== 'object') return '';
	const e = error as {
		shortMessage?: string;
		message?: string;
		cause?: { name?: string; message?: string };
	};
	return (
		e.shortMessage || e.cause?.message || e.message || 'Transaction failed'
	);
}

export type TxCall = { to: Address; data: Hex };

const TxRefreshContext = createContext<{
	scope: string;
	bump: () => void;
}>({ scope: '0', bump: () => {} });

export function TxRefreshProvider({ children }: { children: ReactNode }) {
	const [n, setN] = useState(0);
	const value = useMemo(
		() => ({
			scope: String(n),
			bump: () => setN((x) => x + 1),
		}),
		[n],
	);
	return (
		<TxRefreshContext.Provider value={value}>
			{children}
		</TxRefreshContext.Provider>
	);
}

export function useTxScope() {
	return useContext(TxRefreshContext).scope;
}

export function useTxAction() {
	const queryClient = useQueryClient();
	const { bump } = useContext(TxRefreshContext);
	const write = useWriteContract();
	const { data: walletClient } = useWalletClient();
	const publicClient = usePublicClient();
	const [localBusy, setLocalBusy] = useState(false);
	const [note, setNote] = useState('');
	const [isError, setIsError] = useState(false);

	const receipt = useWaitForTransactionReceipt({
		hash: write.data,
		query: { enabled: !!write.data },
	});

	const writeBusy =
		write.isPending ||
		(!!write.data &&
			!receipt.isSuccess &&
			!receipt.isError &&
			receipt.isPending);
	const busy = localBusy || writeBusy;

	async function refreshReads() {
		bump();
		await queryClient.invalidateQueries();
		await queryClient.refetchQueries();
	}

	useEffect(() => {
		if (!receipt.isSuccess) return;
		void refreshReads();
		setNote('Confirmed. Figures refreshed.');
		const t = window.setTimeout(() => {
			setNote('');
			write.reset();
		}, 2500);
		return () => window.clearTimeout(t);
	}, [receipt.isSuccess, receipt.dataUpdatedAt]);

	async function sendBatch(
		calls: TxCall[],
		opts?: { successNote?: string },
	): Promise<boolean> {
		if (!calls.length) return false;
		setIsError(false);
		setNote('Confirm in your wallet…');
		setLocalBusy(true);
		try {
			if (!walletClient) throw new Error('Connect a wallet first.');
			for (let i = 0; i < calls.length; i += 1) {
				setNote(
					calls.length > 1
						? `Confirm step ${i + 1} of ${calls.length} in your wallet…`
						: 'Confirm in your wallet…',
				);
				const hash = await walletClient.sendTransaction({
					to: calls[i].to,
					data: calls[i].data,
				});
				setNote(
					calls.length > 1
						? `Step ${i + 1}/${calls.length} pending on-chain…`
						: 'Transaction pending on-chain…',
				);
				if (publicClient) {
					await publicClient.waitForTransactionReceipt({ hash });
				}
			}
			await refreshReads();
			window.setTimeout(() => {
				void refreshReads();
			}, 1500);
			setNote(opts?.successNote || 'Confirmed. Figures refreshed.');
			window.setTimeout(() => setNote(''), 2500);
			return true;
		} catch (e) {
			setIsError(true);
			setNote(txErrorMessage(e));
			return false;
		} finally {
			setLocalBusy(false);
		}
	}

	const status = localBusy
		? note || 'Sending transaction…'
		: write.isPending
		? 'Confirm in your wallet…'
		: writeBusy
		? 'Transaction pending on-chain…'
		: write.error
		? txErrorMessage(write.error)
		: note;

	return {
		writeContract: write.writeContract,
		sendBatch,
		busy,
		status,
		isError: isError || Boolean(write.error),
		isSuccess: note.startsWith('Confirmed'),
	};
}

export function TxStatus({
	busy,
	status,
	isError,
}: {
	busy: boolean;
	status: string;
	isError: boolean;
}) {
	if (!status) return null;
	if (busy) {
		return (
			<p className="tx-status">
				<Spinner size={14} />
				<span>{status}</span>
			</p>
		);
	}
	return <p className={`meta ${isError ? 'bad' : ''}`}>{status}</p>;
}
