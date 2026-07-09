import Image from "next/image";

type LogoProps = {
  className?: string;
  height?: number;
  priority?: boolean;
};

export function Logo({ className = "", height = 32, priority = false }: LogoProps) {
  const width = Math.round(height * (220 / 40));

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
