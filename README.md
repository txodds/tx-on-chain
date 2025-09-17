# TxODDS Oracle Examples

This repository showcases usage of the Tx Oracle on-chain contract, demonstrating how to interact with sports data validation using Solana blockchain technology.

## Overview

Tx Oracle is a hybrid Solana on-chain and TxODDS hosted off-chain system. It supports the following two main use key cases:

1. **Data Access Layer**. Make proprietary TxODDS data available for any funded blockchain users by linking the on-chain subscribe transactions with issued time-limited API tokens.
   - The data is canonicalised so that all fixtures, odds, or scores are provably unique and can be validated on-chain using cryptographic proofs based on Merkle roots for batches of respective data published to the Solana blockchain.
   - The data is delivered in a request-response or streaming form.
   - One-week long subscriptions are established using a cryptographically secure protocol that assumes that a funded Solana user wallet can (programmatically) purchase `TxODDS subscription tokens` (used as a temporal fully returnable collateral) and pay for access to proprietary data using the SOL currency.

2. **Prediction-based trading** Sophisticated and highly general binary options Trading that allows users to:
   - submit cryptographically signed College Football and Basketball prediction offers for specified time periods,
   - receive via stream the resulting notifications to paid subscribers over the Trading stream,
   - accept and cryptorgaphically sign the offers (once the trade match is confirmed by the off-chain service, a fully-secure on-chain escrow is created with the matching sides token funds),
   - settle the trades if they have identified a scores record that proves the trade can be resolved in their favour, with escrow funds released into the winner's account.

The following is a basic diagram showing the system in operation.

![Alt text](assets/TxODDS%20Oracle.png?raw=true "TxODDS Oracle")

The OpenAPI documentation is available at
   - https://oracle-dev.txodds.com/docs for Solana DevNet use.
   - https://oracle.txodds.com/docs for Solana MainNet use.

The data the Oracle system is currently offering includes
- fixture snapshots/updates: every time any key metadata for a fixture changes, an update becomes available;
- odds: specifically, what is known as TxODDS stable de-margined price available for much more sports and markets in the TxODDS Fusion product;
- scores: fully detailed (down to every on-the field action) updates for US College Football and US College Basketball matches.

The data is distributed in real-time via request-response or low latency streaming to paying blockchain customers known only by the public keys of their wallets. Simultaneously, the batches accumulated over revolving UTC clock-aligned time intervals periods of 5 minutes for odds and scores and 1 jour for fixture snapshots, are cryptographically signed at the end of these intervals. The resulting signature, known as a `Merkle root`, is published on-chain in perpetuity. The `txoracle` Solana program developed by TxODDS in the Rust language and deployed to both Solana DevNet and Solana MainNet (see the public keys below) is working in tandem with the off-chain components to ensure that any published data from the above three channels can be validated against the on-chain signatures.

This validation is based on the mathematical property of Merkle roots such that it is possoble to cryptographically validate whether a given record is contained in the referenced batch of data. This serves two purposes: first, the customers can ascertain that the fixture, odds, or scores event was genuine, and secondly, they can engage is trading activities facilitated by the on-chain `txoracle` program and the TxODDS off-chain services, such that one side is able to propose a signed offer based on a prediction that a certain scores event will occur at the specific phase of the game and once the counter-party "agrees to disagreee", accepting the challenge, and with the signed Trade published on-chain, the settlement and funds allocation is based on on-chain proofs that the winning condition was verified.

Essentialy the data access layer (use case 1) allows users to front-run their trading activity (use case 2), being fully informed about actual fixture changes, odds, and score events in near real-time--with settlement available as soon as the data is fully confirmed by the published on-chain batch signatures--typically as soon as the current 5-minute interval ends and the corresponding phase of the game arrives.

## Included data

As of mid-September 2025, the following data is covered for the fixtures, odds, and scores channels, and available for trading.

| Competition ID       | League Name            |
| :------- | :--------------------- |
| 550001   | NCAA Division I FCS    |
| 10005930 | NCAA Extra Matches     |
| 500005   | NCAA Division I FBS    |
| 10005302 | NCAA Division I (W)    |
| 300043   | NCAA Division I        |

With the upcoming US basketball season, it is expected that data will be available for the the US basketball leagues excluding NBA.

