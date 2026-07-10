# TxLINE Documentation

This repository contains the public TxLINE documentation sources, on-chain IDL/types, and supporting assets for integrating with the TxLINE hybrid Solana and TxODDS off-chain data system. Start with the current hosted documentation at https://txline.txodds.com/documentation/quickstart.

## Overview

TxLINE is a hybrid Solana on-chain and TxODDS hosted off-chain system. It supports the following two main use cases:

**Data Access Layer**. Make proprietary TxODDS data available for any funded blockchain users by linking the on-chain subscribe transactions with issued time-limited API tokens.

   - The data is canonicalised so that all fixtures, odds, or scores are provably unique and can be validated on-chain using cryptographic proofs based on Merkle roots for batches of respective data published to the Solana blockchain.
   - The data is delivered in a request-response or streaming form.
   - Subscriptions are established on-chain with `subscribe(serviceLevelId, durationWeeks)` and activated off-chain with time-limited API tokens. Free World Cup and International Friendlies tiers do not require a TxL purchase; paid tiers use TxL.

**Prediction-based trading** Sophisticated and highly general binary options Trading that allows users to:

   - submit cryptographically signed College Football and Basketball prediction offers for specified time periods,
   - receive via stream the resulting notifications to paid subscribers over the Trading stream,
   - accept and cryptorgaphically sign the offers (once the trade match is confirmed by the off-chain service, a fully-secure on-chain escrow is created with the matching sides token funds),
   - if a user has identified a scores record that proves the trade can be resolved in their favour, the user requests the proofs from the off-chain server, and directly settles the trade on-chain, with escrow funds released into the winner's account.

The following is a basic diagram showing the system in operation.

![Alt text](assets/TxODDS%20Oracle.png?raw=true "TxODDS Oracle")

The hosted API reference is available from the TxLINE documentation site. The current OpenAPI YAML is published at https://txline.txodds.com/docs/docs.yaml.

The data the Oracle system is currently offering includes
- fixture snapshots/updates: every time any key metadata for a fixture changes, an update becomes available;
- odds: specifically, what is known as TxODDS stable de-margined price available for much more sports and markets in the TxODDS Fusion product;
- scores: fully detailed (down to every on-the field action) updates for US College Football and US College Basketball matches.

The data is delivered through request-response APIs or streaming to authenticated subscribers, with delay determined by the selected service level. Simultaneously, the batches accumulated over revolving UTC clock-aligned time intervals periods of 5 minutes for odds and scores and 1 jour for fixture snapshots, are cryptographically signed at the end of these intervals. The resulting signature, known as a `Merkle root`, is published on-chain in perpetuity. The `txoracle` Solana program developed by TxODDS in the Rust language and deployed to both Solana DevNet and Solana MainNet (see the public keys below) is working in tandem with the off-chain components to ensure that any published data from the above three channels can be validated against the on-chain signatures.

This validation is based on the mathematical property of Merkle roots such that it is possoble to cryptographically verify whether a given record is *contained* in the referenced batch of data. This serves two purposes: first, the customers can ascertain that the fixture, odds, or scores event was genuine, and secondly, they can engage is trading activities facilitated by the on-chain `txoracle` program and the TxODDS off-chain services, such that one side is able to propose a signed offer based on a prediction that a certain scores event will occur at the specific phase of the game and once the counter-party "agrees to disagreee", accepting the challenge, and with the signed Trade published on-chain, the settlement and funds allocation is based on on-chain proofs that the winning condition was verified. A non-custodial orderbook trading model is also in preparation.

Essentialy the data access layer (use case 1) allows users to front-run their trading activity (use case 2), being fully informed about actual fixture changes, odds, and score events in near real-time--with settlement available as soon as the data is fully confirmed by the published on-chain batch signatures--typically as soon as the current 5-minute interval ends and the corresponding phase of the game arrives, or at the end of the previous completed game phase if the prediction period corresponds to the 'completion phase' (such as Q3 break or break before overtime 2) of the previous active phase.

## Coverage and Free Tiers

Current coverage and pricing are documented in the hosted docs:

