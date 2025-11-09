(use-trait nft-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant ERR-INVALID-BATCH-ID (err u101))
(define-constant ERR-TRANSFER-FAILED (err u102))
(define-constant ERR-HISTORY-FULL (err u103))
(define-constant ERR-INVALID-NOTES (err u104))
(define-constant ERR-BATCH-NOT-OWNED (err u105))
(define-constant ERR-TRANSFER-NOT-VERIFIED (err u106))
(define-constant ERR-MAX-HISTORY-EXCEEDED (err u107))
(define-constant ERR-INVALID-TIMESTAMP (err u108))
(define-constant ERR-ROLE-NOT-VERIFIED (err u109))
(define-constant ERR-DUPLICATE-TRANSFER (err u110))
(define-constant ERR-INVALID-LOCATION (err u111))
(define-constant ERR-INVALID-CURRENCY (err u112))
(define-constant ERR-TRANSFER-STATUS-INVALID (err u113))

(define-data-var max-history-entries uint u100)
(define-data-var authority-contract (optional principal) none)
(define-data-var log-fee uint u500)
(define-data-var next-log-id uint u0)

(define-map transfer-history 
  uint 
  (list 200 
    { 
      id: uint, 
      from: principal, 
      to: principal, 
      timestamp: uint, 
      notes: (string-ascii 128), 
      location: (string-ascii 64), 
      currency: (string-ascii 8), 
      status: bool, 
      verified: bool 
    } 
  )
)

(define-map batch-transfers-count uint uint)
(define-map transfers-by-batch uint (list 50 uint))
(define-map transfer-status uint bool)

(define-read-only (get-transfer-history (batch-id uint))
  (map-get? transfer-history batch-id)
)

(define-read-only (get-batch-transfers-count (batch-id uint))
  (map-get? batch-transfers-count batch-id)
)

(define-read-only (get-transfers-by-batch (batch-id uint))
  (map-get? transfers-by-batch batch-id)
)

(define-read-only (get-transfer-status (transfer-id uint))
  (map-get? transfer-status transfer-id)
)

(define-read-only (is-batch-registered (batch-id uint))
  (is-some (map-get? transfer-history batch-id))
)

(define-private (validate-batch-id (id uint))
  (if (> id u0)
      (ok true)
      (err ERR-INVALID-BATCH-ID))
)

(define-private (validate-notes (notes (string-ascii 128)))
  (if (and (> (len notes) u0) (<= (len notes) u128))
      (ok true)
      (err ERR-INVALID-NOTES))
)

(define-private (validate-location (loc (string-ascii 64)))
  (if (and (> (len loc) u0) (<= (len loc) u64))
      (ok true)
      (err ERR-INVALID-LOCATION))
)

(define-private (validate-currency (cur (string-ascii 8)))
  (if (or (is-eq cur "STX") (is-eq cur "USD") (is-eq cur "BTC"))
      (ok true)
      (err ERR-INVALID-CURRENCY))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-principal (p principal))
  (if (not (is-eq p tx-sender))
      (ok true)
      (err ERR-NOT-AUTHORIZED))
)

(define-private (validate-role (role principal))
  (if (is-some (var-get authority-contract))
      (ok true)
      (err ERR-ROLE-NOT-VERIFIED))
)

(define-private (validate-transfer-ownership (batch-id uint) (nft <nft-trait>))
  (let (
        (owner (unwrap! (contract-call? nft get-owner batch-id) ERR-BATCH-NOT-OWNED))
      )
    (if (is-eq owner tx-sender)
        (ok true)
        (err ERR-NOT-AUTHORIZED))
  )
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-principal contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-TRANSFER-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-history-entries (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-INVALID-BATCH-ID))
    (asserts! (is-some (var-get authority-contract)) (err ERR-ROLE-NOT-VERIFIED))
    (var-set max-history-entries new-max)
    (ok true)
  )
)

(define-public (set-log-fee (new-fee uint))
  (begin
    (asserts! (>= new-fee u0) (err ERR-INVALID-BATCH-ID))
    (asserts! (is-some (var-get authority-contract)) (err ERR-ROLE-NOT-VERIFIED))
    (var-set log-fee new-fee)
    (ok true)
  )
)

