const path = require('path');
const fs = require('fs');
require('@nomicfoundation/hardhat-toolbox');

// Load env from smart-contracts/.env
const dotenv = require('dotenv');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const { rpc } = require('./config/rpc');

let PRIVATE_KEY = (process.env.PRIVATE_KEY || '').trim();
if (PRIVATE_KEY && !PRIVATE_KEY.startsWith('0x')) {
	PRIVATE_KEY = `0x${PRIVATE_KEY}`;
}

const forkEnabled = process.env.HARDHAT_FORK === '1' && !!rpc.mainnet;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
	solidity: {
		version: '0.8.24',
		settings: {
			optimizer: { enabled: true, runs: 200 },
			viaIR: true,
		},
	},
	paths: {
		sources: './contracts',
		tests: './test',
		cache: './cache',
		artifacts: './artifacts',
	},
	networks: {
		hardhat: {
			chainId: 31337,
			...(forkEnabled
				? {
						forking: {
							url: rpc.mainnet,
							...(process.env.FORK_BLOCK
								? { blockNumber: Number(process.env.FORK_BLOCK) }
								: {}),
						},
				  }
				: {}),
		},
		localhost: {
			url: rpc.localhost,
			chainId: 31337,
		},
		sepolia: {
			url: rpc.sepolia,
			accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
			chainId: 11155111,
		},
	},
	etherscan: {
		apiKey: {
			sepolia: process.env.ETHERSCAN_API_KEY || '',
		},
	},
};
