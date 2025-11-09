import { describe, it, expect, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_ALREADY_REPORTED = 101;
const ERR_NOT_REPORTED = 102;
const ERR_INVALID_ISSUE = 103;
const ERR_INVALID_BATCH = 104;
const ERR_INVALID_SEVERITY = 108;

interface Report {
  "batch-id": bigint;
  issue: string;
  severity: bigint;
  reporter: string;
  timestamp: bigint;
  resolved: boolean;
  resolver: string | null;
  "resolve-timestamp": bigint | null;
  "evidence-uri": string | null;
}

class ContaminationReporterMock {
  state = {
    registry: "SP000000000000000000002Q6VF78" as string,
    nextReportId: 0,
    reports: new Map<number, Report>(),
    batchReports: new Map<number, number[]>(),
    affectedBatches: new Map<number, boolean>(),
  };
  blockHeight = 1000;
  sender = "ST1REPORTER";

  reset() {
    this.state = {
      registry: "SP000000000000000000002Q6VF78",
      nextReportId: 0,
      reports: new Map(),
      batchReports: new Map(),
      affectedBatches: new Map(),
    };
    this.blockHeight = 1000;
    this.sender = "ST1REPORTER";
  }

  setRegistry(newRegistry: string): { ok: boolean; value: boolean } {
    if (this.sender !== this.state.registry) return { ok: false, value: false };
    this.state.registry = newRegistry;
    return { ok: true, value: true };
  }

  reportContamination(
    batchId: number,
    issue: string,
    severity: number,
    evidenceUri: string | null
  ): { ok: boolean; value: number } {
    if (batchId <= 0) return { ok: false, value: ERR_INVALID_BATCH };
    if (!issue) return { ok: false, value: ERR_INVALID_ISSUE };
    if (severity < 1 || severity > 5) return { ok: false, value: ERR_INVALID_SEVERITY };
    if (this.state.affectedBatches.has(batchId)) return { ok: false, value: ERR_ALREADY_REPORTED };

    const id = this.state.nextReportId++;
    const report: Report = {
      "batch-id": BigInt(batchId),
      issue,
      severity: BigInt(severity),
      reporter: this.sender,
      timestamp: BigInt(this.blockHeight),
      resolved: false,
      resolver: null,
      "resolve-timestamp": null,
      "evidence-uri": evidenceUri,
    };
    this.state.reports.set(id, report);
    const list = this.state.batchReports.get(batchId) || [];
    list.push(id);
    this.state.batchReports.set(batchId, list);
    this.state.affectedBatches.set(batchId, true);
    return { ok: true, value: id };
  }

  resolveReport(reportId: number, evidenceUri: string | null): { ok: boolean; value: boolean } {
    const report = this.state.reports.get(reportId);
    if (!report) return { ok: false, value: false };
    if (report.resolved) return { ok: false, value: false };
    if (this.sender !== this.state.registry && this.sender !== report.reporter)
      return { ok: false, value: false };

    report.resolved = true;
    report.resolver = this.sender;
    report["resolve-timestamp"] = BigInt(this.blockHeight);
    report["evidence-uri"] = evidenceUri;

    const batchId = Number(report["batch-id"]);
    const open = (this.state.batchReports.get(batchId) || []).filter(
      id => !this.state.reports.get(id)!.resolved
    );
    if (open.length === 0) this.state.affectedBatches.delete(batchId);

    return { ok: true, value: true };
  }

  getReport(id: number): Report | null {
    return this.state.reports.get(id) || null;
  }

  isBatchAffected(batchId: number): boolean {
    return this.state.affectedBatches.get(batchId) ?? false;
  }
}

describe("contamination-reporter.clar", () => {
  let mock: ContaminationReporterMock;

  beforeEach(() => {
    mock = new ContaminationReporterMock();
    mock.reset();
  });

  it("reports contamination successfully", () => {
    const result = mock.reportContamination(42, "Listeria detected", 3, "ipfs://evidence123");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);

    const report = mock.getReport(0);
    expect(report?.issue).toBe("Listeria detected");
    expect(report?.severity).toBe(3n);
    expect(report?.reporter).toBe("ST1REPORTER");
    expect(mock.isBatchAffected(42)).toBe(true);
  });

  it("rejects duplicate report on same batch", () => {
    mock.reportContamination(100, "E.coli", 4, null);
    const result = mock.reportContamination(100, "Salmonella", 2, null);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_REPORTED);
  });

  it("rejects invalid batch id", () => {
    const result = mock.reportContamination(0, "Bad batch", 1, null);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_BATCH);
  });

  it("rejects empty issue", () => {
    const result = mock.reportContamination(55, "", 2, null);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ISSUE);
  });

  it("rejects invalid severity", () => {
    const result = mock.reportContamination(66, "Issue", 6, null);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_SEVERITY);
  });

  it("resolves report by reporter", () => {
    mock.reportContamination(77, "Contaminated", 5, null);
    const resolve = mock.resolveReport(0, "ipfs://resolved");
    expect(resolve.ok).toBe(true);
    const report = mock.getReport(0);
    expect(report?.resolved).toBe(true);
    expect(report?.resolver).toBe("ST1REPORTER");
  });

  it("resolves report by registry", () => {
    mock.reportContamination(88, "Issue", 1, null);
    mock.sender = mock.state.registry;
    const resolve = mock.resolveReport(0, null);
    expect(resolve.ok).toBe(true);
  });

  it("removes affected status when all reports resolved", () => {
    mock.reportContamination(99, "First", 2, null);
    mock.resolveReport(0, null);
    expect(mock.isBatchAffected(99)).toBe(false);
  });

  it("allows registry to change itself", () => {
    mock.sender = mock.state.registry;
    const result = mock.setRegistry("ST2NEWREGISTRY");
    expect(result.ok).toBe(true);
    expect(mock.state.registry).toBe("ST2NEWREGISTRY");
  });

  it("prevents non-registry from changing registry", () => {
    const result = mock.setRegistry("ST2FAKE");
    expect(result.ok).toBe(false);
  });
});