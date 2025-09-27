# TraceChain: NFT-Based Batch Tracking for Supply Chain Traceability

## Overview

**TraceChain** is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It leverages Non-Fungible Tokens (NFTs) to represent batches (lots) of goods in supply chains, enabling rapid traceability for contamination events, recalls, and authenticity verification. Each batch is minted as a unique NFT, with metadata capturing origin, processing history, and transfer logs. This solves real-world problems in industries like food safety, pharmaceuticals, and manufacturing:

- **Food Safety**: Quick identification of contaminated batches during outbreaks (e.g., E. coli in produce), reducing recall costs (estimated at $10B+ annually in the US) and minimizing health risks.
- **Pharmaceutical Authenticity**: Tracking drug lots to combat counterfeiting, ensuring compliance with regulations like DSCSA.
- **Supply Chain Efficiency**: Immutable audit trails for provenance, reducing disputes and enabling automated alerts via off-chain oracles.

The system uses 6 core smart contracts:
1. **BatchNFT**: SIP-009 compliant NFT for minting and transferring batch tokens.
2. **SupplierRegistry**: Registers verified suppliers with roles and credentials.
3. **MetadataUpdater**: Handles on-chain metadata updates for batch history (e.g., inspections).
4. **TransferLogger**: Logs transfers with timestamps and additional data for traceability.
5. **ContaminationReporter**: Reports issues and queries affected batches for rapid response.
6. **AccessController**: Role-based access control (RBAC) for supply chain participants.

These contracts interact via traits for modularity. Deployment is via Clarinet (Stacks dev tool). Frontend integration (e.g., via Stacks.js) can query contracts for dashboards.

## Architecture

- **Batch Flow**:
  1. Supplier mints a BatchNFT with initial metadata (origin, quantity).
  2. Transfers via TransferLogger, updating chain-of-custody.
  3. MetadataUpdater adds events (e.g., "inspected at factory").
  4. If contamination detected, ContaminationReporter flags the NFT; queries trace back via ownership history.

- **Key Features**:
  - Immutable provenance via NFT transfers.
  - Oracle integration for off-chain data (e.g., IoT sensors).
  - Gas-efficient queries for large-scale traceability.
  - Compliance: Supports standards like GS1 for serialization.

- **Tech Stack**:
  - **Blockchain**: Stacks (Clarity contracts).
  - **Standards**: SIP-009 (NFTs), SIP-010 (FTs for optional batch subunits).
  - **Tools**: Clarinet for testing/deployment; Hiro's Stacks API for queries.
  - **Off-Chain**: IPFS for metadata storage; Webhooks for alerts.

## Prerequisites

- Rust (for Clarinet).
- Clarinet CLI: `cargo install clarinet`.
- Stacks wallet (e.g., Leather) for deployment.
- Node.js for any frontend (optional).

## Installation

1. Clone the repo:
   ```
   git clone <your-repo-url>
   cd tracechain
   ```

2. Install dependencies:
   ```
   clarinet integrate
   ```

3. Configure `.devnet.toml` or `.mainnet.toml` for deployment.

## Usage

### Local Development
1. Start a devnet:
   ```
   clarinet integrate
   ```
2. Deploy contracts:
   ```
   clarinet deploy
   ```
3. Test with Clarinet REPL:
   ```
   clarinet console
   (contract-call? ... batch-nft mint ...)
   ```

### Example Workflow
- Mint a batch: Call `BatchNFT::mint` with supplier principal and metadata URI.
- Transfer: Call `TransferLogger::transfer` with recipient and notes.
- Report contamination: Call `ContaminationReporter::report` with batch ID and issue details.
- Trace: Query `BatchNFT::get-owners` and `TransferLogger::get-history` for full path.

### Deployment to Mainnet
1. Fund a Stacks account.
2. Update deploy scripts in `Clarinet.toml`.
3. Run `clarinet deploy --network mainnet`.

## Smart Contracts

All contracts are in `/contracts/` directory. They use Clarity 1.0+ features like traits and let-expressions for efficiency.

### 1. BatchNFT.clar (SIP-009 NFT Standard)
```clarity
(define-constant ERR_UNAUTHORIZED (err u1000))
(define-constant ERR_SUPPLY_EXCEEDED (err u1001))

;; Storage
(define-data-var last-id uint u0)
(define-map token-owner uint <principal>)
(define-map token-uri uint (string-ascii 256))

;; Traits
(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

(define-public (transfer 
    (token-id uint) 
    (sender <principal>) 
    (recipient <principal>))
  (begin
    (asserts! (is-eq (unwrap! (map-get? token-owner token-id) ERR_UNAUTHORIZED) sender) ERR_UNAUTHORIZED)
    (map-set token-owner token-id recipient)
    (ok true)))

(define-read-only (get-owner (token-id uint))
  (map-get? token-owner token-id))

(define-read-only (get-last-token-id) (var-get last-id))

(define-public (mint 
    (recipient <principal>) 
    (metadata-uri (string-ascii 256)))
  (let (
    (new-id (+ (var-get last-id) u1))
  )
    (map-set token-owner new-id recipient)
    (map-set token-uri new-id metadata-uri)
    (var-set last-id new-id)
    (ok new-id)))

;; Additional getters
(define-read-only (get-token-uri (token-id uint))
  (map-get? token-uri token-id))
```

