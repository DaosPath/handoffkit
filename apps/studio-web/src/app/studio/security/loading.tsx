export default function StudioSecurityLoading() {
  return (
    <main className="security-shell" aria-busy="true" aria-label="Loading runtime security data">
      <section className="security-loading-card">
        <span className="security-loading-line w-32" />
        <span className="security-loading-line h-10 w-3/4" />
        <span className="security-loading-line w-full" />
      </section>
      <p className="sr-only" role="status">Loading validated runtime security data.</p>
    </main>
  );
}
