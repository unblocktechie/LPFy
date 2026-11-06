import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { sepolia } from "wagmi/chains";
import App from "./App";
import "./index.css";
import { config, queryClient } from "./wagmi";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={sepolia}
          theme={lightTheme({
            accentColor: "#2563eb",
            accentColorForeground: "white",
            borderRadius: "medium",
            fontStack: "system",
          })}
        >
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
