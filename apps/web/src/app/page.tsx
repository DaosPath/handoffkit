import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { TrustStrip } from "@/components/TrustStrip";
import { Features } from "@/components/Features";
import { UseCases } from "@/components/UseCases";
import { CodeExample } from "@/components/CodeExample";
import { CTA } from "@/components/CTA";
import { Footer } from "@/components/Footer";
import { MotionProvider } from "@/components/MotionProvider";

export default function HomePage() {
  return (
    <MotionProvider>
      <main className="relative min-h-screen">
        <Navbar />
        <Hero />
        <TrustStrip />
        <Features />
        <UseCases />
        <CodeExample />
        <CTA />
        <Footer />
      </main>
    </MotionProvider>
  );
}
