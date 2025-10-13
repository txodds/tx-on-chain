# TxODDS Oracle Examples

This repository showcases usage of the Tx Oracle on-chain contract, demonstrating how to interact with sports data validation using Solana blockchain technology.

## Overview

Tx Oracle is a hybrid Solana on-chain and TxODDS hosted off-chain system. It supports the following two main use key cases:

1. **Data Access Layer**. Make proprietary TxODDS data available for any funded blockchain users by linking the on-chain subscribe transactions with issued time-limited API tokens.
   - The data is canonicalised so that all fixtures, odds, or scores are provably unique and can be validated on-chain using cryptographic proofs based on Merkle roots for batches of respective data published to the Solana blockchain.
   - The data is delivered in a request-response or streaming form.
   - One-week long subscriptions are established using a cryptographically secure protocol that assumes that a funded Solana user wallet can (programmatically) purchase `TxODDS subscription tokens` and pay (at the time of writing) a fixed amount of tokens for one-week long access to proprietary data.

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

This validation is based on the mathematical property of Merkle roots such that it is possoble to cryptographically verify whether a given record is *contained* in the referenced batch of data. This serves two purposes: first, the customers can ascertain that the fixture, odds, or scores event was genuine, and secondly, they can engage is trading activities facilitated by the on-chain `txoracle` program and the TxODDS off-chain services, such that one side is able to propose a signed offer based on a prediction that a certain scores event will occur at the specific phase of the game and once the counter-party "agrees to disagreee", accepting the challenge, and with the signed Trade published on-chain, the settlement and funds allocation is based on on-chain proofs that the winning condition was verified. A non-custodial orderbook trading model is also in preparation.

Essentialy the data access layer (use case 1) allows users to front-run their trading activity (use case 2), being fully informed about actual fixture changes, odds, and score events in near real-time--with settlement available as soon as the data is fully confirmed by the published on-chain batch signatures--typically as soon as the current 5-minute interval ends and the corresponding phase of the game arrives, or at the end of the previous completed game phase if the prediction period corresponds to the 'completion phase' (such as Q3 break or break before overtime 2) of the previous active phase.

## Games coverage

As of mid-September 2025, the following data is covered for the fixtures, odds, and scores channels, and available for trading.

| Competition ID       | League Name            |
| :------- | :--------------------- |
| 550001   | NCAA Division I FCS    |
| 10005930 | NCAA Extra Matches     |
| 500005   | NCAA Division I FBS    |
| 10005302 | NCAA Division I (W)    |
| 300043   | NCAA Division I        |

With the upcoming US basketball season, it is expected that data will be available for the the US basketball leagues excluding NBA. Specifically, these conferences should be covered fully:

1. SEC
2. Big Ten
3. Big 12
4. Big East
5. ACC
6. Mountain West
7. West Coast Conference
8. Atlantic 10 Conference
9. Conference USA
10. Missouri Valley
11. American
12. Big West
13. Southern Conference
14. Ivy League
15. Mid-American Conference
16. Horizon League
17. Western Athletic Conference

Regular season only coverage should become available for
1. Summit League
2. Big South Conference
3. Southland Conference
4. Coastal Athletic Conference (CAA)
5. Sun Belt
6. MAAC (Only Sunday, Tuesday, Wednesday, Friday games)
7. American East (non-Saturday games)
8. SWAC Conference (only Monday games)
9. Patriot League (non-Saturday games)
10. ASUN Conference (non-Saturday games)

All of the above conferences are covered by the same competition `NCAA Division I` with competition id = 300043.

## Content in the `scors` channel

The `scores` channel includes the fully detailed model of US football and upcoming US baketball as otherwide avaiable using direct B2B sales offered to big betting operators and syndicats. The documentation for this feed is available at the above API endpoints and also in the included documents:

[TxODDS US Football Feed v1.13](assets/txodds-us-football-feed-v1.13.pdf)

[TxODDS US Baskeball Feed v1.12](assets/txodds-basketball-feed-v1.12.pdf)

In contrast to the B2B offering, (limited) historical access to to data is also included.

## Content on the `fixtures` and `odds` channels

The fixtures updates in the `fixtures` channel represent fixtures' data that became available at the time of publication. The fixtures endpoints are dseigned to provide the best known true information about fixtures available by default at the time of asking or at specific time in the past.

The `odds` channel includes fully de-margined stable odds (effectively, probabilities) for the main markets. The notion is stability comes from the TxODDS stable price B2B product that provides the most consistent view of the betting market, taking care of operators' errors, outages, etc.

