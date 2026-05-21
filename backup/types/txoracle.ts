/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/txoracle.json`.
 */
export type Txoracle = {
  "address": "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
  "metadata": {
    "name": "txoracle",
    "version": "1.4.1",
    "spec": "0.1.0",
    "description": "TxODDS TxLINE and Data Channels"
  },
  "instructions": [
    {
      "name": "auditTradeResult",
      "discriminator": [
        50,
        242,
        243,
        5,
        209,
        75,
        76,
        91
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "dailyScoresMerkleRoots",
          "docs": [
            "to match the standard used in insert_scores_root."
          ]
        }
      ],
      "args": [
        {
          "name": "terms",
          "type": {
            "defined": {
              "name": "marketIntentParams"
            }
          }
        },
        {
          "name": "fixtureSummary",
          "type": {
            "defined": {
              "name": "scoresBatchSummary"
            }
          }
        },
        {
          "name": "mainTreeProof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        },
        {
          "name": "fixtureProof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        },
        {
          "name": "statA",
          "type": {
            "defined": {
              "name": "statTerm"
            }
          }
        },
        {
          "name": "statB",
          "type": {
            "option": {
              "defined": {
                "name": "statTerm"
              }
            }
          }
        },
        {
          "name": "ts",
          "type": "i64"
        }
      ]
    },
    {
      "name": "claimBatchLegacy",
      "discriminator": [
        254,
        101,
        89,
        255,
        169,
        75,
        207,
        66
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "dailyResolutionRoots"
        },
        {
          "name": "tokenMint",
          "docs": [
            "The Mint is now required to perform decimal-safe transfers (TransferChecked)"
          ]
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "epochDay",
          "type": "u16"
        },
        {
          "name": "intervalIndex",
          "type": "u16"
        },
        {
          "name": "termsHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "winnerIsMaker",
          "type": "bool"
        },
        {
          "name": "seq",
          "type": "u32"
        },
        {
          "name": "merkleProof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        }
      ]
    },
    {
      "name": "claimViaResolution",
      "discriminator": [
        98,
        206,
        250,
        87,
        151,
        135,
        162,
        181
      ],
      "accounts": [
        {
          "name": "winner",
          "writable": true,
          "signer": true
        },
        {
          "name": "dailyResolutionRoots"
        },
        {
          "name": "matchedTrade",
          "writable": true
        },
        {
          "name": "tradeVault",
          "writable": true
        },
        {
          "name": "winnerTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "epochDay",
          "type": "u16"
        },
        {
          "name": "intervalIndex",
          "type": "u16"
        },
        {
          "name": "merkleProof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        }
      ]
    },
    {
      "name": "closeIntent",
      "discriminator": [
        112,
        245,
        154,
        249,
        57,
        126,
        54,
        122
      ],
      "accounts": [
        {
          "name": "maker",
          "writable": true
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "orderIntent",
          "writable": true
        },
        {
          "name": "intentVault",
          "writable": true
        },
        {
          "name": "makerTokenAccount",
          "writable": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "closePricingMatrix",
      "discriminator": [
        251,
        118,
        215,
        117,
        22,
        155,
        38,
        73
      ],
      "accounts": [
        {
          "name": "pricingMatrix",
          "writable": true
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": []
    },
    {
      "name": "createIntent",
      "discriminator": [
        216,
        214,
        79,
        121,
        23,
        194,
        96,
        104
      ],
      "accounts": [
        {
          "name": "maker",
          "writable": true,
          "signer": true
        },
        {
          "name": "orderIntent",
          "writable": true
        },
        {
          "name": "intentVault",
          "writable": true
        },
        {
          "name": "makerTokenAccount",
          "writable": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "intentId",
          "type": "u64"
        },
        {
          "name": "termsHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "depositAmount",
          "type": "u64"
        },
        {
          "name": "expirationTs",
          "type": "i64"
        },
        {
          "name": "claimPeriod",
          "type": "u16"
        },
        {
          "name": "fixtureId",
          "type": "i64"
        }
      ]
    },
    {
      "name": "createTrade",
      "discriminator": [
        183,
        82,
        24,
        245,
        248,
        30,
        204,
        246
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "traderA",
          "writable": true,
          "signer": true
        },
        {
          "name": "traderB",
          "writable": true,
          "signer": true
        },
        {
          "name": "traderATokenAccount",
          "writable": true
        },
        {
          "name": "traderBTokenAccount",
          "writable": true
        },
        {
          "name": "tradeEscrow",
          "writable": true
        },
        {
          "name": "escrowVault",
          "writable": true
        },
        {
          "name": "stakeTokenMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "tradeId",
          "type": "u64"
        },
        {
          "name": "stakeA",
          "type": "u64"
        },
        {
          "name": "stakeB",
          "type": "u64"
        },
        {
          "name": "tradeTermsHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "executeMatch",
      "discriminator": [
        76,
        47,
        91,
        223,
        20,
        10,
        147,
        232
      ],
      "accounts": [
        {
          "name": "solver",
          "writable": true,
          "signer": true
        },
        {
          "name": "makerIntent",
          "writable": true
        },
        {
          "name": "takerIntent",
          "writable": true
        },
        {
          "name": "makerVault",
          "writable": true
        },
        {
          "name": "takerVault",
          "writable": true
        },
        {
          "name": "matchedTrade",
          "writable": true
        },
        {
          "name": "tradeVault",
          "writable": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "tradeId",
          "type": "u64"
        },
        {
          "name": "makerStake",
          "type": "u64"
        },
        {
          "name": "takerStake",
          "type": "u64"
        }
      ]
    },
    {
      "name": "exposeStructs",
      "discriminator": [
        142,
        252,
        254,
        118,
        194,
        230,
        160,
        195
      ],
      "accounts": [],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "marketIntentParams"
            }
          }
        }
      ]
    },
    {
      "name": "initializePricingMatrix",
      "discriminator": [
        147,
        32,
        167,
        248,
        235,
        57,
        210,
        6
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "pricingMatrix",
          "writable": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "rows",
          "type": {
            "vec": {
              "defined": {
                "name": "serviceRow"
              }
            }
          }
        }
      ]
    },
    {
      "name": "initializeTreasuryV2",
      "discriminator": [
        18,
        140,
        152,
        210,
        31,
        25,
        22,
        171
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenTreasuryVault",
          "docs": [
            "The actual Token Account (ATA).",
            "Anchor handles the creation, rent, and extension initialization (like Immutable Owner)."
          ],
          "writable": true
        },
        {
          "name": "tokenTreasuryPda",
          "docs": [
            "It does not store data and is validated via seeds."
          ]
        },
        {
          "name": "subscriptionTokenMint"
        },
        {
          "name": "systemProgram"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "initializeUsdtTreasury",
      "discriminator": [
        81,
        0,
        86,
        241,
        86,
        85,
        243,
        74
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "usdtTreasuryVault",
          "docs": [
            "The Actual Token Account (ATA)"
          ],
          "writable": true
        },
        {
          "name": "usdtTreasuryPda",
          "docs": [
            "The PDA that \"owns\" the USDT"
          ]
        },
        {
          "name": "usdtMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": []
    },
    {
      "name": "insertBatchRoot",
      "discriminator": [
        243,
        170,
        208,
        158,
        207,
        29,
        237,
        93
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "dailyBatchRoots",
          "docs": [
            "The address is constrained by the seeds, and we verify the",
            "discriminator and owner inside the instruction."
          ],
          "writable": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "epochDay",
          "type": "u16"
        },
        {
          "name": "hourOfDay",
          "type": "u8"
        },
        {
          "name": "minuteOfHour",
          "type": "u8"
        },
        {
          "name": "root",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "insertFixturesRoot",
      "discriminator": [
        18,
        70,
        8,
        160,
        75,
        200,
        109,
        235
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "tenDailyFixturesRoots",
          "docs": [
            "The address is constrained by the seeds, and we verify the",
            "discriminator and owner inside the instruction."
          ],
          "writable": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "epochDay",
          "type": "u16"
        },
        {
          "name": "index",
          "type": "u64"
        },
        {
          "name": "root",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "insertScoresRoot",
      "discriminator": [
        137,
        39,
        242,
        97,
        131,
        204,
        100,
        133
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "dailyScoresRoots",
          "docs": [
            "The address is constrained by the seeds, and we verify the",
            "discriminator and owner inside the instruction."
          ],
          "writable": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "epochDay",
          "type": "u16"
        },
        {
          "name": "hourOfDay",
          "type": "u8"
        },
        {
          "name": "minuteOfHour",
          "type": "u8"
        },
        {
          "name": "root",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "publishResolutionRoot",
      "discriminator": [
        191,
        161,
        47,
        36,
        163,
        58,
        31,
        70
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "dailyResolutionRoots",
          "writable": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "epochDay",
          "type": "u16"
        },
        {
          "name": "intervalIndex",
          "type": "u16"
        },
        {
          "name": "root",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "purchaseSubscriptionTokenUsdt",
      "discriminator": [
        198,
        251,
        223,
        9,
        31,
        184,
        166,
        188
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "usdtMint"
        },
        {
          "name": "buyerUsdtAccount",
          "writable": true
        },
        {
          "name": "usdtTreasuryVault",
          "docs": [
            "The Vault ATA where USDT is stored"
          ],
          "writable": true
        },
        {
          "name": "usdtTreasuryPda",
          "docs": [
            "The PDA Authority for USDT"
          ]
        },
        {
          "name": "subscriptionTokenMint"
        },
        {
          "name": "tokenTreasuryVault",
          "docs": [
            "The Vault ATA where Subscription Tokens are stored"
          ],
          "writable": true
        },
        {
          "name": "tokenTreasuryPda",
          "docs": [
            "The PDA Authority for Sub Tokens"
          ]
        },
        {
          "name": "buyerTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "token2022Program"
        },
        {
          "name": "systemProgram"
        },
        {
          "name": "associatedTokenProgram"
        }
      ],
      "args": [
        {
          "name": "usdtAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "refundBatch",
      "discriminator": [
        227,
        54,
        194,
        2,
        78,
        8,
        104,
        29
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenMint",
          "docs": [
            "The mint is required for transfer_checked logic"
          ]
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": []
    },
    {
      "name": "requestDevnetFaucet",
      "discriminator": [
        49,
        178,
        104,
        8,
        23,
        120,
        186,
        21
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "faucetTracker",
          "writable": true
        },
        {
          "name": "usdtMint",
          "writable": true
        },
        {
          "name": "userUsdtAta",
          "writable": true
        },
        {
          "name": "usdtTreasuryPda"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": []
    },
    {
      "name": "sellSubscriptionTokenUsdt",
      "discriminator": [
        188,
        208,
        146,
        29,
        192,
        202,
        243,
        122
      ],
      "accounts": [
        {
          "name": "seller",
          "writable": true,
          "signer": true
        },
        {
          "name": "usdtMint"
        },
        {
          "name": "sellerUsdtAccount",
          "writable": true
        },
        {
          "name": "usdtTreasuryVault",
          "docs": [
            "The Vault ATA where USDT is stored (Legacy SPL)"
          ],
          "writable": true
        },
        {
          "name": "usdtTreasuryPda",
          "docs": [
            "The PDA Authority for the USDT Vault"
          ]
        },
        {
          "name": "tokenTreasuryVault",
          "docs": [
            "The Vault ATA where Subscription Tokens are stored (Token-2022)"
          ],
          "writable": true
        },
        {
          "name": "tokenTreasuryPda",
          "docs": [
            "The PDA Authority for the Token-2022 Vault"
          ]
        },
        {
          "name": "sellerTokenAccount",
          "writable": true
        },
        {
          "name": "subscriptionTokenMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "token2022Program"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "tokenAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settleMatchedTrade",
      "discriminator": [
        191,
        233,
        149,
        116,
        32,
        239,
        18,
        65
      ],
      "accounts": [
        {
          "name": "winner",
          "writable": true,
          "signer": true
        },
        {
          "name": "dailyScoresMerkleRoots"
        },
        {
          "name": "matchedTrade",
          "writable": true
        },
        {
          "name": "tradeVault",
          "writable": true
        },
        {
          "name": "winnerTokenAccount",
          "writable": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "tradeId",
          "type": "u64"
        },
        {
          "name": "ts",
          "type": "i64"
        },
        {
          "name": "fixtureSummary",
          "type": {
            "defined": {
              "name": "scoresBatchSummary"
            }
          }
        },
        {
          "name": "fixtureProof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        },
        {
          "name": "mainTreeProof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        },
        {
          "name": "statA",
          "type": {
            "defined": {
              "name": "statTerm"
            }
          }
        },
        {
          "name": "statB",
          "type": {
            "option": {
              "defined": {
                "name": "statTerm"
              }
            }
          }
        },
        {
          "name": "terms",
          "type": {
            "defined": {
              "name": "marketIntentParams"
            }
          }
        }
      ]
    },
    {
      "name": "settleTrade",
      "discriminator": [
        252,
        176,
        98,
        248,
        73,
        123,
        8,
        157
      ],
      "accounts": [
        {
          "name": "winner",
          "writable": true,
          "signer": true
        },
        {
          "name": "dailyScoresMerkleRoots"
        },
        {
          "name": "tradeEscrow",
          "writable": true
        },
        {
          "name": "escrowVault",
          "writable": true
        },
        {
          "name": "winnerTokenAccount",
          "writable": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "tradeId",
          "type": "u64"
        },
        {
          "name": "ts",
          "type": "i64"
        },
        {
          "name": "fixtureSummary",
          "type": {
            "defined": {
              "name": "scoresBatchSummary"
            }
          }
        },
        {
          "name": "fixtureProof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        },
        {
          "name": "mainTreeProof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        },
        {
          "name": "predicate",
          "type": {
            "defined": {
              "name": "traderPredicate"
            }
          }
        },
        {
          "name": "statA",
          "type": {
            "defined": {
              "name": "statTerm"
            }
          }
        },
        {
          "name": "statB",
          "type": {
            "option": {
              "defined": {
                "name": "statTerm"
              }
            }
          }
        },
        {
          "name": "op",
          "type": {
            "option": {
              "defined": {
                "name": "binaryExpression"
              }
            }
          }
        }
      ]
    },
    {
      "name": "subscribe",
      "discriminator": [
        254,
        28,
        191,
        138,
        156,
        179,
        183,
        53
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "pricingMatrix"
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "tokenTreasuryVault",
          "writable": true
        },
        {
          "name": "tokenTreasuryPda",
          "docs": [
            "Hold the PDA that owns the vault"
          ]
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
        },
        {
          "name": "associatedTokenProgram"
        }
      ],
      "args": [
        {
          "name": "serviceLevelId",
          "type": "u16"
        },
        {
          "name": "weeks",
          "type": "u8"
        }
      ]
    },
    {
      "name": "subscribeV2",
      "discriminator": [
        13,
        248,
        232,
        63,
        182,
        236,
        71,
        149
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "tokenTreasuryVault",
          "writable": true
        },
        {
          "name": "tokenTreasuryPda",
          "docs": [
            "Hold the PDA that owns the vault"
          ]
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
        },
        {
          "name": "associatedTokenProgram"
        }
      ],
      "args": [
        {
          "name": "weeks",
          "type": "u8"
        }
      ]
    },
    {
      "name": "subscribeWithToken",
      "discriminator": [
        184,
        57,
        19,
        15,
        241,
        194,
        240,
        220
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "pricingMatrix"
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "tokenTreasuryVault",
          "writable": true
        },
        {
          "name": "tokenTreasuryPda",
          "docs": [
            "The PDA that owns the vault"
          ]
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram"
        },
        {
          "name": "associatedTokenProgram"
        }
      ],
      "args": [
        {
          "name": "serviceLevelId",
          "type": "u16"
        },
        {
          "name": "weeks",
          "type": "u8"
        },
        {
          "name": "encryptedPayload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "subscribeWithTokenV2",
      "discriminator": [
        44,
        122,
        136,
        162,
        207,
        131,
        133,
        208
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenMint"
        },
        {
          "name": "tokenTreasuryVault",
          "writable": true
        },
        {
          "name": "tokenTreasuryPda",
          "docs": [
            "The PDA that owns the vault"
          ]
        },
        {
          "name": "userTokenAccount",
          "writable": true
        },
        {
          "name": "systemProgram"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram"
        }
      ],
      "args": [
        {
          "name": "encryptedPayload",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "updatePricingMatrix",
      "discriminator": [
        177,
        191,
        172,
        252,
        42,
        203,
        8,
        164
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "pricingMatrix",
          "writable": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "rows",
          "type": {
            "vec": {
              "defined": {
                "name": "serviceRow"
              }
            }
          }
        }
      ]
    },
    {
      "name": "validateFixture",
      "discriminator": [
        231,
        129,
        218,
        86,
        223,
        114,
        21,
        126
      ],
      "accounts": [
        {
          "name": "tenDailyFixturesRoots",
          "docs": [
            "The address is constrained by seeds, ensuring we load the correct PDA."
          ]
        }
      ],
      "args": [
        {
          "name": "snapshot",
          "type": {
            "defined": {
              "name": "fixture"
            }
          }
        },
        {
          "name": "summary",
          "type": {
            "defined": {
              "name": "fixtureBatchSummary"
            }
          }
        },
        {
          "name": "subTreeProof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        },
        {
          "name": "mainTreeProof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        }
      ]
    },
    {
      "name": "validateFixtureBatch",
      "discriminator": [
        85,
        223,
        204,
        7,
        4,
        87,
        157,
        1
      ],
      "accounts": [
        {
          "name": "tenDailyFixturesRoots",
          "docs": [
            "The address is constrained by seeds, ensuring we load the correct PDA."
          ]
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u8"
        },
        {
          "name": "metadata",
          "type": {
            "defined": {
              "name": "batchMetadata"
            }
          }
        },
        {
          "name": "proof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        }
      ]
    },
    {
      "name": "validateOdds",
      "discriminator": [
        192,
        19,
        91,
        138,
        104,
        100,
        212,
        86
      ],
      "accounts": [
        {
          "name": "dailyOddsMerkleRoots"
        }
      ],
      "args": [
        {
          "name": "ts",
          "type": "i64"
        },
        {
          "name": "oddsSnapshot",
          "type": {
            "defined": {
              "name": "odds"
            }
          }
        },
        {
          "name": "summary",
          "type": {
            "defined": {
              "name": "oddsBatchSummary"
            }
          }
        },
        {
          "name": "subTreeProof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        },
        {
          "name": "mainTreeProof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        }
      ]
    },
    {
      "name": "validateStat",
      "discriminator": [
        107,
        197,
        232,
        90,
        191,
        136,
        105,
        185
      ],
      "accounts": [
        {
          "name": "dailyScoresMerkleRoots"
        }
      ],
      "args": [
        {
          "name": "ts",
          "type": "i64"
        },
        {
          "name": "fixtureSummary",
          "type": {
            "defined": {
              "name": "scoresBatchSummary"
            }
          }
        },
        {
          "name": "fixtureProof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        },
        {
          "name": "mainTreeProof",
          "type": {
            "vec": {
              "defined": {
                "name": "proofNode"
              }
            }
          }
        },
        {
          "name": "predicate",
          "type": {
            "defined": {
              "name": "traderPredicate"
            }
          }
        },
        {
          "name": "statA",
          "type": {
            "defined": {
              "name": "statTerm"
            }
          }
        },
        {
          "name": "statB",
          "type": {
            "option": {
              "defined": {
                "name": "statTerm"
              }
            }
          }
        },
        {
          "name": "op",
          "type": {
            "option": {
              "defined": {
                "name": "binaryExpression"
              }
            }
          }
        }
      ]
    },
    {
      "name": "withdrawUsdt",
      "discriminator": [
        117,
        75,
        94,
        162,
        178,
        92,
        19,
        141
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "adminDestination",
          "writable": true
        },
        {
          "name": "usdtTreasuryVault",
          "writable": true
        },
        {
          "name": "usdtTreasuryPda"
        },
        {
          "name": "usdtMint"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "faucetTracker",
      "discriminator": [
        247,
        221,
        212,
        62,
        42,
        233,
        215,
        190
      ]
    },
    {
      "name": "matchedTrade",
      "discriminator": [
        104,
        54,
        182,
        211,
        94,
        15,
        215,
        142
      ]
    },
    {
      "name": "orderIntent",
      "discriminator": [
        12,
        130,
        12,
        36,
        12,
        221,
        218,
        14
      ]
    },
    {
      "name": "pricingMatrix",
      "discriminator": [
        173,
        13,
        64,
        22,
        248,
        77,
        110,
        106
      ]
    },
    {
      "name": "tradeEscrow",
      "discriminator": [
        251,
        124,
        237,
        23,
        18,
        126,
        198,
        49
      ]
    }
  ],
  "events": [
    {
      "name": "auditVerifiedEvent",
      "discriminator": [
        249,
        57,
        59,
        176,
        243,
        27,
        132,
        169
      ]
    },
    {
      "name": "batchClaimExecuted",
      "discriminator": [
        207,
        182,
        115,
        79,
        244,
        25,
        123,
        18
      ]
    },
    {
      "name": "batchRefundExecuted",
      "discriminator": [
        193,
        25,
        157,
        200,
        184,
        164,
        176,
        252
      ]
    },
    {
      "name": "intentClosed",
      "discriminator": [
        127,
        229,
        67,
        202,
        91,
        56,
        164,
        0
      ]
    },
    {
      "name": "intentCreated",
      "discriminator": [
        184,
        46,
        156,
        205,
        169,
        254,
        11,
        108
      ]
    },
    {
      "name": "matchExecuted",
      "discriminator": [
        42,
        57,
        255,
        224,
        78,
        10,
        39,
        168
      ]
    },
    {
      "name": "tradeSettled",
      "discriminator": [
        22,
        119,
        166,
        225,
        175,
        53,
        93,
        216
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "eventNotActive",
      "msg": "Event is not active"
    },
    {
      "code": 6001,
      "name": "pricesMismatch",
      "msg": "Prices and price names arrays must be the same length"
    },
    {
      "code": 6002,
      "name": "invalidOddsUpdate",
      "msg": "Invalid odds update for this event"
    },
    {
      "code": 6003,
      "name": "invalidSubTreeProof",
      "msg": "Invalid sub-tree proof. The snapshot does not belong to the summary."
    },
    {
      "code": 6004,
      "name": "invalidMainTreeProof",
      "msg": "Invalid main tree proof. The summary does not belong to the on-chain root."
    },
    {
      "code": 6005,
      "name": "timeSlotMismatch",
      "msg": "Time slot mismatch between snapshot and on-chain root account."
    },
    {
      "code": 6006,
      "name": "invalidTime",
      "msg": "The provided hour or minute is out of the valid range."
    },
    {
      "code": 6007,
      "name": "rootNotAvailable",
      "msg": "Merkle root for this time slot has not been posted by the oracle."
    },
    {
      "code": 6008,
      "name": "accountDiscriminatorMismatch",
      "msg": "Mismatched account discriminator."
    },
    {
      "code": 6009,
      "name": "invalidPda",
      "msg": "The provided daily root account does not match the expected PDA."
    },
    {
      "code": 6010,
      "name": "timestampMismatch",
      "msg": "The timestamp provided for seed generation does not match the timestamp in the snapshot payload."
    },
    {
      "code": 6011,
      "name": "sliceError",
      "msg": "Could not slice the account data correctly."
    },
    {
      "code": 6012,
      "name": "invalidOwner",
      "msg": "Invalid account owner."
    },
    {
      "code": 6013,
      "name": "invalidTimeSlot",
      "msg": "Invalid time slot, must be aligned on a 5-min boundary."
    },
    {
      "code": 6014,
      "name": "stakeStillLocked",
      "msg": "Stake is still locked and cannot be withdrawn yet."
    },
    {
      "code": 6015,
      "name": "invalidRecipient",
      "msg": "Invalid recipient of the financial transaction."
    },
    {
      "code": 6016,
      "name": "activeSubscription",
      "msg": "You already have an active subscription."
    },
    {
      "code": 6017,
      "name": "unauthorized",
      "msg": "Unauthorized account updater."
    },
    {
      "code": 6018,
      "name": "invalidAccountOwner",
      "msg": "Invalid account owner."
    },
    {
      "code": 6019,
      "name": "invalidMintAuthority",
      "msg": "Invalid mint authority."
    },
    {
      "code": 6020,
      "name": "invalidMint",
      "msg": "Invalid mint."
    },
    {
      "code": 6021,
      "name": "predicateFailed",
      "msg": "Predicate failed."
    },
    {
      "code": 6022,
      "name": "invalidFixtureSubTreeProof",
      "msg": "Invalid sub-tree proof for fixture"
    },
    {
      "code": 6023,
      "name": "invalidStatProof",
      "msg": "Invalid stats proof for event"
    },
    {
      "code": 6024,
      "name": "invalidStatCombination",
      "msg": "invalid stat combination"
    },
    {
      "code": 6025,
      "name": "missingSecondStat",
      "msg": "Missing second stat"
    },
    {
      "code": 6026,
      "name": "unexpectedSecondStat",
      "msg": "Unexpected second stat"
    },
    {
      "code": 6027,
      "name": "overflow",
      "msg": "overflow"
    },
    {
      "code": 6028,
      "name": "tradeNotActive",
      "msg": "Trade not active"
    },
    {
      "code": 6029,
      "name": "invalidTrader",
      "msg": "Invalid trader"
    },
    {
      "code": 6030,
      "name": "winnerMismatch",
      "msg": "Winner mismatch"
    },
    {
      "code": 6031,
      "name": "tradeTermsMismatch",
      "msg": "Trade terms mismatch"
    },
    {
      "code": 6032,
      "name": "unauthorizedSettler",
      "msg": "Unauthorized settler"
    },
    {
      "code": 6033,
      "name": "fundsBelowMinimumDeposit",
      "msg": "Funds below minimal deposit amount"
    },
    {
      "code": 6034,
      "name": "insufficientUserBalance",
      "msg": "Insufficient token balance"
    },
    {
      "code": 6035,
      "name": "zeroAmount",
      "msg": "Cannot withdraw zero amount"
    },
    {
      "code": 6036,
      "name": "vaultNotEmpty",
      "msg": "Vault not empty"
    },
    {
      "code": 6037,
      "name": "insufficientVaultBalance",
      "msg": "Insufficient vault balance"
    },
    {
      "code": 6038,
      "name": "calculationError",
      "msg": "Calculation error"
    },
    {
      "code": 6039,
      "name": "invalidSubscriptionTs",
      "msg": "Subscription end Ts invalid"
    },
    {
      "code": 6040,
      "name": "cannotShortenSubscription",
      "msg": "Cannot shorten an existing subscription"
    },
    {
      "code": 6041,
      "name": "invalidTimeAlignment",
      "msg": "Invalid time alignment"
    },
    {
      "code": 6042,
      "name": "invalidEpochDayAlignment",
      "msg": "Invalid epoch day alignment"
    },
    {
      "code": 6043,
      "name": "accountDataTooSmall",
      "msg": "Account data too small"
    },
    {
      "code": 6044,
      "name": "insufficientLiquidity",
      "msg": "Insufficient liquidity"
    },
    {
      "code": 6045,
      "name": "invalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6046,
      "name": "invalidExpiration",
      "msg": "Invalid expiration"
    },
    {
      "code": 6047,
      "name": "fixtureMismatch",
      "msg": "Fixture mismatch"
    },
    {
      "code": 6048,
      "name": "periodMismatch",
      "msg": "Period mismatch"
    },
    {
      "code": 6049,
      "name": "intentNotActive",
      "msg": "Intent not active"
    },
    {
      "code": 6050,
      "name": "orderNotYetExpired",
      "msg": "Order not yet expired"
    },
    {
      "code": 6051,
      "name": "termsMismatch",
      "msg": "Terms mismatch"
    },
    {
      "code": 6052,
      "name": "statKeyMismatch",
      "msg": "Stat key mismatch"
    },
    {
      "code": 6053,
      "name": "invalidVault",
      "msg": "Invalid vault"
    },
    {
      "code": 6054,
      "name": "equivocationAttempt",
      "msg": "Equivocation attempt"
    },
    {
      "code": 6055,
      "name": "numericOverflow",
      "msg": "Numeric overflow"
    },
    {
      "code": 6056,
      "name": "invalidAccountData",
      "msg": "Invalid account data"
    },
    {
      "code": 6057,
      "name": "rateLimitExceeded",
      "msg": "Rate limit exceeded"
    },
    {
      "code": 6058,
      "name": "invalidServiceLevelId",
      "msg": "Invalid service level Id"
    },
    {
      "code": 6059,
      "name": "initialRowsLimitExceeded",
      "msg": "Initial rows limit exceeded"
    },
    {
      "code": 6060,
      "name": "missingStat",
      "msg": "Missing stat"
    },
    {
      "code": 6061,
      "name": "proofTooLarge",
      "msg": "Proof too large"
    },
    {
      "code": 6062,
      "name": "tradeTooSmall",
      "msg": "Trade too small"
    }
  ],
  "types": [
    {
      "name": "auditVerifiedEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "auditor",
            "type": "pubkey"
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rootUsed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "result",
            "type": "bool"
          },
          {
            "name": "matchTimestamp",
            "type": "i64"
          },
          {
            "name": "auditTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "batchClaimExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "tradeCount",
            "type": "u16"
          },
          {
            "name": "totalPayoutAmount",
            "type": "u64"
          },
          {
            "name": "totalRentReclaimed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "batchMetadata",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "totalUpdateCount",
            "type": "i32"
          },
          {
            "name": "numUniqueFixtures",
            "type": "i32"
          },
          {
            "name": "overallBatchStartTs",
            "type": "i64"
          },
          {
            "name": "overallBatchEndTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "batchRefundExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "tradeCount",
            "type": "u16"
          },
          {
            "name": "totalRentReclaimed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "binaryExpression",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "add"
          },
          {
            "name": "subtract"
          }
        ]
      }
    },
    {
      "name": "comparison",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "greaterThan"
          },
          {
            "name": "lessThan"
          },
          {
            "name": "equalTo"
          }
        ]
      }
    },
    {
      "name": "faucetTracker",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lastRequestTime",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "fixture",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ts",
            "type": "i64"
          },
          {
            "name": "startTime",
            "type": "i64"
          },
          {
            "name": "competition",
            "type": "string"
          },
          {
            "name": "competitionId",
            "type": "i32"
          },
          {
            "name": "fixtureGroupId",
            "type": "i32"
          },
          {
            "name": "participant1Id",
            "type": "i32"
          },
          {
            "name": "participant1",
            "type": "string"
          },
          {
            "name": "participant2Id",
            "type": "i32"
          },
          {
            "name": "participant2",
            "type": "string"
          },
          {
            "name": "fixtureId",
            "type": "i64"
          },
          {
            "name": "participant1IsHome",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "fixtureBatchSummary",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fixtureId",
            "type": "i64"
          },
          {
            "name": "competitionId",
            "type": "i32"
          },
          {
            "name": "competition",
            "type": "string"
          },
          {
            "name": "updateStats",
            "type": {
              "defined": {
                "name": "fixtureUpdateStats"
              }
            }
          },
          {
            "name": "updateSubTreeRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "fixtureUpdateStats",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "updateCount",
            "type": "u32"
          },
          {
            "name": "minTimestamp",
            "type": "i64"
          },
          {
            "name": "maxTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "intentClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "intentId",
            "type": "u64"
          },
          {
            "name": "refundAmount",
            "type": "u64"
          },
          {
            "name": "closedBy",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "intentCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "intentId",
            "type": "u64"
          },
          {
            "name": "fixtureId",
            "type": "i64"
          },
          {
            "name": "depositAmount",
            "type": "u64"
          },
          {
            "name": "expirationTs",
            "type": "i64"
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "intentState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "locked"
          },
          {
            "name": "closed"
          },
          {
            "name": "expired"
          }
        ]
      }
    },
    {
      "name": "marketIntentParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fixtureId",
            "type": "i64"
          },
          {
            "name": "period",
            "type": "u16"
          },
          {
            "name": "statAKey",
            "type": "u32"
          },
          {
            "name": "statBKey",
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "predicate",
            "type": {
              "defined": {
                "name": "traderPredicate"
              }
            }
          },
          {
            "name": "op",
            "type": {
              "option": {
                "defined": {
                  "name": "binaryExpression"
                }
              }
            }
          },
          {
            "name": "negation",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "matchExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tradeId",
            "type": "u64"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "taker",
            "type": "pubkey"
          },
          {
            "name": "makerStake",
            "type": "u64"
          },
          {
            "name": "takerStake",
            "type": "u64"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "matchedTrade",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tradeId",
            "type": "u64"
          },
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "taker",
            "type": "pubkey"
          },
          {
            "name": "stakeMaker",
            "type": "u64"
          },
          {
            "name": "stakeTaker",
            "type": "u64"
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "tradeState"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "odds",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fixtureId",
            "type": "i64"
          },
          {
            "name": "messageId",
            "type": "string"
          },
          {
            "name": "ts",
            "type": "i64"
          },
          {
            "name": "bookmaker",
            "type": "string"
          },
          {
            "name": "bookmakerId",
            "type": "i32"
          },
          {
            "name": "superOddsType",
            "type": "string"
          },
          {
            "name": "gameState",
            "type": {
              "option": "string"
            }
          },
          {
            "name": "inRunning",
            "type": "bool"
          },
          {
            "name": "marketParameters",
            "type": {
              "option": "string"
            }
          },
          {
            "name": "marketPeriod",
            "type": {
              "option": "string"
            }
          },
          {
            "name": "priceNames",
            "type": {
              "vec": "string"
            }
          },
          {
            "name": "prices",
            "type": {
              "vec": "i32"
            }
          }
        ]
      }
    },
    {
      "name": "oddsBatchSummary",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fixtureId",
            "type": "i64"
          },
          {
            "name": "updateStats",
            "type": {
              "defined": {
                "name": "oddsUpdateStats"
              }
            }
          },
          {
            "name": "oddsSubTreeRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "oddsUpdateStats",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "updateCount",
            "type": "u32"
          },
          {
            "name": "minTimestamp",
            "type": "i64"
          },
          {
            "name": "maxTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "orderIntent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maker",
            "type": "pubkey"
          },
          {
            "name": "intentId",
            "type": "u64"
          },
          {
            "name": "depositAmount",
            "type": "u64"
          },
          {
            "name": "remainingAmount",
            "type": "u64"
          },
          {
            "name": "odds",
            "type": "u16"
          },
          {
            "name": "termsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "fixtureId",
            "type": "i64"
          },
          {
            "name": "period",
            "type": "u16"
          },
          {
            "name": "expirationTs",
            "type": "i64"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "intentState"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "pricingMatrix",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "rows",
            "type": {
              "vec": {
                "defined": {
                  "name": "serviceRow"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "proofNode",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "isRightSibling",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "scoreStat",
      "docs": [
        "The on-chain representation of a single, provable key-value statistic.",
        "This is the leaf of the inner-most Merkle tree."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "key",
            "type": "u32"
          },
          {
            "name": "value",
            "type": "i32"
          },
          {
            "name": "period",
            "type": "i32"
          }
        ]
      }
    },
    {
      "name": "scoresBatchSummary",
      "docs": [
        "The summary for a single fixture's scores events within a 5-minute batch.",
        "This contains the root of the sub-tree of all events for that fixture."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fixtureId",
            "type": "i64"
          },
          {
            "name": "updateStats",
            "type": {
              "defined": {
                "name": "scoresUpdateStats"
              }
            }
          },
          {
            "name": "eventsSubTreeRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "scoresUpdateStats",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "updateCount",
            "type": "i32"
          },
          {
            "name": "minTimestamp",
            "type": "i64"
          },
          {
            "name": "maxTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "serviceRow",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "rowId",
            "type": "u16"
          },
          {
            "name": "pricePerWeekToken",
            "type": "u64"
          },
          {
            "name": "samplingIntervalSec",
            "type": "u32"
          },
          {
            "name": "leagueBundleId",
            "type": "i16"
          },
          {
            "name": "marketBundleId",
            "type": "i16"
          }
        ]
      }
    },
    {
      "name": "statTerm",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "statToProve",
            "type": {
              "defined": {
                "name": "scoreStat"
              }
            }
          },
          {
            "name": "eventStatRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "statProof",
            "type": {
              "vec": {
                "defined": {
                  "name": "proofNode"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "tradeEscrow",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tradeId",
            "type": "u64"
          },
          {
            "name": "traderA",
            "type": "pubkey"
          },
          {
            "name": "traderB",
            "type": "pubkey"
          },
          {
            "name": "stakeA",
            "type": "u64"
          },
          {
            "name": "stakeB",
            "type": "u64"
          },
          {
            "name": "tradeTermsHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "tradeState"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "tradeSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tradeId",
            "type": "u64"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "payoutAmount",
            "type": "u64"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "tradeState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "resolved"
          },
          {
            "name": "disputed"
          }
        ]
      }
    },
    {
      "name": "traderPredicate",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "threshold",
            "type": "i32"
          },
          {
            "name": "comparison",
            "type": {
              "defined": {
                "name": "comparison"
              }
            }
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "lamportsPerSol",
      "type": "f64",
      "value": "1000000000.0"
    },
    {
      "name": "minDepositTokens",
      "type": "u64",
      "value": "1000000"
    },
    {
      "name": "minUserBalance",
      "type": "u64",
      "value": "1000000"
    },
    {
      "name": "stakeAmount",
      "type": "u64",
      "value": "1"
    },
    {
      "name": "subscriptionDuration",
      "type": "i64",
      "value": "3600"
    },
    {
      "name": "subscriptionPriceToken",
      "type": "u64",
      "value": "1"
    },
    {
      "name": "tokenDecimals",
      "type": "u32",
      "value": "6"
    },
    {
      "name": "tokenPriceInSol",
      "type": "f64",
      "value": "0.01"
    },
    {
      "name": "tokenPriceInUsdt",
      "type": "u128",
      "value": "1000"
    },
    {
      "name": "txlineMint",
      "type": "pubkey",
      "value": "AfDqUk86FphPTZdSCRBg5bGm6v4Enamnjc3twqQzsVb1"
    },
    {
      "name": "usdtDecimalsFactor",
      "type": "u128",
      "value": "1000000"
    },
    {
      "name": "usdtMint",
      "type": "pubkey",
      "value": "ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh"
    }
  ]
};
