# Blockchain - Decentralised Rental System

This folder contains the smart contract implementation for the Decentralised Rental System, built with **Hardhat v2** and Solidity.

## Project Overview

This blockchain project includes:

- **Smart Contracts**:
  - `RentalContract.sol` - Main contract for managing rental agreements
  - `DisputesContract.sol` - Handles dispute management and voting
- **Deployment Script**: `scripts/deploy.js` - Automated deployment to local or test networks
- **Hardhat Configuration**: Setup for local development and network configurations

## Prerequisites

Make sure you have Node.js and npm installed. Then install dependencies:

```shell
npm install
```

## Backend Configuration

Your backend needs a `.env` file with blockchain and IPFS configuration:

```env
RPC_URL=http://127.0.0.1:8545
PRIVATE_KEY=<any_private_key_from_hardhat_node_accounts>
PINATA_API_KEY=<your_pinata_api_key>
PINATA_API_SECRET=<your_pinata_secret_key>
```

### Getting the Private Key

When you run `npx hardhat node`, it outputs 20 test accounts with their private keys. Copy **any one** of those private keys for the `PRIVATE_KEY` field.

Example output:

```
Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10000 ETH)
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

### Getting Pinata API Keys

1. Go to [Pinata](https://pinata.cloud/) and create an account
2. Navigate to **API Keys** in the dashboard
3. Click **New Key**
4. Enable **Admin** features
5. Copy the **API Key** and **API Secret** to your `.env` file

## Usage

### 1. Start Local Blockchain Node

First, start a local Hardhat network in a terminal window:

```shell
npx hardhat node
or
npm run node
```

This will start a local blockchain node at `http://127.0.0.1:8545/` with 20 test accounts pre-funded with ETH.

**Keep this terminal running** while you work.

### 2. Compile Contracts

In a **new terminal window**, compile the smart contracts:

```shell
npx hardhat compile
or
npm run compile
```

This generates the contract artifacts in the `artifacts/` folder.

### 3. Deploy to Local Network

Deploy the RentalContract to your local Hardhat network:

```shell
npx hardhat run scripts/deploy.js --network localhost
or
npm run deploy
```

The deployment script will output the deployed contract address, which you'll need to configure in your backend.

## Network Configuration

- **Local Development**: `localhost` (default: http://127.0.0.1:8545)
- **Testnet**: Configure in `hardhat.config.js` for networks like Sepolia, Mumbai, etc.

## Contract Details

The `RentalContract.sol` handles:

- Rental agreement creation and management
- Payment processing and escrow
- Dispute resolution mechanisms
- Property and tenant management on-chain

## Development Workflow

1. Make changes to `contracts/RentalContract.sol`
2. Recompile: `npx hardhat compile`
3. Redeploy: `npx hardhat run scripts/deploy.js --network localhost`
4. Update the contract address in your backend configuration

## Troubleshooting

- If deployment fails, ensure the Hardhat node is running in a separate terminal
- To reset the local blockchain state, stop the node (Ctrl+C) and restart it
- Generated files (`artifacts/`, `cache/`) are gitignored and rebuilt on compile