The `scores` channel includes the fully detailed model of US football (and upcoming baketball) as avaiable otherwide using direct institutional sales offered to big betting operators and syndicats. The documentation for this feed is vailable at the above API endpoints and also in the included document:

[TxODDS US Football Feed v1.13 (PDF)](assets/usfootball%20-%20Version%201.13%20-%2015th%20September%202025.pdf)

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

The following diagram shows how the users typically access data from purchasing the subscription tokens to issuing off-chain calls.

![Alt text](assets/TxODDS%20Oracle%20data%20access%20workflow.png?raw=true "TxODDS Oracle data access workflow")

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

## Available Examples

### Token Management

#### `examples/tokens/purchase_tokens.ts`
Demonstrates how to purchase TxOracle subscription tokens using SOL.
1. Executes on-chain token purchase transaction
2. Transfers tokens from treasury to user's account

#### `examples/tokens/stake.ts`
Shows how to stake purchased tokens to gain API access.
1. Creates a stake account for the user
2. Transfers tokens from user account to stake vault
3. Locks tokens for the minimum period 
4. Enables user to create subscriptions

#### `examples/tokens/unstake.ts`
Demonstrates how to withdraw staked tokens after the lock period.
1. Verifies the stake lock period has expired
2. Transfers tokens back from stake vault to user account
3. Closes the stake vault and stake account
4. Returns rent to the user

### Data Snapshots

#### `examples/snapshots/get_fixtures_snapshot.ts`
Accesses fixture data via the API.
1. Authenticates and creates API subscription
2. Retrieves fixtures snapshots for a given date/competitionId
4. Shows responses from each snapshot endpoint

#### `examples/snapshots/get_odds_snapshot.ts`
Accesses odds data via the API.
1. Authenticates and creates API subscription
2. Retrieves odds snapshots for a given fixtureId/date/competitionId
4. Shows responses from each snapshot endpoint

#### `examples/snapshots/get_scores_snapshot.ts`
Accesses scores data via the API.
1. Authenticates and creates API subscription
2. Retrieves scores snapshots for a given fixtureId/date/competitionId
4. Shows responses from each snapshot endpoint

### Data Streaming

#### `examples/streaming/stream_odds.ts`
Demonstrates real-time odds streaming using Server-Sent Events (SSE).
1. Authenticates and creates API subscription
2. Establishes SSE connection to odds stream
3. Displays live odds messages

#### `examples/streaming/stream_scores.ts`
Demonstrates real-time scores streaming using Server-Sent Events (SSE).
1. Authenticates and creates API subscription
2. Establishes SSE connection to scores stream
3. Displays live scores messages

### On-Chain Validation

#### `examples/validation/validate_fixtures_onchain.ts`
Validates fixture data using on-chain cryptographic proofs.
1. Authenticates and creates API subscription
2. Fetches college football fixture data from last Saturday
3. Retrieves validation proofs from the API
4. Constructs proof for On-Chain protocol
5. Executes on-chain validation against ten daily batch roots account
6. Cryptographically proves the fixture

#### `examples/validation/validate_odds_onchain.ts`
Validates odds data using on-chain cryptographic proofs.
1. Authenticates and creates API subscription
2. Fetches college football fixture data from last Saturday
3. Retrieves odds validation proofs from the API
4. Constructs proof for On-Chain protocol
5. Executes on-chain validation against daily batch roots account
6. Cryptographically proves the price


#### `examples/validation/validate_scores_onchain.ts`
Validates scores data using on-chain cryptographic proofs.
1. Authenticates and creates API subscription
2. Fetches college football fixture data from last Saturday
3. Retrieves stat validation proofs from the API
4. Constructs proof for On-Chain protocol
5. Executes on-chain validation against daily scores roots account
6. Cryptographically proves the stat

## Trading Flow

The following diagram gives an overview of how binary options predication markets work with TxODDS Oracle.

![Alt text](assets/TxODDS%20Oracle%20trading%20workflow.png?raw=true "TxODDS Oracle trading workflow")

## Additional Documentation

For comprehensive API documentation:

- **Mainnet Documentation**: [oracle.txodds.com/docs](https://oracle.txodds.com/docs)
- **Devnet Documentation**: [oracle-dev.txodds.com/docs](https://oracle-dev.txodds.com/docs)