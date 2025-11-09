import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV, principalCV, listCV, noneCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_BATCH_ID = 101;
const ERR_TRANSFER_FAILED = 102;
const ERR_HISTORY_FULL = 103;
const ERR_INVALID_NOTES = 104;
const ERR_BATCH_NOT_OWNED = 105;
const ERR_TRANSFER_NOT_VERIFIED = 106;
const ERR_MAX_HISTORY_EXCEEDED = 107;
const ERR_INVALID_TIMESTAMP = 108;
const ERR_ROLE_NOT_VERIFIED = 109;
const ERR_DUPLICATE_TRANSFER = 110;
const ERR_INVALID_LOCATION = 111;
const ERR_INVALID_CURRENCY = 112;
const ERR_TRANSFER_STATUS_INVALID = 113;

interface TransferLog {
  id: number;
  from: string;
  to: string;
  timestamp: number;
  notes: string;
  location: string;
  currency: string;
  status: boolean;
  verified: boolean;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class TransferLoggerMock {
  state: {
    maxHistoryEntries: number;
    authorityContract: string | null;
    logFee: number;
    nextLogId: number;
    transferHistory: Map<number, TransferLog[]>;
    batchTransfersCount: Map<number, number>;
    transfersByBatch: Map<number, number[]>;
    transferStatus: Map<number, boolean>;
  } = {
    maxHistoryEntries: 100,
    authorityContract: null,
    logFee: 500,
    nextLogId: 0,
    transferHistory: new Map(),
    batchTransfersCount: new Map(),
    transfersByBatch: new Map(),
    transferStatus: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  authorities: Set<string> = new Set(["ST1TEST"]);
  stxTransfers: Array<{ amount: number; from: string; to: string | null }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      maxHistoryEntries: 100,
      authorityContract: null,
      logFee: 500,
      nextLogId: 0,
      transferHistory: new Map(),
      batchTransfersCount: new Map(),
      transfersByBatch: new Map(),
      transferStatus: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.authorities = new Set(["ST1TEST"]);
    this.stxTransfers = [];
  }

  isVerifiedAuthority(principal: string): Result<boolean> {
    return { ok: true, value: this.authorities.has(principal) };
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (contractPrincipal === this.caller) {
      return { ok: false, value: false };
    }
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setMaxHistoryEntries(newMax: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.maxHistoryEntries = newMax;
    return { ok: true, value: true };
  }

  setLogFee(newFee: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.logFee = newFee;
    return { ok: true, value: true };
  }

  logTransfer(
    batchId: number,
    to: string,
    notes: string,
    location: string,
    currency: string,
    nftOwner: string
  ): Result<number> {
    if (batchId <= 0) return { ok: false, value: ERR_INVALID_BATCH_ID };
    if (notes.length === 0 || notes.length > 128) return { ok: false, value: ERR_INVALID_NOTES };
    if (location.length === 0 || location.length > 64) return { ok: false, value: ERR_INVALID_LOCATION };
    if (!["STX", "USD", "BTC"].includes(currency)) return { ok: false, value: ERR_INVALID_CURRENCY };
    if (this.blockHeight < this.blockHeight) return { ok: false, value: ERR_INVALID_TIMESTAMP };
    if (nftOwner !== this.caller) return { ok: false, value: ERR_BATCH_NOT_OWNED };
    const count = this.state.batchTransfersCount.get(batchId) || 0;
    if (count >= this.state.maxHistoryEntries) return { ok: false, value: ERR_MAX_HISTORY_EXCEEDED };
    if (!this.state.authorityContract) return { ok: false, value: ERR_TRANSFER_NOT_VERIFIED };

    this.stxTransfers.push({ amount: this.state.logFee, from: this.caller, to: this.state.authorityContract });

    const nextId = this.state.nextLogId;
    const newLog: TransferLog = {
      id: nextId,
      from: this.caller,
      to,
      timestamp: this.blockHeight,
      notes,
      location,
      currency,
      status: true,
      verified: false,
    };
    const existing = this.state.transferHistory.get(batchId) || [];
    const updated = [...existing, newLog];
    this.state.transferHistory.set(batchId, updated);
    this.state.batchTransfersCount.set(batchId, count + 1);
    const batchTransfers = this.state.transfersByBatch.get(batchId) || [];
    this.state.transfersByBatch.set(batchId, [...batchTransfers, nextId]);
    this.state.transferStatus.set(nextId, true);
    this.state.nextLogId++;
    return { ok: true, value: nextId };
  }

  getTransferHistory(batchId: number): TransferLog[] | null {
    return this.state.transferHistory.get(batchId) || null;
  }

  getBatchTransfersCount(batchId: number): number {
    return this.state.batchTransfersCount.get(batchId) || 0;
  }

  getTransfersByBatch(batchId: number): number[] | null {
    return this.state.transfersByBatch.get(batchId) || null;
  }

  getTransferStatus(transferId: number): boolean | null {
    return this.state.transferStatus.get(transferId) ?? null;
  }

  verifyTransfer(transferId: number): Result<boolean> {
    const status = this.state.transferStatus.get(transferId);
    if (status === undefined || !status) return { ok: false, value: ERR_TRANSFER_STATUS_INVALID };
    if (!this.state.authorityContract) return { ok: false, value: ERR_ROLE_NOT_VERIFIED };
    this.state.transferStatus.set(transferId, false);
    return { ok: true, value: true };
  }

  updateTransferStatus(batchId: number, status: boolean): Result<boolean> {
    const history = this.state.transferHistory.get(batchId);
    if (!history) return { ok: false, value: false };
    if (this.caller !== this.state.authorityContract) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.transferHistory.set(batchId, history.map(log => ({ ...log, status })));
    return { ok: true, value: true };
  }

  getTotalLogCount(): Result<number> {
    return { ok: true, value: this.state.nextLogId };
  }

  checkTransferExistence(batchId: number): Result<boolean> {
    return { ok: true, value: this.state.transferHistory.has(batchId) };
  }

  batchLogTransfers(batchIds: number[], to: string, notes: string): Result<number> {
    if (!this.state.authorityContract) return { ok: false, value: ERR_TRANSFER_NOT_VERIFIED };
    let result = { ok: true, value: 0 };
    for (const id of batchIds) {
      const logResult = this.logTransfer(id, to, notes, "LOC", "STX", this.caller);
      if (!logResult.ok) {
        result = { ok: false, value: logResult.value };
        break;
      }
    }
    return result;
  }
}

describe("TransferLogger", () => {
  let contract: TransferLoggerMock;

  beforeEach(() => {
    contract = new TransferLoggerMock();
    contract.reset();
  });

  it("logs a transfer successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.logTransfer(1, "ST3RECIP", "Shipped via truck", "WarehouseA", "STX", "ST1TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const history = contract.getTransferHistory(1);
    expect(history?.length).toBe(1);
    expect(history?.[0]?.notes).toBe("Shipped via truck");
    expect(history?.[0]?.location).toBe("WarehouseA");
    expect(history?.[0]?.currency).toBe("STX");
    expect(history?.[0]?.status).toBe(true);
    expect(contract.stxTransfers).toEqual([{ amount: 500, from: "ST1TEST", to: "ST2TEST" }]);
  });

  it("rejects invalid batch id", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.logTransfer(0, "ST3RECIP", "Notes", "LOC", "STX", "ST1TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_BATCH_ID);
  });

  it("rejects invalid notes length", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.logTransfer(1, "ST3RECIP", "", "LOC", "STX", "ST1TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_NOTES);
  });

  it("rejects invalid location", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.logTransfer(1, "ST3RECIP", "Notes", "", "STX", "ST1TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_LOCATION);
  });

  it("rejects invalid currency", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.logTransfer(1, "ST3RECIP", "Notes", "LOC", "INVALID", "ST1TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CURRENCY);
  });

  it("rejects batch not owned", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.logTransfer(1, "ST3RECIP", "Notes", "LOC", "STX", "ST4FAKE");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_BATCH_NOT_OWNED);
  });