## Configurations

### Solana DevNet - contains matches' re-runs to be used for integration
```
Tx API: https://oracle-dev.txodds.com/api/
Program ID: 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
Token Mint: GYdhNurtx2EgiTPRHVGuFWKHPycdpUqgedVkwEVUWVTC
```

### Solana MainNet - contains actual live matches with low-latency delivery from off-chain services (for example, 52 matches covered on Sat, 20 September, 2025)
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

### 2. Access Off-Chain API

With staked tokens, you can access the off-chain API services through the following request flow:

1. **Guest Authentication** - Make a `POST /auth/guest/start` request to receive a JWT token
2. **Create Subscription** - Execute an on-chain `subscribe_with_token` transaction with encrypted JWT payload, which will transfer the price of the subscription in Tx tokens to the TxODDS token treasury.
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

Trading is based on predictions of what one or two stats will be in a given phase of the game (currently covering US Football).

Importantly, there are two time periods involved:

1. **Game phase**: the phase of the game where an event that matches the prediction will happen.
2. **Stat period**: the phase of the game for which the respective stats are computed.

A prediction will be confirmed IF AND ONLY IF there exists a record with confirmed stats within the given **game phase** that meets the prediction condition. For the prediction to be settled and funds dispersed according to the result, the winner side sibmits a proof of such record matching the trade details in their favour that can be validated on-chain to have existed within this phase of the game.

This is an example to help with understanding these two time periods.

### Example

Prediction might concern the margin of difference between the counts of touchdowns in Q2 of the game. In this case, Q2 is the **stat period**. The question is when it is predicted this margin will have occurred.
The **game phase** could be set to end of Q2, that is what is known in the TxODDS scores product as Q2B--the break in the game after Quarter 2.

Another prediction could be set to be based on a stat that is related to the first half of the game, so the **stat period** could be easily adjust to become H1 and then the nature of the prediction changes accordingly.

There is a further important question: what is the difference between a prediction for the **game phase** Q2 and Q2B? The latter is very easy to understand: if the prediction concerns a record with confirmed game stats for Q2B, the stats will correspond to the Q2 result--because once the game is in a break, the stats correspond to the result of the previous active phase of the game, which is, in the example, Q2. What happens if the **game phase** is set to Q2 itself? The prediction logic outlined above dictates that there must exist at least a single record within the whole Q2 that matches the prediction condition. This latter type of predictions could be fully settled as soon as the current 5-minute interval expires (as long as the qualifying event had occurred before its end) supporting very fast turnaround of bets and settlements.

### Game phase encoding

For US football, the game phases are encoded in a unique and economical way for easy prediction proofs on-chain. There are core 

| Name   | ID   | Game phase | Description |
|--------|------|------|-------|
| `NS`   | 1    |  Not started | Status before the game is started         |
| `Q1`   | 2    |  Quarter 1 | Game in play during first quarter         |
| `Q1B`  | 3    |  Quarter 1 break | Pause in play between the 1st quarter ending and the 2nd quarter starting         |
| `Q2`   | 4    |  Quarter 2 | Game in play during second quarter         |
| `HT`   | 5    |  Halftime | Halftime of the game         |
| `Q3`   | 6    |  Quarter 3 | Game in play during third quarter         |
| `Q3B`  | 7    |  Quarter 3 break | Pause in play between the 3rd quarter ending and the 4th quarter starting         |
| `Q4`   | 8    |  Quarter 4 |Game in play during fourth quarter         |
| `F`    | 9    |  Ended (finished) | Game ends after the 4th quarter         |
| `WO`   | 10   |  Waiting for Overtime  | Break following the 4th Quarter before the start of the first overtime period |
| `OT`   | 11   |  Overtime | With option for overtime number to be selected. Game in play during selected overtime period         |
| `OB`   | 12   | Overtime Break | Break between Overtime periods         |
| `FO`   | 13   |  Ended after Overtime (Finished after Overtime) | Game ends after an overtime period         |
| `I`    | 14   |    Interrupted         | The game is officially interrupted |
| `A`    | 15   |    Abandoned         | The game is officially abandoned |
| `C`    | 16   |    Cancelled         | The game is officially cancelled |
| `TXCC` | 17   |    TX Coverage Cancelled         | TxODDS cancelled coverage of the event |
| `TXCS` | 18   |    TX Coverage Suspended         | TxOODS suspended coverage of the event |

---

