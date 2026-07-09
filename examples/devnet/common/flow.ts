import axios, { AxiosInstance } from "axios";

export type JsonObject = Record<string, unknown>;

export type ScoreSelection = {
  record: JsonObject;
  fixtureId: number;
  seq: number;
  ts: number;
  statKeys: number[];
};

export class InconclusiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InconclusiveError";
  }
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

export function firstField(object: JsonObject, names: readonly string[]): unknown {
  for (const name of names) {
    if (object[name] !== undefined && object[name] !== null) return object[name];
  }
  return undefined;
}

export function requiredSafeInteger(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^-?\d+$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return parsed;
}

export function scoreIdentity(record: JsonObject): Omit<ScoreSelection, "record" | "statKeys"> {
  return {
    fixtureId: requiredSafeInteger(
      firstField(record, ["FixtureId", "fixtureId"]),
      "score FixtureId/fixtureId",
      1,
    ),
    seq: requiredSafeInteger(firstField(record, ["Seq", "seq"]), "score Seq/seq", 1),
    ts: requiredSafeInteger(
      firstField(record, ["Ts", "ts"]),
      "score Ts/ts (milliseconds)",
      1_000_000_000_000,
    ),
  };
}

function maybeStatKey(object: JsonObject): number | undefined {
  const raw = firstField(object, ["key", "Key", "statKey", "StatKey"]);
  const rawValue = firstField(object, ["value", "Value", "statValue", "StatValue"]);
  if (raw === undefined || rawValue === undefined) return undefined;
  try {
    requiredSafeInteger(rawValue, "stat value", -0x8000_0000, 0x7fff_ffff);
    return requiredSafeInteger(raw, "stat key", 0, 0xffff_ffff);
  } catch {
    return undefined;
  }
}

/** Discover keys from arrays/objects in the actual score record, not a catalog. */
export function statKeysInRecord(record: JsonObject): number[] {
  const keys = new Set<number>();
  const seen = new Set<object>();

  const visit = (value: unknown, depth: number, parentName = ""): void => {
    if (depth > 8 || value === null || typeof value !== "object") return;
    if (seen.has(value as object)) return;
    seen.add(value as object);

    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1, parentName));
      return;
    }

    const object = value as JsonObject;
    const isStatContainer = /stat/i.test(parentName);
    const isScoreRow = parentName === "__scoreRecords" || (
      firstField(object, ["FixtureId", "fixtureId"]) !== undefined
      && firstField(object, ["Seq", "seq"]) !== undefined
      && firstField(object, ["Ts", "ts"]) !== undefined
    );
    const key = isStatContainer || isScoreRow ? maybeStatKey(object) : undefined;
    if (key !== undefined) keys.add(key);

    for (const [name, child] of Object.entries(object)) {
      // Some API projections expose stats as a numeric-keyed object map.
      if (
        isStatContainer
        && /^\d+$/.test(name)
        && child !== null
        && typeof child !== "object"
      ) {
        const mapKey = Number(name);
        if (Number.isInteger(mapKey) && mapKey <= 0xffff_ffff) keys.add(mapKey);
      }
      visit(child, depth + 1, name);
    }
  };

  visit(record, 0);
  return [...keys];
}

function parseOptionalIntegerEnv(name: string, minimum: number, maximum: number): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  return requiredSafeInteger(raw, name, minimum, maximum);
}

export function requestedStatKeys(): number[] | undefined {
  const raw = process.env.TXLINE_STAT_KEYS;
  if (raw === undefined || raw.trim() === "") return undefined;
  const parts = raw.split(",").map(part => part.trim());
  if (parts.some(part => part === "")) {
    throw new Error("TXLINE_STAT_KEYS must be a comma-separated list without empty entries");
  }
  const keys = parts.map((part, index) => requiredSafeInteger(
    part,
    `TXLINE_STAT_KEYS[${index}]`,
    0,
    0xffff_ffff,
  ));
  if (new Set(keys).size !== keys.length) {
    throw new Error("TXLINE_STAT_KEYS must not contain duplicates");
  }
  return keys;
}

export function extractScoreRecords(value: unknown): JsonObject[] {
  const records: JsonObject[] = [];
  const seen = new Set<object>();

  const visit = (current: unknown, depth: number): void => {
    if (depth > 8 || current === null || typeof current !== "object") return;
    if (seen.has(current as object)) return;
    seen.add(current as object);

    if (Array.isArray(current)) {
      current.forEach(item => visit(item, depth + 1));
      return;
    }

    const object = current as JsonObject;
    if (
      firstField(object, ["FixtureId", "fixtureId"]) !== undefined
      && firstField(object, ["Seq", "seq"]) !== undefined
      && firstField(object, ["Ts", "ts"]) !== undefined
    ) {
      records.push(object);
      return;
    }
    Object.values(object).forEach(child => visit(child, depth + 1));
  };

  visit(value, 0);
  return records;
}