- [World Cup Free Tier](https://txline.txodds.com/documentation/worldcup) - documented free access for World Cup and International Friendlies data.
- [Subscription Tiers](https://txline.txodds.com/documentation/subscription-tiers) - free and paid tier IDs, delays, and 28-day pricing.
- [StablePrice Feed](https://txline.txodds.com/documentation/odds/odds-coverage) - covered odds competitions and downloadable soccer league list.
- [Scores Schedule](https://txline.txodds.com/documentation/scores/schedule) - currently listed confirmed fixtures.

## Content in the `scores` channel

The `scores` channel includes the detailed models for US football and US basketball. Feed-specific documentation is available in the hosted docs and in the included PDF assets:

[TxODDS US Football Feed v1.17.4](assets/txodds-us-football-feed-v1.17.4.pdf)

[TxODDS US Basketball Feed v1.14.2](assets/txodds-basketball-feed-v1.14.2.pdf)

The historical scores endpoint covers fixtures whose start times are between two weeks and six hours in the past.

## Content in the `fixtures` and `odds` channels

The fixtures updates in the `fixtures` channel represent fixtures' data that became available at the time of publication. The fixtures endpoints are dseigned to provide the best known true information about fixtures available by default at the time of asking or at specific time in the past.

The `odds` channel includes fully de-margined stable odds (effectively, probabilities) for the main markets. The notion is stability comes from the TxODDS stable price B2B product that provides the most consistent view of the betting market, taking care of operators' errors, outages, etc.

## Configurations

### Solana Devnet
```
Tx API: https://txline-dev.txodds.com/api/
Program ID: 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
TxL Token Mint: 4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG
USDT Mint: ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh
```

### Solana Mainnet
```
Tx API: https://txline.txodds.com/api/
Program ID: 9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA
TxL Token Mint: Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL
USDT Mint: Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
```

## Access Flow

The following diagram shows how users typically move from subscription setup to off-chain API calls.

![Alt text](assets/TxODDS%20Oracle%20data%20access%20workflow.png?raw=true "TxODDS Oracle data access workflow")

Use one network consistently. Devnet subscribe transactions must use the devnet API host (`https://txline-dev.txodds.com`), and mainnet subscribe transactions must use the mainnet API host (`https://txline.txodds.com`).

1. **Start a guest session** - call `POST /auth/guest/start` on the matching TxLINE host to receive the guest JWT.
2. **Purchase TxL if needed** - paid tiers use `POST /api/guest/purchase/quote`, which returns a serialized transaction. The Quickstart deserializes it for inspection and deliberately stops before signing or broadcasting. An integration must first implement and review exact checks for every program, instruction, writable or signing account, fee payer, mint, recipient, amount, blockhash assumption, and unrelated instruction. Free World Cup tiers do not require a TxL purchase.
3. **Subscribe on-chain** - call `program.methods.subscribe(serviceLevelId, durationWeeks)` with the `pricing_matrix` PDA and `token_treasury_v2` PDA/vault accounts.
4. **Activate API access** - sign `${txSig}:${selectedLeagues.join(",")}:${jwt}` with the subscription wallet, then call `POST /api/token/activate` on the matching TxLINE host. For the free standard bundle, `selectedLeagues = []`, so the exact signed message is `${txSig}::${jwt}`.
5. **Call data APIs** - send `Authorization: Bearer <guest-jwt>` and `X-Api-Token: <activated-api-token>` on fixtures, odds, and scores requests.

## Current Examples

The hosted documentation contains copy-paste snippets, and `examples/devnet` contains runnable devnet activation, snapshot, streaming, historical, and validation flows:

- [Quickstart](https://txline.txodds.com/documentation/quickstart) - purchase, subscribe, activate, and API-token header setup.
- [Fetching Snapshots](https://txline.txodds.com/documentation/examples/fetching-snapshots) - fixtures, odds, and scores snapshots.
- [Streaming Data](https://txline.txodds.com/documentation/examples/streaming-data) - odds and scores Server-Sent Events.
- [On-Chain Validation](https://txline.txodds.com/documentation/examples/onchain-validation) - validation proof retrieval and program calls.
- [Runnable Devnet Examples](https://github.com/txodds/tx-on-chain/tree/main/examples/devnet) - dynamic score discovery, bounded streams, historical replay, and fail-closed on-chain simulations.

## Validation Phase Semantics

Score proofs distinguish the phase in which an observation was recorded from the period over which a statistic was computed. Public integrations should use the validation methods in the network-matched IDL and the hosted data APIs; internal transaction-construction flows are not part of the public examples.

Importantly, there are two time periods involved:

1. **Claim period**: the phase of the game where an event that matches the prediction will happen.
2. **Stat period**: the phase of the game for which the respective stats are computed.

A condition is proven only when a record with confirmed stats exists within the selected **claim period/game phase** and its Merkle proof validates on-chain.

The following example explains the distinction between these two time periods.

### Example

Prediction might concern the margin of difference between the counts of touchdowns in Q2 of the game. In this case, Q2 is the **stat period**. The question is when it is predicted this margin will have occurred.
The **claim period** could be set to end of Q2, that is what is known in the TxODDS scores product as HT--the half-time break in the game.

Another condition could use a stat related to the first half of the game, so the **stat period** would become H1 and the meaning of the proof changes accordingly.

There is a further important question: what is the difference between a condition for the **claim period** Q2 and HT? For HT, confirmed stats correspond to the preceding active Q2 phase. If the **claim period** is Q2 itself, a matching record can occur at any observed moment within Q2. These are different proof semantics and must not be interchanged in settlement logic.

## Game phase encoding for US Football

For US football, the game phases are encoded in a unique and economical way for easy prediction proofs on-chain.

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

## Stat period encoding for US Football

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

## Game phase encoding for US Basketball

For US basketball, the game phases are encoded in a unique and economical way for easy prediction proofs on-chain. 

| Name   | ID   | Game phase | Competitions | Description |
|--------|------|------|-----|-------|
| `NS`   | 1    |  Not started | Status before the game is started         |
| `Q1`   | 2    |  Quarter 1 | NBA | Game in play during first quarter         |
| `Q1B`  | 3    |  Quarter 1 break | NBA | Pause in play between the 1st quarter ending and the 2nd quarter starting         |
| `Q2`   | 4    |  Quarter 2 | NBA | Game in play during second quarter         |
| `HT`   | 5    |  Halftime | | Halftime of the game         |
| `Q3`   | 6    |  Quarter 3 | NBA | Game in play during third quarter         |
| `Q3B`  | 7    |  Quarter 3 break | NBA | Pause in play between the 3rd quarter ending and the 4th quarter starting         |
| `Q4`   | 8    |  Quarter 4 | NBA | Game in play during fourth quarter         |
| `F`    | 9    |  Ended (finished) | | Game ends after the 4th quarter         |
| `WO`   | 10   |  Waiting for Overtime  | | Break following the 4th Quarter before the start of the first overtime period |
| `OT`   | 11   |  Overtime | | With option for overtime number to be selected. Game in play during selected overtime period         |
| `OB`   | 12   | Overtime Break | | Break between Overtime periods         |
| `FO`   | 13   |  Ended after Overtime (Finished after Overtime) | Game ends after an overtime period         |
| `I`    | 14   |    Interrupted         | The game is officially interrupted |
| `A`    | 15   |    Abandoned         | The game is officially abandoned |
| `C`    | 16   |    Cancelled         | The game is officially cancelled |
| `TXCC` | 17   |    TX Coverage Cancelled         | TxODDS cancelled coverage of the event |
| `TXCS` | 18   |    TX Coverage Suspended         | TxOODS suspended coverage of the event |
| `H1` | 19 | First half | NCAA | Game in play during first half |
| `H2` | 20 | Second half | NCAA | Game in play during second half |

## Stat period encoding for US Basketball

The stat period is also encoded economically as follows:

### Full Game Stats

| Key | Statistic | Description |
|---|---|---|
| 1 | Participant 1 Total Score | |
| 2 | Participant 2 Total Score | |
| 3 | Participant 1 Total Fouls | |
| 4 | Participant 2 Total Fouls | |
| 5 | Participant 1 Total Personal Fouls | |
| 6 | Participant 2 Total Personal Fouls | |
| 7 | Participant 1 Total Blocks | |
| 8 | Participant 2 Total Blocks | |
| 9 | Participant 1 Total Rebounds | |
| 10 | Participant 2 Total Rebounds | |
| 11 | Participant 1 Total free throws made | |
| 12 | Participant 2 Total free throws made | |
| 13 | Participant 1 Total 2-points made | |
| 14 | Participant 2 Total 2-points made | |
| 15 | Participant 1 Total 3-points made | |
| 16 | Participant 2 Total 3-points made | |
| 17 | Participant 1 Total free throws missed | |
| 18 | Participant 2 Total free throws missed | |
| 19 | Participant 1 Total 2-points missed | |
| 20 | Participant 2 Total 2-points missed | |
| 21 | Participant 1 Total 3-points missed | |
| 22 | Participant 2 Total 3-points missed | |
| 23 | Participant 1 Total free throws attempts | |
| 24 | Participant 2 Total free throws attempts | |
| 25 | Participant 1 Total 2-points attempts | |
| 26 | Participant 2 Total 2-points attempts | |
| 27 | Participant 1 Total 3-points attempts | |
| 28 | Participant 2 Total 3-points attempts | |
| 29 | Participant 1 Total Assists | |
| 30 | Participant 2 Total Assists | |
| 31 | Participant 1 Total Turnovers | |
| 32 | Participant 2 Total Turnovers | |
| 33 | Participant 1 Total Steals | |
| 34 | Participant 2 Total Steals | |
| 35 | Participant 1 Total Used timeouts | |
| 36 | Participant 2 Total Used timeouts | |

---

### First Half (HT) Stats

| Key | Statistic | Description |
|---|---|---|
| 1001 | Participant 1 Total Score | |
| 1002 | Participant 2 Total Score | |
| 1003 | Participant 1 Total Fouls | |
| 1004 | Participant 2 Total Fouls | |
| 1005 | Participant 1 Total Personal Fouls | |
| 1006 | Participant 2 Total Personal Fouls | |
| 1007 | Participant 1 Total Blocks | |
| 1008 | Participant 2 Total Blocks | |
| 1009 | Participant 1 Total Rebounds | |
| 1010 | Participant 2 Total Rebounds | |
| 1011 | Participant 1 Total free throws made | |
| 1012 | Participant 2 Total free throws made | |
| 1013 | Participant 1 Total 2-points made | |
| 1014 | Participant 2 Total 2-points made | |
| 1015 | Participant 1 Total 3-points made | |
| 1016 | Participant 2 Total 3-points made | |
| 1017 | Participant 1 Total free throws missed | |
| 1018 | Participant 2 Total free throws missed | |
| 1019 | Participant 1 Total 2-points missed | |
| 1020 | Participant 2 Total 2-points missed | |
| 1021 | Participant 1 Total 3-points missed | |
| 1022 | Participant 2 Total 3-points missed | |
| 1023 | Participant 1 Total free throws attempts | |
| 1024 | Participant 2 Total free throws attempts | |
| 1025 | Participant 1 Total 2-points attempts | |
| 1026 | Participant 2 Total 2-points attempts | |
| 1027 | Participant 1 Total 3-points attempts | |
| 1028 | Participant 2 Total 3-points attempts | |
| 1029 | Participant 1 Total Assists | |
| 1030 | Participant 2 Total Assists | |
| 1031 | Participant 1 Total Turnovers | |
| 1032 | Participant 2 Total Turnovers | |
| 1033 | Participant 1 Total Steals | |
| 1034 | Participant 2 Total Steals | |
| 1035 | Participant 1 Total Used timeouts | |
| 1036 | Participant 2 Total Used timeouts | |

---

### Second Half (Q3+Q4) Stats

| Key | Statistic | Description |
|---|---|---|
| 2001 | Participant 1 Total Score | |
| 2002 | Participant 2 Total Score | |
| 2003 | Participant 1 Total Fouls | |
| 2004 | Participant 2 Total Fouls | |
| 2005 | Participant 1 Total Personal Fouls | |
| 2006 | Participant 2 Total Personal Fouls | |
| 2007 | Participant 1 Total Blocks | |
| 2008 | Participant 2 Total Blocks | |
| 2009 | Participant 1 Total Rebounds | |
| 2010 | Participant 2 Total Rebounds | |
| 2011 | Participant 1 Total free throws made | |
| 2012 | Participant 2 Total free throws made | |
| 2013 | Participant 1 Total 2-points made | |
| 2014 | Participant 2 Total 2-points made | |
| 2015 | Participant 1 Total 3-points made | |
| 2016 | Participant 2 Total 3-points made | |
| 2017 | Participant 1 Total free throws missed | |
| 2018 | Participant 2 Total free throws missed | |
| 2019 | Participant 1 Total 2-points missed | |
| 2020 | Participant 2 Total 2-points missed | |
| 2021 | Participant 1 Total 3-points missed | |
| 2022 | Participant 2 Total 3-points missed | |
| 2023 | Participant 1 Total free throws attempts | |
| 2024 | Participant 2 Total free throws attempts | |
| 2025 | Participant 1 Total 2-points attempts | |
| 2026 | Participant 2 Total 2-points attempts | |
| 2027 | Participant 1 Total 3-points attempts | |
| 2028 | Participant 2 Total 3-points attempts | |
| 2029 | Participant 1 Total Assists | |
| 2030 | Participant 2 Total Assists | |
| 2031 | Participant 1 Total Turnovers | |
| 2032 | Participant 2 Total Turnovers | |
| 2033 | Participant 1 Total Steals | |
| 2034 | Participant 2 Total Steals | |
| 2035 | Participant 1 Total Used timeouts | |
| 2036 | Participant 2 Total Used timeouts | |

---

### Quarter 1 Stats

| Key | Statistic | Description |
|---|---|---|
| 10001 | Participant 1 Total Score | |
| 10002 | Participant 2 Total Score | |
| 10003 | Participant 1 Total Fouls | |
| 10004 | Participant 2 Total Fouls | |
| 10005 | Participant 1 Total Personal Fouls | |
| 10006 | Participant 2 Total Personal Fouls | |
| 10007 | Participant 1 Total Blocks | |
| 10008 | Participant 2 Total Blocks | |
| 10009 | Participant 1 Total Rebounds | |
| 10010 | Participant 2 Total Rebounds | |
| 10011 | Participant 1 Total free throws made | |
| 10012 | Participant 2 Total free throws made | |
| 10013 | Participant 1 Total 2-points made | |
| 10014 | Participant 2 Total 2-points made | |
| 10015 | Participant 1 Total 3-points made | |
| 10016 | Participant 2 Total 3-points made | |
| 10017 | Participant 1 Total free throws missed | |
| 10018 | Participant 2 Total free throws missed | |
| 10019 | Participant 1 Total 2-points missed | |
| 10020 | Participant 2 Total 2-points missed | |
| 10021 | Participant 1 Total 3-points missed | |
| 10022 | Participant 2 Total 3-points missed | |
| 10023 | Participant 1 Total free throws attempts | |
| 10024 | Participant 2 Total free throws attempts | |
| 10025 | Participant 1 Total 2-points attempts | |
| 10026 | Participant 2 Total 2-points attempts | |
| 10027 | Participant 1 Total 3-points attempts | |
| 10028 | Participant 2 Total 3-points attempts | |
| 10029 | Participant 1 Total Assists | |
| 10030 | Participant 2 Total Assists | |
| 10031 | Participant 1 Total Turnovers | |
| 10032 | Participant 2 Total Turnovers | |
| 10033 | Participant 1 Total Steals | |
| 10034 | Participant 2 Total Steals | |
| 10035 | Participant 1 Total Used timeouts | |
| 10036 | Participant 2 Total Used timeouts | |

---

### Quarter 2 Stats

| Key | Statistic | Description |
|---|---|---|
| 20001 | Participant 1 Total Score | |
| 20002 | Participant 2 Total Score | |
| 20003 | Participant 1 Total Fouls | |
| 20004 | Participant 2 Total Fouls | |
| 20005 | Participant 1 Total Personal Fouls | |
| 20006 | Participant 2 Total Personal Fouls | |
| 20007 | Participant 1 Total Blocks | |
| 20008 | Participant 2 Total Blocks | |
| 20009 | Participant 1 Total Rebounds | |
| 20010 | Participant 2 Total Rebounds | |
| 20011 | Participant 1 Total free throws made | |
| 20012 | Participant 2 Total free throws made | |
| 20013 | Participant 1 Total 2-points made | |
| 20014 | Participant 2 Total 2-points made | |
| 20015 | Participant 1 Total 3-points made | |
| 20016 | Participant 2 Total 3-points made | |
| 20017 | Participant 1 Total free throws missed | |
| 20018 | Participant 2 Total free throws missed | |
| 20019 | Participant 1 Total 2-points missed | |
| 20020 | Participant 2 Total 2-points missed | |
| 20021 | Participant 1 Total 3-points missed | |
| 20022 | Participant 2 Total 3-points missed | |
| 20023 | Participant 1 Total free throws attempts | |
| 20024 | Participant 2 Total free throws attempts | |
| 20025 | Participant 1 Total 2-points attempts | |
| 20026 | Participant 2 Total 2-points attempts | |
| 20027 | Participant 1 Total 3-points attempts | |
| 20028 | Participant 2 Total 3-points attempts | |
| 20029 | Participant 1 Total Assists | |
| 20030 | Participant 2 Total Assists | |
| 20031 | Participant 1 Total Turnovers | |
| 20032 | Participant 2 Total Turnovers | |
| 20033 | Participant 1 Total Steals | |
| 20034 | Participant 2 Total Steals | |
| 20035 | Participant 1 Total Used timeouts | |
| 20036 | Participant 2 Total Used timeouts | |

---

### Quarter 3 Stats

| Key | Statistic | Description |
|---|---|---|
| 30001 | Participant 1 Total Score | |
| 30002 | Participant 2 Total Score | |
| 30003 | Participant 1 Total Fouls | |
| 30004 | Participant 2 Total Fouls | |
| 30005 | Participant 1 Total Personal Fouls | |
| 30006 | Participant 2 Total Personal Fouls | |
| 30007 | Participant 1 Total Blocks | |
| 30008 | Participant 2 Total Blocks | |
| 30009 | Participant 1 Total Rebounds | |
| 30010 | Participant 2 Total Rebounds | |
| 30011 | Participant 1 Total free throws made | |
| 30012 | Participant 2 Total free throws made | |
| 30013 | Participant 1 Total 2-points made | |
| 30014 | Participant 2 Total 2-points made | |
| 30015 | Participant 1 Total 3-points made | |
| 30016 | Participant 2 Total 3-points made | |
| 30017 | Participant 1 Total free throws missed | |
| 30018 | Participant 2 Total free throws missed | |
| 30019 | Participant 1 Total 2-points missed | |
| 30020 | Participant 2 Total 2-points missed | |
| 30021 | Participant 1 Total 3-points missed | |
| 30022 | Participant 2 Total 3-points missed | |
| 30023 | Participant 1 Total free throws attempts | |
| 30024 | Participant 2 Total free throws attempts | |
| 30025 | Participant 1 Total 2-points attempts | |
| 30026 | Participant 2 Total 2-points attempts | |
| 30027 | Participant 1 Total 3-points attempts | |
| 30028 | Participant 2 Total 3-points attempts | |
| 30029 | Participant 1 Total Assists | |
| 30030 | Participant 2 Total Assists | |
| 30031 | Participant 1 Total Turnovers | |
| 30032 | Participant 2 Total Turnovers | |
| 30033 | Participant 1 Total Steals | |
| 30034 | Participant 2 Total Steals | |
| 30035 | Participant 1 Total Used timeouts | |
| 30036 | Participant 2 Total Used timeouts | |

---

### Quarter 4 Stats

| Key | Statistic | Description |
|---|---|---|
| 40001 | Participant 1 Total Score | |
| 40002 | Participant 2 Total Score | |
| 40003 | Participant 1 Total Fouls | |
| 40004 | Participant 2 Total Fouls | |
| 40005 | Participant 1 Total Personal Fouls | |
| 40006 | Participant 2 Total Personal Fouls | |
| 40007 | Participant 1 Total Blocks | |
| 40008 | Participant 2 Total Blocks | |
| 40009 | Participant 1 Total Rebounds | |
| 40010 | Participant 2 Total Rebounds | |
| 40011 | Participant 1 Total free throws made | |
| 40012 | Participant 2 Total free throws made | |
| 40013 | Participant 1 Total 2-points made | |
| 40014 | Participant 2 Total 2-points made | |
| 40015 | Participant 1 Total 3-points made | |
| 40016 | Participant 2 Total 3-points made | |
| 40017 | Participant 1 Total free throws missed | |
| 40018 | Participant 2 Total free throws missed | |
| 40019 | Participant 1 Total 2-points missed | |
| 40020 | Participant 2 Total 2-points missed | |
| 40021 | Participant 1 Total 3-points missed | |
| 40022 | Participant 2 Total 3-points missed | |
| 40023 | Participant 1 Total free throws attempts | |
| 40024 | Participant 2 Total free throws attempts | |
| 40025 | Participant 1 Total 2-points attempts | |
| 40026 | Participant 2 Total 2-points attempts | |
| 40027 | Participant 1 Total 3-points attempts | |
| 40028 | Participant 2 Total 3-points attempts | |
| 40029 | Participant 1 Total Assists | |
| 40030 | Participant 2 Total Assists | |
| 40031 | Participant 1 Total Turnovers | |
| 40032 | Participant 2 Total Turnovers | |
| 40033 | Participant 1 Total Steals | |
| 40034 | Participant 2 Total Steals | |
| 40035 | Participant 1 Total Used timeouts | |
| 40036 | Participant 2 Total Used timeouts | |

---

## Additional Documentation

For comprehensive API documentation:

- **Hosted Documentation**: [txline.txodds.com/documentation/quickstart](https://txline.txodds.com/documentation/quickstart)
- **OpenAPI YAML**: [txline.txodds.com/docs/docs.yaml](https://txline.txodds.com/docs/docs.yaml)
