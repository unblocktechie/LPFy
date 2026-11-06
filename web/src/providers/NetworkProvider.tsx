import { useMemo, useState, type ReactNode } from 'react';
import type { Address } from 'viem';
import {
	buildNetworkState,
	NetworkContext,
} from '../lib/networkContext';

export function NetworkProvider({ children }: { children: ReactNode }) {
	const [selectedDebt, setSelectedDebt] = useState<Address | undefined>();
	const value = useMemo(
		() => buildNetworkState(selectedDebt, setSelectedDebt),
		[selectedDebt],
	);
	return (
		<NetworkContext.Provider value={value}>
			{children}
		</NetworkContext.Provider>
	);
}