### Overtime status -- these are specific to the TxODDS Oracle system

| Name   | ID    | Game phase |
|--------|-------|-------------|
| `OT1`  | 1011  | Overtime 1 |
| `OB1`  | 1012  | Overtime 1 break |
| `OT2`  | 2011  | Overtime 2 |
| `OB2`  | 2012  | Overtime 2 break |
| `OT3`  | 3011  | Overtime 3 |
| `OB3`  | 3012  | Overtime 3 break |
| `OT4`  | 4011  | Overtime 4 |
| `OB4`  | 4012  | Overtime 4 break |
| `OT5`  | 5011  | Overtime 5 |
| `OB5`  | 5012  | Overtime 5 break |
| `OT6`  | 6011  | Overtime 6 |
| `OB6`  | 6012  | Overtime 6 break |
| `OT7`  | 7011  | Overtime 7 |
| `OB7`  | 7012  | Overtime 7 break |
| `OT8`  | 8011  | Overtime 8 |
| `OB8`  | 8012  | Overtime 8 break |
| `OT9`  | 9011  | Overtime 9 |
| `OB9`  | 9012  | Overtime 9 break |
| `OT10` | 10011 | Overtime 10 |
| `OB10` | 10012 | Overtime 10 break |
| `OT11` | 11011 | Overtime 11 |
| `OB11` | 11012 | Overtime 11 break |
| `OT12` | 12011 | Overtime 12 |

Prediction offers reference the game phase by ID taken from the above two tables.

### Stat period encoding

The stat period is also encoded economically as follows:

### Full Game Stats

| Key | Statistic | Description |
|---|---|---|
| 1 | Participant 1 Total Score | |
| 2 | Participant 2 Total Score | |
| 3 | Participant 1 Total Touchdowns | |
| 4 | Participant 2 Total Touchdowns | |
| 5 | Participant 1 Total Field Goals | |
| 6 | Participant 2 Total Field Goals | |
| 7 | Participant 1 Total 1pt Conversions | |
| 8 | Participant 2 Total 1pt Conversions | |
| 9 | Participant 1 Total 2pt Conversions | |
| 10 | Participant 2 Total 2pt Conversions | |
| 11 | Participant 1 Total Safeties | |
| 12 | Participant 2 Total Safeties | |
| 13 | Participant 1 Total 1pt Safeties | |
| 14 | Participant 2 Total 1pt Safeties | |
| 15 | Participant 1 Total Defensive 2pt Conversions | |
| 16 | Participant 2 Total Defensive 2pt Conversions | |

---

### First Half (HT) Stats

| Key | Statistic | Description |
|---|---|---|
| 1001 | Participant 1 1st Half Score | |
| 1002 | Participant 2 1st Half Score | |
| 1003 | Participant 1 1st Half Touchdowns | |
| 1004 | Participant 2 1st Half Touchdowns | |
| 1005 | Participant 1 1st Half Field Goals | |
| 1006 | Participant 2 1st Half Field Goals | |
| 1007 | Participant 1 1st Half 1pt Conversions | |
| 1008 | Participant 2 1st Half 1pt Conversions | |
| 1009 | Participant 1 1st Half 2pt Conversions | |
| 1010 | Participant 2 1st Half 2pt Conversions | |
| 1011 | Participant 1 1st Half Safeties | |
| 1012 | Participant 2 1st Half Safeties | |
| 1013 | Participant 1 1st Half 1pt Safeties | |
| 1014 | Participant 2 1st Half 1pt Safeties | |
| 1015 | Participant 1 1st Half Defensive 2pt Conversions | |
| 1016 | Participant 2 1st Half Defensive 2pt Conversions | |

---

### Second Half (Q3+Q4) Stats

| Key | Statistic | Description |
|---|---|---|
| 2001 | Participant 1 2nd Half Score | |
| 2002 | Participant 2 2nd Half Score | |
| 2003 | Participant 1 2nd Half Touchdowns | |
| 2004 | Participant 2 2nd Half Touchdowns | |
| 2005 | Participant 1 2nd Half Field Goals | |
| 2006 | Participant 2 2nd Half Field Goals | |
| 2007 | Participant 1 2nd Half 1pt Conversions | |
| 2008 | Participant 2 2nd Half 1pt Conversions | |
| 2009 | Participant 1 2nd Half 2pt Conversions | |
| 2010 | Participant 2 2nd Half 2pt Conversions | |
| 2011 | Participant 1 2nd Half Safeties | |
| 2012 | Participant 2 2nd Half Safeties | |
| 2013 | Participant 1 2nd Half 1pt Safeties | |
| 2014 | Participant 2 2nd Half 1pt Safeties | |
| 2015 | Participant 1 2nd Half Defensive 2pt Conversions | |
| 2016 | Participant 2 2nd Half Defensive 2pt Conversions | |

