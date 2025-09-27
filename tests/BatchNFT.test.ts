import { describe, it, expect, beforeEach } from "vitest";
import { ClarityValue, cvToValue, stringAsciiCV, uintCV } from "@stacks/transactions";

const ERR_UNAUTHORIZED = 1000;
const ERR_SUPPLY_EXCEEDED = 1001;
const ERR_INVALID_RECIPIENT = 1002;
const ERR_INVALID_URI = 1003;
const ERR_TOKEN_NOT_FOUND = 1004;
const ERR_ALREADY_MINTED = 1005;
const ERR_INVALID_ID = 1006;
const ERR_PAUSED = 1007;
const ERR_INVALID_METADATA = 1008;
const ERR_OWNER_ONLY = 1009;
const ERR_INVALID_SUPPLY = 1010;
const ERR_BURN_FAILED = 1011;
const ERR_INVALID_ORIGIN = 1012;
const ERR_INVALID_QUANTITY = 1013;
const ERR_INVALID_TIMESTAMP = 1014;
const ERR_MAX_SUPPLY_REACHED = 1015;
const ERR_INVALID_STATUS = 1016;
const ERR_INVALID_BATCH_TYPE = 1017;
const ERR_INVALID_LOCATION = 1018;
const ERR_INVALID_CURRENCY = 1019;
const ERR_SUPPLY_UPDATE_NOT_ALLOWED = 1020;

interface Metadata {
  origin: string;
  quantity: number;
  timestamp: number;
  batchType: string;
  location: string;
  currency: string;
  status: boolean;
}

interface HistoryEntry {
  from: string;
  to: string;
  timestamp: number;
}

type History = HistoryEntry[];

interface Result<T> {
  ok: boolean;
  value: T | number;
}

class BatchNFTMock {
  state: {
    lastId: number;
    maxSupply: number;
    contractOwner: string;
    paused: boolean;
    mintFee: number;
    authorityPrincipal: string | null;
    tokenOwner: Map<number, string>;
    tokenUri: Map<number, string>;
    tokenMetadata: Map<number, Metadata>;
    tokenHistory: Map<number, History>;
  } = {
    lastId: 0,
    maxSupply: 1000000,
    contractOwner: "ST1OWNER",
    paused: false,
    mintFee: 100,
    authorityPrincipal: null,
    tokenOwner: new Map(),
    tokenUri: new Map(),
    tokenMetadata: new Map(),
    tokenHistory: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1CALLER";
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      lastId: 0,
      maxSupply: 1000000,
      contractOwner: "ST1OWNER",
      paused: false,
      mintFee: 100,
      authorityPrincipal: null,
      tokenOwner: new Map(),
      tokenUri: new Map(),
      tokenMetadata: new Map(),
      tokenHistory: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1CALLER";
    this.stxTransfers = [];
  }

  getOwner(tokenId: number): string | null {
    return this.state.tokenOwner.get(tokenId) || null;
  }

  getLastTokenId(): Result<number> {
    return { ok: true, value: this.state.lastId };
  }

  getTokenUri(tokenId: number): Result<string | null> {
    return { ok: true, value: this.state.tokenUri.get(tokenId) || null };
  }

  getMetadata(tokenId: number): Metadata | null {
    return this.state.tokenMetadata.get(tokenId) || null;
  }

  getHistory(tokenId: number): History | null {
    return this.state.tokenHistory.get(tokenId) || null;
  }

  isPaused(): boolean {
    return this.state.paused;
  }

  getMaxSupply(): number {
    return this.state.maxSupply;
  }

  setPaused(newPaused: boolean): Result<boolean> {
    if (this.caller !== this.state.contractOwner) {
      return { ok: false, value: ERR_OWNER_ONLY };
    }
    this.state.paused = newPaused;
    return { ok: true, value: true };
  }

