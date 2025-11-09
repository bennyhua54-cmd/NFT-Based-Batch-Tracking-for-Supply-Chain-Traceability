(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-ALREADY-REPORTED u101)
(define-constant ERR-NOT-REPORTED u102)
(define-constant ERR-INVALID-ISSUE u103)
(define-constant ERR-INVALID-BATCH u104)
(define-constant ERR-NOT-RESOLVED u105)
(define-constant ERR-ALREADY-RESOLVED u106)
(define-constant ERR-NOT-REGISTRY u107)
(define-constant ERR-INVALID-SEVERITY u108)
(define-constant ERR-INVALID-EVIDENCE u109)

(define-data-var reporter-registry principal 'SP000000000000000000002Q6VF78)
(define-data-var next-report-id uint u0)

(define-map reports
  uint
  {
    batch-id: uint,
    issue: (string-ascii 256),
    severity: uint,
    reporter: principal,
    timestamp: uint,
    resolved: bool,
    resolver: (optional principal),
    resolve-timestamp: (optional uint),
    evidence-uri: (optional (string-ascii 512))
  }
)

(define-map batch-reports uint (list 500 uint))
(define-map affected-batches uint bool)

(define-read-only (get-report (report-id uint))
  (map-get? reports report-id)
)

(define-read-only (get-batch-reports (batch-id uint))
  (map-get? batch-reports batch-id)
)

(define-read-only (is-batch-affected (batch-id uint))
  (map-get? affected-batches batch-id)
)

(define-read-only (get-next-report-id)
  (var-get next-report-id)
)

(define-private (is-registry)
  (is-eq tx-sender (var-get reporter-registry))
)

(define-public (set-registry (new-registry principal))
  (begin
    (asserts! (is-registry) (err ERR-NOT-AUTHORIZED))
    (var-set reporter-registry new-registry)
    (ok true)
  )
)

(define-public (report-contamination
    (batch-id uint)
    (issue (string-ascii 256))
    (severity uint)
    (evidence-uri (optional (string-ascii 512)))
  )
  (let (
    (report-id (var-get next-report-id))
    (current-reports (default-to (list) (map-get? batch-reports batch-id)))
    (caller tx-sender)
  )
    (asserts! (> batch-id u0) (err ERR-INVALID-BATCH))
    (asserts! (> (len issue) u0) (err ERR-INVALID-ISSUE))
    (asserts! (and (>= severity u1) (<= severity u5)) (err ERR-INVALID-SEVERITY))
    (asserts! (is-none (map-get? affected-batches batch-id)) (err ERR-ALREADY-REPORTED))
    (map-set reports report-id
      {
        batch-id: batch-id,
        issue: issue,
        severity: severity,
        reporter: caller,
        timestamp: block-height,
        resolved: false,
        resolver: none,
        resolve-timestamp: none,
        evidence-uri: evidence-uri
      }
    )
    (map-set batch-reports batch-id (append current-reports report-id))
    (map-set affected-batches batch-id true)
    (var-set next-report-id (+ report-id u1))
    (print {event: "contamination-reported", report-id: report-id, batch-id: batch-id})
    (ok report-id)
  )
)

(define-public (resolve-report
    (report-id uint)
    (evidence-uri (optional (string-ascii 512)))
  )
  (let (
    (report (unwrap! (map-get? reports report-id) (err ERR-NOT-REPORTED)))
    (batch-id (get batch-id report))
  )
    (asserts! (not (get resolved report)) (err ERR-ALREADY-RESOLVED))
    (asserts! (or (is-registry) (is-eq tx-sender (get reporter report))) (err ERR-NOT-AUTHORIZED))
    (map-set reports report-id
      (merge report
        {
          resolved: true,
          resolver: (some tx-sender),
          resolve-timestamp: (some block-height),
          evidence-uri: evidence-uri
        }
      )
    )
    (let ((open-reports (filter is-unresolved (default-to (list) (map-get? batch-reports batch-id)))))
      (if (is-eq (len open-reports) u0)
          (map-delete affected-batches batch-id)
          true
      )
    )
    (print {event: "contamination-resolved", report-id: report-id})
    (ok true)
  )
)

(define-public (update-issue
    (report-id uint)
    (new-issue (string-ascii 256))
    (new-severity uint)
  )
  (let (
    (report (unwrap! (map-get? reports report-id) (err ERR-NOT-REPORTED)))
  )
    (asserts! (not (get resolved report)) (err ERR-NOT-RESOLVED))
    (asserts! (is-eq tx-sender (get reporter report)) (err ERR-NOT-AUTHORIZED))
    (asserts! (> (len new-issue) u0) (err ERR-INVALID-ISSUE))
    (asserts! (and (>= new-severity u1) (<= new-severity u5)) (err ERR-INVALID-SEVERITY))
    (map-set reports report-id
      (merge report
        {issue: new-issue, severity: new-severity}
      )
    )
    (ok true)
  )
)

(define-private (is-unresolved (report-id uint))
  (match (map-get? reports report-id)
    r (not (get resolved r))
    true
  )
)

(define-read-only (get-affected-batch-count)
  (fold + (map (lambda (x) (if x u1 u0)) (map (lambda (k) (map-get? affected-batches k)) (map-keys affected-batches))) u0)
)

(define-read-only (get-reports-by-severity (severity uint))
  (filter (lambda (rid) (match (map-get? reports rid) r (and (is-eq (get severity r) severity) (not (get resolved r))) false)) (map-keys reports))
)