---

### Quarter 1 Stats

| Key | Statistic | Description |
|---|---|---|
| 10001 | Participant 1 Q1 Score | |
| 10002 | Participant 2 Q1 Score | |
| 10003 | Participant 1 Q1 Touchdowns | |
| 10004 | Participant 2 Q1 Touchdowns | |
| 10005 | Participant 1 Q1 Field Goals | |
| 10006 | Participant 2 Q1 Field Goals | |
| 10007 | Participant 1 Q1 1pt Conversions | |
| 10008 | Participant 2 Q1 1pt Conversions | |
| 10009 | Participant 1 Q1 2pt Conversions | |
| 10010 | Participant 2 Q1 2pt Conversions | |
| 10011 | Participant 1 Q1 Safeties | |
| 10012 | Participant 2 Q1 Safeties | |
| 10013 | Participant 1 Q1 1pt Safeties | |
| 10014 | Participant 2 Q1 1pt Safeties | |
| 10015 | Participant 1 Q1 Defensive 2pt Conversions | |
| 10016 | Participant 2 Q1 Defensive 2pt Conversions | |

---

### Quarter 2 Stats

| Key | Statistic | Description |
|---|---|---|
| 20001 | Participant 1 Q2 Score | |
| 20002 | Participant 2 Q2 Score | |
| 20003 | Participant 1 Q2 Touchdowns | |
| 20004 | Participant 2 Q2 Touchdowns | |
| 20005 | Participant 1 Q2 Field Goals | |
| 20006 | Participant 2 Q2 Field Goals | |
| 20007 | Participant 1 Q2 1pt Conversions | |
| 20008 | Participant 2 Q2 1pt Conversions | |
| 20009 | Participant 1 Q2 2pt Conversions | |
| 20010 | Participant 2 Q2 2pt Conversions | |
| 20011 | Participant 1 Q2 Safeties | |
| 20012 | Participant 2 Q2 Safeties | |
| 20013 | Participant 1 Q2 1pt Safeties | |
| 20014 | Participant 2 Q2 1pt Safeties | |
| 20015 | Participant 1 Q2 Defensive 2pt Conversions | |
| 20016 | Participant 2 Q2 Defensive 2pt Conversions | |

---

### Quarter 3 Stats

| Key | Statistic | Description |
|---|---|---|
| 30001 | Participant 1 Q3 Score | |
| 30002 | Participant 2 Q3 Score | |
| 30003 | Participant 1 Q3 Touchdowns | |
| 30004 | Participant 2 Q3 Touchdowns | |
| 30005 | Participant 1 Q3 Field Goals | |
| 30006 | Participant 2 Q3 Field Goals | |
| 30007 | Participant 1 Q3 1pt Conversions | |
| 30008 | Participant 2 Q3 1pt Conversions | |
| 30009 | Participant 1 Q3 2pt Conversions | |
| 30010 | Participant 2 Q3 2pt Conversions | |
| 30011 | Participant 1 Q3 Safeties | |
| 30012 | Participant 2 Q3 Safeties | |
| 30013 | Participant 1 Q3 1pt Safeties | |
| 30014 | Participant 2 Q3 1pt Safeties | |
| 30015 | Participant 1 Q3 Defensive 2pt Conversions | |
| 30016 | Participant 2 Q3 Defensive 2pt Conversions | |

---

### Quarter 4 Stats

| Key | Statistic | Description |
|---|---|---|
| 40001 | Participant 1 Q4 Score | |
| 40002 | Participant 2 Q4 Score | |
| 40003 | Participant 1 Q4 Touchdowns | |
| 40004 | Participant 2 Q4 Touchdowns | |
| 40005 | Participant 1 Q4 Field Goals | |
| 40006 | Participant 2 Q4 Field Goals | |
| 40007 | Participant 1 Q4 1pt Conversions | |
| 40008 | Participant 2 Q4 1pt Conversions | |
| 40009 | Participant 1 Q4 2pt Conversions | |
| 40010 | Participant 2 Q4 2pt Conversions | |
| 40011 | Participant 1 Q4 Safeties | |
| 40012 | Participant 2 Q4 Safeties | |
| 40013 | Participant 1 Q4 1pt Safeties | |
| 40014 | Participant 2 Q4 1pt Safeties | |
| 40015 | Participant 1 Q4 Defensive 2pt Conversions | |
| 40016 | Participant 2 Q4 Defensive 2pt Conversions | |