  setMaxSupply(newSupply: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner) {
      return { ok: false, value: ERR_OWNER_ONLY };
    }
    if (newSupply <= 0) {
      return { ok: false, value: ERR_INVALID_SUPPLY };
    }
    if (newSupply <= this.state.lastId) {
      return { ok: false, value: ERR_SUPPLY_UPDATE_NOT_ALLOWED };
    }
    this.state.maxSupply = newSupply;
    return { ok: true, value: true };
  }

  setAuthority(newAuthority: string): Result<boolean> {
    if (this.caller !== this.state.contractOwner) {
      return { ok: false, value: ERR_OWNER_ONLY };
    }
    if (newAuthority === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: ERR_INVALID_RECIPIENT };
    }
    this.state.authorityPrincipal = newAuthority;
    return { ok: true, value: true };
  }

  setMintFee(newFee: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner) {
      return { ok: false, value: ERR_OWNER_ONLY };
    }
    this.state.mintFee = newFee;
    return { ok: true, value: true };
  }

  transfer(tokenId: number, sender: string, recipient: string): Result<boolean> {
    if (this.state.paused) {
      return { ok: false, value: ERR_PAUSED };
    }
    if (sender !== this.caller) {
      return { ok: false, value: ERR_UNAUTHORIZED };
    }
    const currentOwner = this.getOwner(tokenId);
    if (!currentOwner || currentOwner !== sender) {
      return { ok: false, value: ERR_UNAUTHORIZED };
    }
    if (recipient === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: ERR_INVALID_RECIPIENT };
    }
    const existingHistory = this.state.tokenHistory.get(tokenId) || [];
    if (existingHistory.length >= 50) {
      return { ok: false, value: ERR_SUPPLY_EXCEEDED };
    }
    const newEntry: HistoryEntry = { from: sender, to: recipient, timestamp: this.blockHeight };
    const updatedHistory = [...existingHistory, newEntry];
    this.state.tokenOwner.set(tokenId, recipient);
    this.state.tokenHistory.set(tokenId, updatedHistory);
    if (this.state.authorityPrincipal) {
      this.stxTransfers.push({ amount: 10, from: this.caller, to: this.state.authorityPrincipal });
    }
    return { ok: true, value: true };
  }

  mint(recipient: string, uri: string, origin: string, quantity: number, batchType: string, location: string, currency: string): Result<number> {
    if (this.state.paused) {
      return { ok: false, value: ERR_PAUSED };
    }
    const newId = this.state.lastId + 1;
    if (newId > this.state.maxSupply) {
      return { ok: false, value: ERR_MAX_SUPPLY_REACHED };
    }
    if (recipient === "SP000000000000000000002Q6VF78") {
      return { ok: false, value: ERR_INVALID_RECIPIENT };
    }
    if (uri.length === 0 || uri.length > 256) {
      return { ok: false, value: ERR_INVALID_URI };
    }
    if (origin.length === 0 || origin.length > 128) {
      return { ok: false, value: ERR_INVALID_ORIGIN };
    }
    if (quantity <= 0) {
      return { ok: false, value: ERR_INVALID_QUANTITY };
    }
    if (!["food", "pharma", "manufacture"].includes(batchType)) {
      return { ok: false, value: ERR_INVALID_BATCH_TYPE };
    }
    if (location.length === 0 || location.length > 100) {
      return { ok: false, value: ERR_INVALID_LOCATION };
    }
    if (!["STX", "USD", "BTC"].includes(currency)) {
      return { ok: false, value: ERR_INVALID_CURRENCY };
    }
    if (this.state.authorityPrincipal) {
      this.stxTransfers.push({ amount: this.state.mintFee, from: this.caller, to: this.state.authorityPrincipal });
    }
    this.state.tokenOwner.set(newId, recipient);
    this.state.tokenUri.set(newId, uri);
    this.state.tokenMetadata.set(newId, {
      origin,
      quantity,
      timestamp: this.blockHeight,
      batchType,
      location,
      currency,
      status: true,
    });
    this.state.tokenHistory.set(newId, [{ from: this.caller, to: recipient, timestamp: this.blockHeight }]);
    this.state.lastId = newId;
    return { ok: true, value: newId };
  }

  burn(tokenId: number): Result<boolean> {
    if (this.state.paused) {
      return { ok: false, value: ERR_PAUSED };
    }
    const currentOwner = this.getOwner(tokenId);
    if (!currentOwner || currentOwner !== this.caller) {
      return { ok: false, value: ERR_UNAUTHORIZED };
    }
    if (tokenId > this.state.lastId) {
      return { ok: false, value: ERR_INVALID_ID };
    }
    this.state.tokenOwner.delete(tokenId);
    this.state.tokenUri.delete(tokenId);
    this.state.tokenMetadata.delete(tokenId);
    this.state.tokenHistory.delete(tokenId);
    return { ok: true, value: true };
  }

  updateMetadata(tokenId: number, newOrigin: string, newQuantity: number, newBatchType: string, newLocation: string, newCurrency: string, newStatus: boolean): Result<boolean> {
    if (this.state.paused) {
      return { ok: false, value: ERR_PAUSED };
    }
    const currentOwner = this.getOwner(tokenId);
    if (!currentOwner || currentOwner !== this.caller) {
      return { ok: false, value: ERR_UNAUTHORIZED };
    }
    const existingMeta = this.getMetadata(tokenId);
    if (!existingMeta) {
      return { ok: false, value: ERR_INVALID_METADATA };
    }
    if (newOrigin.length === 0 || newOrigin.length > 128) {
      return { ok: false, value: ERR_INVALID_ORIGIN };
    }
    if (newQuantity <= 0) {
      return { ok: false, value: ERR_INVALID_QUANTITY };
    }
    if (!["food", "pharma", "manufacture"].includes(newBatchType)) {
      return { ok: false, value: ERR_INVALID_BATCH_TYPE };
    }
    if (newLocation.length === 0 || newLocation.length > 100) {
      return { ok: false, value: ERR_INVALID_LOCATION };
    }
    if (!["STX", "USD", "BTC"].includes(newCurrency)) {
      return { ok: false, value: ERR_INVALID_CURRENCY };
    }
    this.state.tokenMetadata.set(tokenId, {
      origin: newOrigin,
      quantity: newQuantity,
      timestamp: existingMeta.timestamp,
      batchType: newBatchType,
      location: newLocation,
      currency: newCurrency,
      status: newStatus,
    });
    return { ok: true, value: true };
  }

  updateUri(tokenId: number, newUri: string): Result<boolean> {
    if (this.state.paused) {
      return { ok: false, value: ERR_PAUSED };
    }
    const currentOwner = this.getOwner(tokenId);
    if (!currentOwner || currentOwner !== this.caller) {
      return { ok: false, value: ERR_UNAUTHORIZED };
    }
    if (newUri.length === 0 || newUri.length > 256) {
      return { ok: false, value: ERR_INVALID_URI };
    }
    this.state.tokenUri.set(tokenId, newUri);
    return { ok: true, value: true };
  }
}

