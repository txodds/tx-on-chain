export const API_BASE_URL = "https://txline.txodds.com/api";

export const JWT_URL = "https://txline.txodds.com/auth/guest/start";

export const TOKEN_DECIMALS = 6;

export const durationInSeconds = 300;

export const currentTs = Math.floor(Date.now() / 1000);

export const subscriptionEndTs = currentTs + durationInSeconds;

// Fixtures the example scripts pin; ids and seqs are specific to each network's data.
export const SAMPLE_FIXTURES = {
  freeTierOdds: 18187298,
  historicalScores: 18213979,
  v2aSnapshot: 18202783,
  v2aValidation: { fixtureId: 18193785, seq: 991 },
  v3cValidation: { fixtureId: 18218149, seq: 1087 },
};