There is a very simple formula used for the above encoding such that the half number is multiplied by 1000 while the quarter number is multiplied by 10000. It is then added to the original code
for the full game.

### Specify the stat period

The Stat period as used in offers and settlements is wrapped in the `StatTerm` class that designates the statistic used for prediction. For example:

```
{ key: 1 } // Stat key for "Participant1_Score"
```

### Specify a trading predicate

A trading predicate is wrapped in the `Predicate` class with a nested `ComparisonEnum`. Here is an example in TypeScript:

```
const predicate = {
  threshold: 11,
  comparison: { greaterThan: {} }, 
};    
```

Essentially, the trading predicate sets a bar to compare against and accepts three modes for comparison: `greaterThan`, `lessThan`, and `equalTo`. Predicates do not specify what expression 
or statistics to use, instead, they just capture the actual comparison being made against the specified quantity (threshold).

### Specify an optional binary expression

A binary expression (when not-null) is either `add` or `subtract` is wrapped in the `BinaryOpEnum` class. For example,

binaryOp = {
   add: {}
}

## Create a new offer

An `Offer` structure wraps all necessary information for specifying the prediction and associated terms made by the offer originator side (trader). Here is an example of a one-stat prediction:

```
const predicate = {
  threshold: 11,
  comparison: { greaterThan: {} }, 
};    

const offer = new schema.Offer({
   fixtureId: new BN(17271370),
   period: 4, // Q2
   predicate,
   binaryOp: null, // This is a single-stat predicate
   statA: { key: 1 }, // Stat key for "Participant1_Score"
   statB: null,
   stake: new BN(500_000_000), // 0.5 SOL
   odds: 2000, // 2.0 decimal odds
   expiration: new BN(Date.now() + 60 * 60 * 1000), // Expires in 1 hour
   traderPubkey: user.publicKey,
});
```

The `odds` are decimal odds, multiplied by 1000 to preserve a three-decimal point precision. The decimal odds mean that if the prediction turns out to be true, trader A stands to double their original stake--with
the eventual counter-party losing the amount of tokens equivalent to 0.5 SOL.
The offer states that the specified fixture during the half-time break is going to have the team A's total score greater than 11--this being the result after the two quarters are fully played. The offer will be self-managed so that after an hour from the offer submission, the matching by counter-parties will be disabled.

Once the offer is acknoledged by the TxODDS off-chain service, the subscribers to the `/trading/stream` will receive a nottification `NewOffer` that looks like this:

```
{ offerId: 6,
  offer:
   {
      fixtureId: 17271370,
      period: 4,
      predicate: { threshold: 11, comparison: { type: 'GreaterThan' } },
      binaryOp: null,
      statA: { key: 2 },
      statB: null,
      stake: 500000000,
      odds: 2000,
      expiration: 1758365295729,
      traderPubkey: '8g2nck8iiaZNjaXA9doPRabA9k1CBKqThPcADfhvC1tF'
      }
}
```

### Accept a new offer

A counter-party trader B may elect to accept this offer, which means that they are confident that the odds of 2.0 that trader A specified are too low, meaning trader B believes the prediction in the offer is unlikely to succeed at these odds. This is how trader B accepts the offer:

```
const messageBuffer = new BN(offerIdToAccept).toBuffer('le', 4);
const signature = nacl.sign.detached(messageBuffer, user.secretKey);

const acceptancePayload = {
   offerId: offerIdToAccept,
   acceptingTraderPubkey: user.publicKey.toBase58(),
   signature: bs58.encode(signature),
};

const response = await axios.post(`${API_BASE_URL}/api/trading/accept`, acceptancePayload, {
   headers: {
      'Authorization': `Bearer ${jwt}`,
      'X-Api-Token': apiToken
   }
});
```

Once the TxODDS of-chain service receives a counter-offer on the `accept` endpoint, it creates a new unsigned Solana transaction `create_trade` and sends it to both trades for signing via this `SigningRequest` message:

```
{
   tradeId: 6,
   partiallySignedTx: 'abc',
   recipientPubkey: 'abc'
}
```

### Both parties sign the trade