describe("BatchNFT", () => {
  let contract: BatchNFTMock;

  beforeEach(() => {
    contract = new BatchNFTMock();
    contract.reset();
  });

  it("mints a token successfully", () => {
    contract.state.contractOwner = "ST1CALLER";
    contract.setAuthority("ST2AUTH");
    const result = contract.mint("ST3RECIP", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1);
    expect(contract.getOwner(1)).toBe("ST3RECIP");
    expect(contract.getTokenUri(1)?.value).toBe("uri://example");
    const meta = contract.getMetadata(1);
    expect(meta?.origin).toBe("OriginX");
    expect(meta?.quantity).toBe(100);
    expect(meta?.batchType).toBe("food");
    expect(meta?.location).toBe("LocY");
    expect(meta?.currency).toBe("STX");
    expect(meta?.status).toBe(true);
    const history = contract.getHistory(1);
    expect(history?.[0].to).toBe("ST3RECIP");
    expect(contract.stxTransfers).toEqual([{ amount: 100, from: "ST1CALLER", to: "ST2AUTH" }]);
  });

  it("rejects mint when paused", () => {
    contract.state.contractOwner = "ST1CALLER";
    contract.setPaused(true);
    const result = contract.mint("ST3RECIP", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAUSED);
  });

  it("rejects mint with invalid uri", () => {
    const longUri = "a".repeat(257);
    const result = contract.mint("ST3RECIP", longUri, "OriginX", 100, "food", "LocY", "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_URI);
  });

  it("transfers a token successfully", () => {
    contract.state.contractOwner = "ST1CALLER";
    contract.mint("ST1CALLER", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    contract.setAuthority("ST2AUTH");
    const result = contract.transfer(1, "ST1CALLER", "ST4NEW");
    expect(result.ok).toBe(true);
    expect(contract.getOwner(1)).toBe("ST4NEW");
    const history = contract.getHistory(1);
    expect(history?.[1].to).toBe("ST4NEW");
    expect(contract.stxTransfers).toEqual([{ amount: 10, from: "ST1CALLER", to: "ST2AUTH" }]);
  });

  it("rejects transfer when paused", () => {
    contract.state.contractOwner = "ST1CALLER";
    contract.mint("ST1CALLER", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    contract.setPaused(true);
    const result = contract.transfer(1, "ST1CALLER", "ST4NEW");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAUSED);
  });

  it("rejects transfer by non-owner", () => {
    contract.mint("ST5OTHER", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    const result = contract.transfer(1, "ST1CALLER", "ST4NEW");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("burns a token successfully", () => {
    contract.mint("ST1CALLER", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    const result = contract.burn(1);
    expect(result.ok).toBe(true);
    expect(contract.getOwner(1)).toBe(null);
    expect(contract.getMetadata(1)).toBe(null);
    expect(contract.getHistory(1)).toBe(null);
  });

  it("rejects burn when paused", () => {
    contract.state.contractOwner = "ST1CALLER";
    contract.mint("ST1CALLER", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    contract.setPaused(true);
    const result = contract.burn(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAUSED);
  });

  it("rejects burn by non-owner", () => {
    contract.mint("ST5OTHER", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    const result = contract.burn(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("updates metadata successfully", () => {
    contract.mint("ST1CALLER", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    const result = contract.updateMetadata(1, "NewOrigin", 200, "pharma", "NewLoc", "USD", false);
    expect(result.ok).toBe(true);
    const meta = contract.getMetadata(1);
    expect(meta?.origin).toBe("NewOrigin");
    expect(meta?.quantity).toBe(200);
    expect(meta?.batchType).toBe("pharma");
    expect(meta?.location).toBe("NewLoc");
    expect(meta?.currency).toBe("USD");
    expect(meta?.status).toBe(false);
  });

  it("rejects metadata update when paused", () => {
    contract.state.contractOwner = "ST1CALLER";
    contract.mint("ST1CALLER", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    contract.setPaused(true);
    const result = contract.updateMetadata(1, "NewOrigin", 200, "pharma", "NewLoc", "USD", false);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAUSED);
  });

  it("rejects metadata update with invalid batch type", () => {
    contract.mint("ST1CALLER", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    const result = contract.updateMetadata(1, "NewOrigin", 200, "invalid", "NewLoc", "USD", false);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_BATCH_TYPE);
  });

  it("updates uri successfully", () => {
    contract.mint("ST1CALLER", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    const result = contract.updateUri(1, "new-uri://updated");
    expect(result.ok).toBe(true);
    expect(contract.getTokenUri(1)?.value).toBe("new-uri://updated");
  });

  it("rejects uri update when paused", () => {
    contract.state.contractOwner = "ST1CALLER";
    contract.mint("ST1CALLER", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    contract.setPaused(true);
    const result = contract.updateUri(1, "new-uri://updated");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAUSED);
  });

  it("rejects uri update with invalid length", () => {
    contract.mint("ST1CALLER", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    const longUri = "a".repeat(257);
    const result = contract.updateUri(1, longUri);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_URI);
  });

  it("sets paused successfully", () => {
    contract.state.contractOwner = "ST1CALLER";
    const result = contract.setPaused(true);
    expect(result.ok).toBe(true);
    expect(contract.isPaused()).toBe(true);
  });

  it("rejects set paused by non-owner", () => {
    const result = contract.setPaused(true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_OWNER_ONLY);
  });

  it("sets max supply successfully", () => {
    contract.state.contractOwner = "ST1CALLER";
    const result = contract.setMaxSupply(5000000);
    expect(result.ok).toBe(true);
    expect(contract.getMaxSupply()).toBe(5000000);
  });

  it("rejects set max supply by non-owner", () => {
    const result = contract.setMaxSupply(5000000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_OWNER_ONLY);
  });

  it("rejects invalid max supply", () => {
    contract.state.contractOwner = "ST1CALLER";
    const result = contract.setMaxSupply(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_SUPPLY);
  });

  it("sets authority successfully", () => {
    contract.state.contractOwner = "ST1CALLER";
    const result = contract.setAuthority("ST2AUTH");
    expect(result.ok).toBe(true);
    expect(contract.state.authorityPrincipal).toBe("ST2AUTH");
  });

  it("rejects set authority by non-owner", () => {
    const result = contract.setAuthority("ST2AUTH");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_OWNER_ONLY);
  });

  it("rejects invalid authority", () => {
    contract.state.contractOwner = "ST1CALLER";
    const result = contract.setAuthority("SP000000000000000000002Q6VF78");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_RECIPIENT);
  });

  it("sets mint fee successfully", () => {
    contract.state.contractOwner = "ST1CALLER";
    const result = contract.setMintFee(200);
    expect(result.ok).toBe(true);
    expect(contract.state.mintFee).toBe(200);
  });

  it("rejects set mint fee by non-owner", () => {
    const result = contract.setMintFee(200);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_OWNER_ONLY);
  });

  it("rejects mint beyond max supply", () => {
    contract.state.lastId = 1000000;
    const result = contract.mint("ST3RECIP", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_SUPPLY_REACHED);
  });

  it("gets last token id correctly", () => {
    contract.mint("ST3RECIP", "uri://example", "OriginX", 100, "food", "LocY", "STX");
    const result = contract.getLastTokenId();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1);
  });

  it("parses clarity values", () => {
    const uriCV = stringAsciiCV("uri://example");
    const idCV = uintCV(1);
    expect(cvToValue(uriCV)).toBe("uri://example");
    expect(cvToValue(idCV)).toBe(1n);
  });
});