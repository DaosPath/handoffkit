import Image from "next/image";

type LogoProps = {
  className?: string;
  height?: number;
  priority?: boolean;
  /** Append “Studio” in light blue (Handoff Kit Studio) */
  studio?: boolean;
};

export function Logo({
  className = "",
  height = 32,
  priority = false,
  studio = false,
}: LogoProps) {
  const width = Math.round(height * (220 / 40));

  if (studio) {
    return (
      <span className={`inline-flex items-center gap-1.5 ${className}`}>
        <Image
          src="/logo.svg"
          alt="Handoff Kit"
          width={width}
          height={height}
          priority={priority}
        />
        <span
          className="font-semibold tracking-tight text-[#60A5FA]"
          style={{ fontSize: Math.max(13, height * 0.52) }}
        >
          Studio
        </span>
      </span>
    );
  }

  return (
    <Image
      src="/logo.svg"
      alt="Handoff Kit"
      width={width}
      height={height}
      priority={priority}
      className={className}
    />
  );
}
