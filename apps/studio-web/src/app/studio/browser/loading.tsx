export default function StudioBrowserLoading() {
  return (
    <main className="security-shell" aria-busy="true" aria-label="Loading browser inspector">
      <section className="security-loading-card">
        <span className="security-loading-line w-32" />
        <span className="security-loading-line h-10 w-3/4" />
        <span className="security-loading-line w-full" />
      </section>
      <p className="sr-only" role="status">Loading validated browser runtime events.</p>
    </main>
  );
}