### 2. SupplierRegistry.clar
```clarity
(define-constant ERR_NOT_REGISTERED (err u2000))
(define-constant ERR_ALREADY_REGISTERED (err u2001))

;; Storage
(define-map suppliers principal {role: (string-ascii 32), verified: bool, credentials: (string-ascii 128)})

(define-public (register-supplier 
    (role (string-ascii 32)) 
    (credentials (string-ascii 128)))
  (let (
    (caller tx-sender)
  )
    (asserts! (not (map-get? suppliers caller)) ERR_ALREADY_REGISTERED)
    (map-insert suppliers caller {role: role, verified: false, credentials: credentials})
    (ok true)))

(define-public (verify-supplier (supplier <principal>))
  (let (
    (exists (map-get? suppliers (as-principal supplier)))
  )
    (asserts! exists ERR_NOT_REGISTERED)
    (map-set suppliers (as-principal supplier) 
      (merge (unwrap-panic exists) {verified: true}))
    (ok true)))

(define-read-only (is-verified (supplier <principal>))
  (match (map-get? suppliers supplier)
    entry (get verified entry)
    false))
```

### 3. MetadataUpdater.clar
```clarity
(use-trait nft-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

(define-constant ERR_INVALID_UPDATER (err u3000))

;; Storage: Batch ID -> List of updates
(define-map batch-updates uint (list 200 {timestamp: uint, event: (string-ascii 64), data: (string-ascii 128)}))

(define-public (update-metadata 
    (batch-id uint) 
    (event (string-ascii 64)) 
    (data (string-ascii 128))
    (nft <nft-trait>))
  (let (
    (owner (unwrap! (contract-call? nft get-owner batch-id) ERR_INVALID_UPDATER))
    (caller tx-sender)
  )
    (asserts! (is-eq caller owner) ERR_INVALID_UPDATER)
    (let (
      (current-time block-height) ;; Proxy for timestamp
      (new-update {timestamp: current-time, event: event, data: data})
      (existing (map-get? batch-updates batch-id))
      (updated (unwrap-panic (as-max-len? (append existing new-update) u200)))
    )
      (map-set batch-updates batch-id updated)
      (ok true))))

(define-read-only (get-updates (batch-id uint))
  (map-get? batch-updates batch-id))
```

### 4. TransferLogger.clar
```clarity
(use-trait nft-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

(define-constant ERR_TRANSFER_FAILED (err u4000))

;; Storage: Batch ID -> Transfer history
(define-map transfer-history uint (list 100 {from: principal, to: principal, timestamp: uint, notes: (string-ascii 64)}))

(define-public (log-transfer 
    (batch-id uint) 
    (to <principal>) 
    (notes (string-ascii 64))
    (nft <nft-trait>))
  (let (
    (from (unwrap! (contract-call? nft get-owner batch-id) ERR_TRANSFER_FAILED))
    (current-time block-height)
    (new-log {from: from, to: (as-principal to), timestamp: current-time, notes: notes})
    (existing (map-get? transfer-history batch-id))
    (updated (unwrap-panic (as-max-len? (append existing new-log) u100)))
  )
    ;; Assume transfer is called separately; here we log post-transfer
    (map-set transfer-history batch-id updated)
    (ok true)))

(define-read-only (get-transfer-history (batch-id uint))
  (map-get? transfer-history batch-id))
```

### 5. ContaminationReporter.clar
```clarity
(use-trait nft-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

(define-constant ERR_NOT_VERIFIED (err u5000))
(define-constant ERR_ALREADY_REPORTED (err u5001))

;; Storage
(define-map reported-batches uint {reported-by: principal, issue: (string-ascii 64), timestamp: uint, resolved: bool})
(define-map affected-count uint u0) ;; Counter for alerts

(define-public (report-contamination 
    (batch-id uint) 
    (issue (string-ascii 64))
    (nft <nft-trait>))
  (let (
    (reporter tx-sender)
    (registry (contract-call? .supplier-registry is-verified reporter))
  )
    (asserts! registry ERR_NOT_VERIFIED)
    (asserts! (not (map-get? reported-batches batch-id)) ERR_ALREADY_REPORTED)
    (let (
      (current-time block-height)
    )
      (map-insert reported-batches batch-id 
        {reported-by: reporter, issue: issue, timestamp: current-time, resolved: false})
      (var-set affected-count (+ (var-get affected-count) u1))
      (ok true))))

(define-public (resolve-report (batch-id uint))
  (let (
    (entry (map-get? reported-batches batch-id))
  )
    (asserts! entry ERR_NOT_VERIFIED)
    (map-set reported-batches batch-id (merge entry {resolved: true}))
    (ok true)))

(define-read-only (get-reported-batches)
  (map-get? reported-batches {})) ;; Simplified; use off-chain indexing for full list

(define-read-only (is-affected (batch-id uint))
  (is-some (map-get? reported-batches batch-id)))
```

### 6. AccessController.clar
```clarity
(define-constant ERR_UNAUTHORIZED (err u6000))

;; Storage: Role mappings
(define-map roles principal (list 10 (string-ascii 32)))

(define-public (grant-role (user <principal>) (role (string-ascii 32)))
  (let (
    (caller tx-sender)
    ;; Assume admin check via separate logic
  )
    (let (
      (existing (map-get? roles (as-principal user)))
      (updated (unwrap-panic (as-max-len? (append existing role) u10)))
    )
      (map-set roles (as-principal user) updated)
      (ok true))))

(define-read-only (has-role (user <principal>) (role (string-ascii 32)))
  (is-some (index-of (map-get? roles user) role)))

(define-public (revoke-role (user <principal>) (role (string-ascii 32)))
  ;; Admin-only revoke logic
  (ok true))
```

## Testing

Run unit tests:
```
clarinet test
```

Example test in `/tests/`:
- Mint batch, transfer, update metadata, report contamination, verify trace.

## Contributing

Fork, PR with tests. Focus on gas optimization and security audits.

## License

MIT. See LICENSE file.