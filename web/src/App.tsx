import { NetworkProvider } from './providers/NetworkProvider';
import { TxRefreshProvider } from './hooks/tx';
import { AppShell } from './layout/AppShell';

export default function App() {
	return (
		<NetworkProvider>
			<TxRefreshProvider>
				<AppShell />
			</TxRefreshProvider>
		</NetworkProvider>
	);
}