  it("rejects without authority contract", () => {
    const result = contract.logTransfer(1, "ST3RECIP", "Notes", "LOC", "STX", "ST1TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_TRANSFER_NOT_VERIFIED);
  });

  it("rejects max history exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.maxHistoryEntries = 0;
    const result = contract.logTransfer(1, "ST3RECIP", "Notes", "LOC", "STX", "ST1TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_HISTORY_EXCEEDED);
  });

  it("verifies a transfer successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.logTransfer(1, "ST3RECIP", "Notes", "LOC", "STX", "ST1TEST");
    const verifyResult = contract.verifyTransfer(0);
    expect(verifyResult.ok).toBe(true);
    expect(verifyResult.value).toBe(true);
    expect(contract.getTransferStatus(0)).toBe(false);
  });

  it("rejects verify for invalid status", () => {
    contract.setAuthorityContract("ST2TEST");
    const verifyResult = contract.verifyTransfer(999);
    expect(verifyResult.ok).toBe(false);
    expect(verifyResult.value).toBe(ERR_TRANSFER_STATUS_INVALID);
  });

  it("updates transfer status successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.caller = "ST2TEST";
    contract.logTransfer(1, "ST3RECIP", "Notes", "LOC", "STX", "ST2TEST");
    const updateResult = contract.updateTransferStatus(1, false);
    expect(updateResult.ok).toBe(true);
    expect(updateResult.value).toBe(true);
    const history = contract.getTransferHistory(1);
    expect(history?.[0]?.status).toBe(false);
  });

  it("rejects status update by non-authority", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.logTransfer(1, "ST3RECIP", "Notes", "LOC", "STX", "ST1TEST");
    const updateResult = contract.updateTransferStatus(1, false);
    expect(updateResult.ok).toBe(false);
    expect(updateResult.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("returns correct total log count", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.logTransfer(1, "ST3RECIP", "Notes", "LOC", "STX", "ST1TEST");
    contract.logTransfer(2, "ST4RECIP", "More notes", "LOC2", "USD", "ST1TEST");
    const result = contract.getTotalLogCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });

  it("checks transfer existence correctly", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.logTransfer(1, "ST3RECIP", "Notes", "LOC", "STX", "ST1TEST");
    let result = contract.checkTransferExistence(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    result = contract.checkTransferExistence(999);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(false);
  });

  it("batch logs transfers successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const batchIds = [1, 2, 3];
    const result = contract.batchLogTransfers(batchIds, "ST5BATCH", "Batch ship");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    expect(contract.getTransferHistory(1)?.length).toBe(1);
    expect(contract.getTransferHistory(2)?.length).toBe(1);
    expect(contract.getTransferHistory(3)?.length).toBe(1);
  });

  it("batch log rejects without authority", () => {
    const batchIds = [1, 2];
    const result = contract.batchLogTransfers(batchIds, "ST5BATCH", "Batch ship");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_TRANSFER_NOT_VERIFIED);
  });

  it("sets log fee successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setLogFee(1000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.logFee).toBe(1000);
    contract.logTransfer(1, "ST3RECIP", "Notes", "LOC", "STX", "ST1TEST");
    expect(contract.stxTransfers[0]?.amount).toBe(1000);
  });

  it("rejects log fee change without authority", () => {
    const result = contract.setLogFee(1000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("parses transfer parameters with Clarity types", () => {
    const notes = stringAsciiCV("Test notes");
    const batchId = uintCV(1);
    const to = principalCV("ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC");
    expect(notes.value).toBe("Test notes");
    expect(batchId.value).toEqual(BigInt(1));
    expect(to.value).toBe("ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC");
  });

  it("gets batch transfers count correctly", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.logTransfer(1, "ST3RECIP", "Notes", "LOC", "STX", "ST1TEST");
    contract.logTransfer(1, "ST4RECIP", "More", "LOC", "STX", "ST1TEST");
    expect(contract.getBatchTransfersCount(1)).toBe(2);
  });

  it("gets transfers by batch correctly", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.logTransfer(1, "ST3RECIP", "Notes", "LOC", "STX", "ST1TEST");
    contract.logTransfer(1, "ST4RECIP", "More", "LOC", "STX", "ST1TEST");
    const transfers = contract.getTransfersByBatch(1);
    expect(transfers?.length).toBe(2);
    expect(transfers?.[0]).toBe(0);
    expect(transfers?.[1]).toBe(1);
  });
});