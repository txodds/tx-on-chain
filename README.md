# Tx Oracle Examples

This repository showcases usage of the Tx Oracle on-chain contract, demonstrating how to interact with sports data validation using Solana blockchain technology.

## Overview

Tx Oracle is a hybrid Solana on-chain and TxODDS hosted off-chain system. It supports the following two main use key cases:

1. Make proprietary TxODDS data available for any funded blockchain users by linking the on-chain subscribe transactions with issued time-limited API tokens.
   - The data is canonicalised so that all fixtures, odds, or scores are provably unique and can be validated on-chain using cryptographic proofs based on Merkle roots for batches of respective data published to the Solana blockchain.
   - The data is delivered in a request-response or streaming form.
   - One-week long subscriptions are established using a cryptographically secure protocol that assumes that a funded Solana user wallet can (programmatically) purchase `TxODDS subscription tokens` (used as a temporal fully returnable collateral) and pay for access to proprietary data using the SOL currency.

2. Sophisticated and highly general binary options Trading that allows users to:
   - submit cryptographically signed College Football and Basketball prediction offers for specified time periods,
   - receive via stream the resulting notifications to paid subscribers over the Trading stream,
   - accept and cryptorgaphically sign the offers (once the trade match is confirmed by the off-chain service, a fully-secure on-chain escrow is created with the matching sides token funds),
   - settle the trades if they have identified a scores record that proves the trade can be resolved in their favour, with escrow funds released into the winner's account.

The following is a basic diagram showing the system in opration.

![Alt text](assets/TxODDS%20Oracle.png?raw=true "TxODDS Oracle")

The OpenAPI documentation is available at
   <br>
   https://oracle-dev.txodds.com/docs for Solana DevNet use.
   <br>
   https://oracle.txodds.com/docs for Solana MainNet use.

## Configurations

### Devnet
```
Tx API: https://oracle-dev.txodds.com/api/
Program ID: 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
Token Mint: GYdhNurtx2EgiTPRHVGuFWKHPycdpUqgedVkwEVUWVTC
```

### Mainnet
```
Tx API: https://oracle.txodds.com/api/
Program ID: 9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA
Token Mint: sLX1i9dfmsuyFBmJTWuGjjRmG4VPWYK6dRRKSM4BCSx
```

## Access Flow

### 1. Purchase Tokens

Before accessing the oracle services, you must purchase TxOracle tokens. See `purchase_tokens.ts` for the complete implementation of token purchasing.

### 2. Stake Tokens

After purchasing tokens, you must stake them to gain API access. The staking mechanism ensures user commitment to the oracle network. See `stake.ts` and `unstake.ts` for the complete implementation of staking/unstaking.

**Stake Lock Periods:**
- **Devnet**: 60 seconds minimum lock period
- **Mainnet**: 24 hours minimum lock period

Once staked, tokens cannot be unstaked until the lock period expires.

### 3. Access Off-Chain API

With staked tokens, you can access the off-chain API services through the following request flow:

1. **Guest Authentication** - Make a `POST /auth/guest/start` request to receive a JWT token
2. **Create Subscription** - Execute an on-chain `subscribe` transaction with encrypted JWT payload using your staked tokens
3. **Token Activation** - Make a `GET /api/token/activate` request with the transaction signature and encryption parameters to receive your API access token
4. **API Access** - Use the API token in subsequent requests to all off-chain services

## Running the Examples

### Prerequisites

- Node.js and npm installed
- TypeScript and ts-node installed globally or in your project
- A Solana wallet keypair file
- SOL for transaction fees (devnet or mainnet depending on configuration)

### Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Settings**
   Edit `./config.ts` to set up your environment:
   ```typescript
   // Set to true for devnet, false for mainnet
   export const IS_DEVNET = true;

   // Path to your Solana wallet keypair file
   export const KEYPAIR_PATH = './path/to/your/keypair.json';
   ```

### Running Examples

All example scripts are located in the `./examples/` directory and can be executed using ts-node:

```bash
# Purchase tokens
npx ts-node ./examples/tokens/purchase_tokens.ts

# Stake tokens
npx ts-node ./examples/tokens/stake.ts

# Run an example script.
# Note: Some examples contain Id's that can be modified within the file
npx ts-node ./examples/streaming/stream_odds.ts
npx ts-node ./examples/snapshots/get_odds_snapshot.ts
npx ts-node ./examples/validation/validate_odd_onchain.ts

# Unstake tokens
npx ts-node ./examples/tokens/unstake.ts
```

## Additional Documentation

For comprehensive API documentation:

- **Mainnet Documentation**: [oracle.txodds.com/docs](https://oracle.txodds.com/docs)
- **Devnet Documentation**: [oracle-dev.txodds.com/docs](https://oracle-dev.txodds.com/docs)