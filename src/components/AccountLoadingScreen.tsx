export function AccountLoadingScreen() {
  return (
    <main className="account-loading-screen">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="page-grain" aria-hidden="true" />
      <div className="account-loading-content" role="status">
        <span className="account-loading-mark" aria-hidden="true">
          <svg viewBox="0 0 36 36">
            <path d="M18 3.7A14.3 14.3 0 1 1 3.7 18H17" />
          </svg>
        </span>
        <span className="account-loading-label">Loading your routine</span>
      </div>
    </main>
  )
}