export function fixtureIdOverride(): number | undefined {
  return parseOptionalIntegerEnv("TXLINE_FIXTURE_ID", 1, Number.MAX_SAFE_INTEGER);
}

export function validateScoreOverrides(expectedStatCount: number): void {
  if (!Number.isInteger(expectedStatCount) || expectedStatCount < 1) {
    throw new Error("expectedStatCount must be a positive integer");
  }
  const fixture = fixtureIdOverride();
  const seq = parseOptionalIntegerEnv("TXLINE_SEQ", 1, Number.MAX_SAFE_INTEGER);
  if ((fixture === undefined) !== (seq === undefined)) {
    throw new Error("TXLINE_FIXTURE_ID and TXLINE_SEQ must be set together");
  }
  const keys = requestedStatKeys();
  if (keys && keys.length !== expectedStatCount) {
    throw new Error(
      `TXLINE_STAT_KEYS must contain exactly ${expectedStatCount} key(s) for this example`,
    );
  }
}

function fixtureIdsInHistoricalWindow(value: unknown, now: number): number[] {
  const fixtureIds = new Set<number>();
  const seen = new Set<object>();
  const earliest = now - 14 * 86_400_000;
  const latest = now - 6 * 60 * 60_000;

  const visit = (current: unknown, depth: number): void => {
    if (depth > 8 || current === null || typeof current !== "object") return;
    if (seen.has(current as object)) return;
    seen.add(current as object);
    if (Array.isArray(current)) {
      current.forEach(item => visit(item, depth + 1));
      return;
    }
    const object = current as JsonObject;
    const rawFixtureId = firstField(object, ["FixtureId", "fixtureId"]);
    const rawStartTime = firstField(object, ["StartTime", "startTime"]);
    if (rawFixtureId !== undefined && rawStartTime !== undefined) {
      try {
        const startTime = requiredSafeInteger(
          rawStartTime,
          "fixture StartTime/startTime (milliseconds)",
          1_000_000_000_000,
        );
        if (startTime >= earliest && startTime <= latest) {
          fixtureIds.add(requiredSafeInteger(rawFixtureId, "fixture FixtureId/fixtureId", 1));
        }
      } catch {
        // Ignore malformed fixture rows and continue bounded discovery.
      }
    }
    Object.values(object).forEach(child => visit(child, depth + 1));
  };

  visit(value, 0);
  return [...fixtureIds];
}

function axiosStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

/** Return a diagnostic that cannot serialize headers, configs, tokens, or bodies. */
export function safeError(error: unknown, operation: string): Error {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    return new Error(`${operation} failed${status ? ` with HTTP ${status}` : " before an HTTP response"}`);
  }
  return error instanceof Error
    ? new Error(`${operation} failed: ${error.message}`)
    : new Error(`${operation} failed`);
}

async function getBody(apiClient: AxiosInstance, path: string, allowNotFound = false): Promise<unknown> {
  try {
    const response = await apiClient.get(path, { timeout: 15_000 });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`unexpected HTTP ${response.status}`);
    }
    return response.data;
  } catch (error) {
    if (allowNotFound && axiosStatus(error) === 404) return [];
    throw safeError(error, `GET ${path.split("?")[0]}`);
  }
}

function hasFinalAction(record: JsonObject): boolean {
  const action = firstField(record, ["action", "Action"]);
  return action === "game_finalised";
}

