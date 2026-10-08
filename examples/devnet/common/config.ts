export const API_BASE_URL = "https://txline-dev.txodds.com/api";

export const JWT_URL = "https://txline-dev.txodds.com/auth/guest/start";

export const TOKEN_DECIMALS = 6;

export const durationInSeconds = 300;

export const currentTs = Math.floor(Date.now() / 1000);

export const subscriptionEndTs = currentTs + durationInSeconds;

// Fixtures the example scripts pin; ids and seqs are specific to each network's data.
export const SAMPLE_FIXTURES = {
  freeTierOdds: 17588320,
  historicalScores: 18086637,
  v2aSnapshot: 18175981,
  v2aValidation: { fixtureId: 18175981, seq: 991 },
  v3cValidation: { fixtureId: 18241006, seq: 962 },
};
