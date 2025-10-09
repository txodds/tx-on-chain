import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { BinaryWriter } from "borsh";

export class ComparisonEnum {
  type: string;

  constructor(properties: { [key: string]: {} }) {
    this.type = Object.keys(properties)[0];
  }

  serialize(writer: BinaryWriter): void {
    const normalizedType = this.type.charAt(0).toLowerCase() + this.type.slice(1);
    const discriminant =
      normalizedType === "greaterThan" ? 0 : normalizedType === "lessThan" ? 1 : 2;
    writer.writeU8(discriminant);
  }

  toJSON() {
    return {
      type: this.type.charAt(0).toUpperCase() + this.type.slice(1),
    };
  }
}

export class BinaryOpEnum {
  type: string;

  constructor(properties: { [key: string]: {} }) {
    this.type = Object.keys(properties)[0];
  }

  serialize(writer: BinaryWriter): void {
    const discriminant = this.type === "add" ? 0 : 1;
    writer.writeU8(discriminant);
  }

  toJSON() {
    return {
      type: this.type.charAt(0).toUpperCase() + this.type.slice(1),
    };
  }
}

export class StatTerm {
  key: number;
  constructor(fields: { key: number }) {
    this.key = fields.key;
  }

  serialize(writer: BinaryWriter): void {
    writer.writeU16(this.key);
  }
}

export class Predicate {
  threshold: number;
  comparison: ComparisonEnum;

  constructor(fields: {
    threshold: number;
    comparison: { [key: string]: {} } | ComparisonEnum;
  }) {
    this.threshold = fields.threshold;
    if (fields.comparison instanceof ComparisonEnum) {
      this.comparison = fields.comparison;
    } else {
      this.comparison = new ComparisonEnum(fields.comparison);
    }
  }
  serialize(writer: BinaryWriter): void {
    const thresholdBuffer = new BN(this.threshold).toBuffer("le", 4);
    writer.writeFixedArray(thresholdBuffer);

    this.comparison.serialize(writer);
  }
}

export class Offer {
  fixtureId: BN;
  period: number;
  predicate: Predicate;
  binaryOp?: BinaryOpEnum;
  statA: StatTerm;
  statB?: StatTerm;
  stake: BN;
  odds: number;
  expiration: BN;
  traderPubkey: PublicKey;

  constructor(fields: any) {
    this.fixtureId = fields.fixtureId;
    this.period = fields.period;
    this.predicate = new Predicate(fields.predicate);
    this.binaryOp = fields.binaryOp
      ? new BinaryOpEnum(fields.binaryOp)
      : undefined;
    this.statA = new StatTerm(fields.statA);
    this.statB = fields.statB ? new StatTerm(fields.statB) : undefined;
    this.stake = fields.stake;
    this.odds = fields.odds;
    this.expiration = fields.expiration;
    this.traderPubkey = fields.traderPubkey;
  }

  serialize(): Buffer {
    const writer = new BinaryWriter();

    writer.writeU64(this.fixtureId);
    writer.writeU8(this.period);
    this.predicate.serialize(writer);

    writer.writeU8(this.binaryOp ? 1 : 0);
    if (this.binaryOp) {
      this.binaryOp.serialize(writer);
    }

    this.statA.serialize(writer);

    writer.writeU8(this.statB ? 1 : 0);
    if (this.statB) {
      this.statB.serialize(writer);
    }

    writer.writeU64(this.stake);
    writer.writeFixedArray(new BN(this.odds).toBuffer("le", 4));
    writer.writeFixedArray(this.expiration.toBuffer("le", 8));
    writer.writeFixedArray(this.traderPubkey.toBuffer());

    return Buffer.from(writer.toArray());
  }
}

export type OfferTerms = {
  fixtureId: BN;
  period: number;
  predicate: any;
  statA: { key: number };
  statB: { key: number } | null;
  binaryOp: any | null;
  stake: BN;
  odds: number;
  expiration: BN;
};