export async function discoverScoreRecord(
  apiClient: AxiosInstance,
  minimumStatCount: number,
  options: { finalOnly?: boolean } = {},
): Promise<ScoreSelection> {
  if (!Number.isInteger(minimumStatCount) || minimumStatCount < 1) {
    throw new Error("minimumStatCount must be a positive integer");
  }

  const fixtureOverride = fixtureIdOverride();
  const seqOverride = parseOptionalIntegerEnv("TXLINE_SEQ", 1, Number.MAX_SAFE_INTEGER);
  if ((fixtureOverride === undefined) !== (seqOverride === undefined)) {
    throw new Error("TXLINE_FIXTURE_ID and TXLINE_SEQ must be set together");
  }

  const exactKeys = requestedStatKeys();
  if (exactKeys && exactKeys.length < minimumStatCount) {
    throw new Error(`TXLINE_STAT_KEYS must contain at least ${minimumStatCount} keys for this example`);
  }

  const candidates: JsonObject[] = [];
  const addBody = (body: unknown): void => {
    candidates.push(...extractScoreRecords(body));
  };
  const requestCap = 36;
  let requestCount = 0;
  const boundedGetBody = async (path: string, allowNotFound = false): Promise<unknown> => {
    requestCount++;
    if (requestCount > requestCap) {
      throw new Error(`Score discovery exceeded its ${requestCap}-request cap`);
    }
    return getBody(apiClient, path, allowNotFound);
  };

  // Current Flow default: discover current score records from UTC five-minute
  // buckets. This is bounded to two hours and never falls back to a fixture ID.
  const now = Date.now();
  if (!options.finalOnly) {
    for (let index = 0; index < 24; index++) {
      const target = new Date(now - index * 5 * 60_000);
      const epochDay = Math.floor(target.getTime() / 86_400_000);
      const hour = target.getUTCHours();
      const interval = Math.floor(target.getUTCMinutes() / 5);
      const suffix = fixtureOverride === undefined ? "" : `?fixtureId=${fixtureOverride}`;
      addBody(await boundedGetBody(
        `/scores/updates/${epochDay}/${hour}/${interval}${suffix}`,
        true,
      ));
    }
  }

  // Non-final history checks use fixture IDs observed in current updates.
  // Final-record checks instead discover fixture IDs from the retention window;
  // an explicit paired fixture/sequence override is supported in either mode.
  const observedFixtureIds = [...new Set(candidates.flatMap(record => {
    try { return [scoreIdentity(record).fixtureId]; } catch { return []; }
  }))];
  let fixtureIds: number[];
  if (fixtureOverride !== undefined) {
    fixtureIds = [fixtureOverride];
  } else if (options.finalOnly) {
    // The historical endpoint is fixture-scoped. Discover eligible fixtures
    // from the documented 6-hour-to-14-day UTC window, then query only those
    // actual IDs. One fixture snapshot plus ten histories uses at most 11
    // requests, below the shared 36-request discovery cap.
    const startEpochDay = Math.floor((now - 14 * 86_400_000) / 86_400_000);
    const fixtureSnapshot = await boundedGetBody(
      `/fixtures/snapshot?startEpochDay=${startEpochDay}`,
      true,
    );
    fixtureIds = [...new Set([
      ...fixtureIdsInHistoricalWindow(fixtureSnapshot, now),
    ])].slice(0, 10);
  } else {
    fixtureIds = observedFixtureIds.slice(0, 6);
  }
  for (const fixtureId of fixtureIds) {
    addBody(await boundedGetBody(`/scores/historical/${fixtureId}`, true));
    if (!options.finalOnly) {
      addBody(await boundedGetBody(`/scores/snapshot/${fixtureId}?asOf=${now}`, true));
    }
  }

  // Some projections return one stat per row. Group only rows with the exact
  // same observed fixture/sequence/timestamp so multi-stat selection remains
  // tied to one real score event.
  const groups = new Map<string, JsonObject[]>();
  for (const candidate of candidates) {
    try {
      const identity = scoreIdentity(candidate);
      const key = `${identity.fixtureId}:${identity.seq}:${identity.ts}`;
      const group = groups.get(key) ?? [];
      group.push(candidate);
      groups.set(key, group);
    } catch {
      // Malformed candidates are ignored; a valid selection is still required.
    }
  }
  const groupedCandidates = [...groups.values()].map(group => {
    const base = options.finalOnly
      ? group.find(hasFinalAction) ?? group[0]
      : group[0];
    return { ...base, __scoreRecords: group } as JsonObject;
  });

  for (const record of groupedCandidates) {
    let identity: ReturnType<typeof scoreIdentity>;
    try {
      identity = scoreIdentity(record);
    } catch {
      continue;
    }
    if (fixtureOverride !== undefined && identity.fixtureId !== fixtureOverride) continue;
    if (seqOverride !== undefined && identity.seq !== seqOverride) continue;
    // Select finalisation records by the explicit action marker. Status and
    // period are separate assertions made by the final-record caller.
    if (options.finalOnly && !hasFinalAction(record)) continue;

    const availableKeys = statKeysInRecord(record);
    const selectedKeys = exactKeys ?? availableKeys.slice(0, minimumStatCount);
    if (selectedKeys.length < minimumStatCount) continue;
    if (!selectedKeys.every(key => availableKeys.includes(key))) continue;

    return { record, ...identity, statKeys: selectedKeys };
  }

  const purpose = options.finalOnly
    ? "an eligible action=game_finalised record"
    : "a score record containing the requested stat keys";
  if (options.finalOnly) {
    throw new InconclusiveError(`No ${purpose} was available in the bounded devnet window`);
  }
  throw new Error(`No ${purpose} was available in the bounded devnet window`);
}

export function sseDurationSeconds(): number {
  const raw = process.env.TXLINE_SSE_SECONDS ?? "30";
  return requiredSafeInteger(raw, "TXLINE_SSE_SECONDS", 30, 45);
}

export type SseObservation = {
  outcome: "data" | "inconclusive";
  opened: true;
  heartbeatCount: number;
  dataCount: number;
  lastEventId?: string;
};