(define-public (log-transfer 
  (batch-id uint) 
  (to principal) 
  (notes (string-ascii 128))
  (location (string-ascii 64))
  (currency (string-ascii 8))
  (nft <nft-trait>)
)
  (let (
        (next-id (var-get next-log-id))
        (authority (var-get authority-contract))
        (current-time block-height)
        (count (default-to u0 (map-get? batch-transfers-count batch-id)))
      )
    (try! (validate-batch-id batch-id))
    (try! (validate-notes notes))
    (try! (validate-location location))
    (try! (validate-currency currency))
    (try! (validate-timestamp current-time))
    (try! (validate-transfer-ownership batch-id nft))
    (asserts! (< count (var-get max-history-entries)) (err ERR-MAX-HISTORY-EXCEEDED))
    (asserts! (is-some (var-get authority-contract)) (err ERR-TRANSFER-NOT-VERIFIED))
    (let (
          (authority-recipient (unwrap! authority (err ERR-ROLE-NOT-VERIFIED)))
          (new-log { 
                    id: next-id, 
                    from: tx-sender, 
                    to: to, 
                    timestamp: current-time, 
                    notes: notes, 
                    location: location, 
                    currency: currency, 
                    status: true, 
                    verified: false 
                  })
          (existing (default-to (list ) (map-get? transfer-history batch-id)))
          (updated (unwrap-panic (as-max-len? (append existing new-log) u200)))
          (batch-transfers (default-to (list ) (map-get? transfers-by-batch batch-id)))
          (new-batch-transfers (unwrap-panic (as-max-len? (append batch-transfers next-id) u50)))
        )
      (try! (stx-transfer? (var-get log-fee) tx-sender authority-recipient))
      (map-set transfer-history batch-id updated)
      (map-set batch-transfers-count batch-id (+ count u1))
      (map-set transfers-by-batch batch-id new-batch-transfers)
      (map-insert transfer-status next-id true)
      (var-set next-log-id (+ next-id u1))
      (print { event: "transfer-logged", batch-id: batch-id, log-id: next-id })
      (ok next-id)
    )
  )
)

(define-public (verify-transfer (transfer-id uint))
  (let (
        (status (map-get? transfer-status transfer-id))
      )
    (asserts! (unwrap! status (err ERR-TRANSFER-STATUS-INVALID)) (err ERR-TRANSFER-FAILED))
    (asserts! (is-some (var-get authority-contract)) (err ERR-ROLE-NOT-VERIFIED))
    (map-set transfer-status transfer-id false)
    (ok true)
  )
)

(define-public (update-transfer-status (batch-id uint) (status bool))
  (let (
        (history (map-get? transfer-history batch-id))
      )
    (match history
      h
        (begin
          (asserts! (is-eq tx-sender (unwrap! (var-get authority-contract) (err u0))) (err ERR-NOT-AUTHORIZED))
          (map-set transfer-history batch-id
            (fold
              (lambda (entry new-h)
                (let (
                      (updated-entry (merge entry { status: status }))
                    )
                  (unwrap-panic (as-max-len? (append new-h updated-entry) u200))
                )
              )
              h
              (list )
            )
          )
          (ok true)
        )
      (err ERR-INVALID-BATCH-ID)
    )
  )
)

(define-public (get-total-log-count)
  (ok (var-get next-log-id))
)

(define-public (check-transfer-existence (batch-id uint))
  (ok (is-batch-registered batch-id))
)

(define-public (batch-log-transfers (batch-ids (list 10 uint)) (to principal) (notes (string-ascii 128)))
  (let (
        (authority (var-get authority-contract))
      )
    (asserts! (is-some authority) (err ERR-TRANSFER-NOT-VERIFIED))
    (fold
      (lambda (id result)
        (match result
          ok-res
            (begin
              (try! (log-transfer id to notes "" "STX" .batch-nft))
              ok-res
            )
          err-res (err-res)
        )
      )
      batch-ids
      (ok u0)
    )
  )
)