For the `create_trade` to be executable on blockchain, it needs to have three signers: both traders and the authority behind the `txoracle` program belonging to TxODDS. The latter is obviously readily available to our off-chain service but the former two signatures need to be explicitly collected from traders. The above `SigningRequest` is received by both traders and each use a similar method to sign and send it back to the TxODDS service.

```
const messageToSign = Buffer.from(data.partiallySignedTx, 'base64');
const signature = nacl.sign.detached(messageToSign, user.secretKey);

const signaturePayload = {
   tradeId: data.tradeId,
   signer: user.publicKey.toBase58(),
   signature: bs58.encode(signature),
};

await axios.post(`${API_BASE_URL}/api/trading/sign`, signaturePayload, {
   headers: {
   'Authorization': `Bearer ${jwt}`,
   'X-Api-Token': apiToken
   }
});
```

Once the TxODDS off-chain service receives both signatures, it signs the unsigned transaction with those signatures, adds the TxODDS authority signature and submits the trade to the Solana blockchain using a fully signed `create_trade` transaction.

The TxODDS service then copies the same `TradeMatched` notifications to respective trading streams for both traders.

```
{
   offer: {
   fixtureId: 17271370,
   period: 4,
   predicate: { threshold: 11, comparison: { type: 'GreaterThan' } },
   binaryOp: null,
   statA: { key: 1 },
   statB: null,
   stake: 500000000,
   odds: 2000,
   expiration: 1758366631894,
   traderPubkey: '8g2nck8iiaZNjaXA9doPRabA9k1CBKqThPcADfhvC1tF'
   }
}
```

### The winning trader submits a `settle_trade` transaction directly to the `txoracle` program on blockchain

Both traders manage their positions by front-running their subscriptions to the odds and scores channels. Once one of them is clear the predication can be resolved in their favour (there can be only one winner to any given predicate), they call the off-chain TxODDS service to obtain a partial proof of the scores record that settles the prediction in their favour and then call the `txoracle` program with this proof.

```
const url = `${API_BASE_URL}/api/scores/stat-validation?fixtureId=17271370&seq=401&statKey=1`
const response = await axios.get(url, {
   headers: {
      'Authorization': `Bearer ${jwt}`,
      'X-Api-Token': apiToken
   }
});
```

The `seq` uniquely identified the scores update from the scores feed for the fixture in the original offer. The putative winner can locally check that the scores event they consumed will be resolved in their favour. In our worked example, trader B is the winner bacause the actual team A score was not > than 11. Here is the call to on-chain to settle the trade.

```
const [dailyScoresPda, _] = anchor.web3.PublicKey.findProgramAddressSync(
   [
      Buffer.from("daily_scores_roots"),
      new BN(epochDay).toBuffer("le", 2), // epochDay is u16, so 2 bytes little-endian
   ],
   program.programId
);

const [tradeEscrowPda] = PublicKey.findProgramAddressSync(
   [
      Buffer.from("escrow"), 
      tradeId.toBuffer("le", 8)
   ],
   program.programId
);

const [escrowVaultPda] = PublicKey.findProgramAddressSync(
   [
      Buffer.from("escrow_vault"), 
      tradeId.toBuffer("le", 8)
   ],
   program.programId
);

const txSignature = await program.methods
   .settleTrade(
      tradeId,
      new BN(validation.ts),
      fixtureSummary,
      fixtureProof,
      mainTreeProof,
      predicate,
      stat1,
      null, // stat2
      null // op
   )
   .accounts({
      winner: user.publicKey,
      dailyScoresMerkleRoots: dailyScoresPda,
      tradeEscrow: tradeEscrowPda,
      escrowVault: escrowVaultPda,
      winnerTokenAccount: tokenAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
   })
   .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({
      units: 600_000, // max: 1.4M
      }),
   ])
   .signers([user])
   .rpc();
```

The outcome of a successfully settled trade is that the funds are released from the escrow account and transferred to trader B's token account and then the escrow is fully closed. Here is an example of such settlement on DevNet:

https://explorer.solana.com/tx/f7t9VqWyumtqAeFuFqRhp8t6QX693h68ZZ5Wa4pe1ebbEusuuRyLDgo4ARpQ4GS8P1CkW6xvstBtQi4z8cyfSup?cluster=devnet

## Additional Documentation

For comprehensive API documentation:

- **Mainnet Documentation**: [oracle.txodds.com/docs](https://oracle.txodds.com/docs)
- **Devnet Documentation**: [oracle-dev.txodds.com/docs](https://oracle-dev.txodds.com/docs)