type SseOptions = {
  url: string;
  jwt: () => string;
  apiToken: () => string;
  renewJwt: () => Promise<string>;
  durationSeconds?: number;
  initialLastEventId?: string;
};

export type ParsedSse = { heartbeatCount: number; dataCount: number; lastEventId?: string };

class FatalSseError extends Error {}

export function parseSseFrame(frame: string, state: ParsedSse): void {
  const lines = frame.split(/\r?\n/);
  let eventName = "message";
  let hasData = false;
  let commentHeartbeat = false;
  for (const line of lines) {
    if (line.startsWith(":")) {
      commentHeartbeat = true;
    } else if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("id:")) {
      const id = line.slice(3).trim();
      if (!id.includes("\0")) state.lastEventId = id || undefined;
    } else if (line.startsWith("data:")) {
      hasData = true;
    }
  }
  if (eventName === "heartbeat" || eventName === "ping") {
    state.heartbeatCount++;
  } else if (hasData) {
    state.dataCount++;
  } else if (commentHeartbeat) {
    state.heartbeatCount++;
  }
}

/**
 * Bounded native-fetch SSE smoke/data probe. Native fetch handles negotiated
 * content encoding; this deliberately sets no compression-negotiation header and never
 * manually decompresses response chunks.
 */
export async function observeSse(options: SseOptions): Promise<SseObservation> {
  const durationSeconds = options.durationSeconds ?? sseDurationSeconds();
  if (durationSeconds < 30 || durationSeconds > 45) {
    throw new Error("SSE duration must be between 30 and 45 seconds");
  }

  const deadline = Date.now() + durationSeconds * 1_000;
  const parsed: ParsedSse = { heartbeatCount: 0, dataCount: 0, lastEventId: options.initialLastEventId };
  let renewed = false;
  let reconnects = 0;
  let opened = false;

  while (Date.now() < deadline && reconnects <= 1) {
    const controller = new AbortController();
    const remaining = deadline - Date.now();
    const timer = setTimeout(() => controller.abort(), remaining);
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      Authorization: `Bearer ${options.jwt()}`,
      "X-Api-Token": options.apiToken(),
    };
    if (parsed.lastEventId) headers["Last-Event-ID"] = parsed.lastEventId;

    try {
      let response = await fetch(options.url, { headers, signal: controller.signal });
      const cancelResponseBody = async (): Promise<void> => {
        await response.body?.cancel().catch(() => undefined);
      };
      if (response.status === 401 && !renewed) {
        renewed = true;
        await cancelResponseBody();
        await options.renewJwt();
        headers.Authorization = `Bearer ${options.jwt()}`;
        response = await fetch(options.url, { headers, signal: controller.signal });
      }
      if (response.status === 401) {
        await cancelResponseBody();
        throw new FatalSseError("SSE authentication failed after one bounded JWT renewal");
      }
      if (response.status === 403) {
        await cancelResponseBody();
        throw new FatalSseError(
          "SSE access forbidden: verify API token, subscription, and bundle entitlement",
        );
      }
      if (!response.ok || !response.body) {
        await cancelResponseBody();
        const message = `SSE request failed with HTTP ${response.status}`;
        if (response.status >= 400 && response.status < 500) throw new FatalSseError(message);
        throw new Error(message);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("text/event-stream")) {
        await cancelResponseBody();
        throw new FatalSseError("SSE endpoint returned an unexpected content type");
      }
      opened = true;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let endedEarly = false;
      try {
        while (Date.now() < deadline) {
          const { done, value } = await reader.read();
          if (done) {
            endedEarly = Date.now() < deadline;
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let boundary: number;
          while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
            const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
            if (!match) break;
            parseSseFrame(buffer.slice(0, boundary), parsed);
            buffer = buffer.slice(boundary + match[0].length);
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      if (endedEarly && reconnects < 1) {
        reconnects++;
        continue;
      }
    } catch (error) {
      if (error instanceof FatalSseError) throw error;
      if (!(error instanceof Error && error.name === "AbortError") && Date.now() < deadline) {
        reconnects++;
        if (reconnects > 1) throw safeError(error, "SSE stream");
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
    break;
  }

  if (!opened) throw new Error("SSE connection was never accepted");
  return {
    outcome: parsed.dataCount > 0 ? "data" : "inconclusive",
    opened: true,
    heartbeatCount: parsed.heartbeatCount,
    dataCount: parsed.dataCount,
    lastEventId: parsed.lastEventId,
  };
}

export function summarizeSse(label: string, observation: SseObservation): void {
  if (observation.outcome === "data") {
    console.log(`${label}: data-flow pass (${observation.dataCount} data event(s))`);
    return;
  }
  throw new InconclusiveError(
    `${label}: authentication/transport smoke pass with ${observation.heartbeatCount} heartbeat(s), `
    + "but data flow is inconclusive because no covered-fixture data event arrived",
  );
}
