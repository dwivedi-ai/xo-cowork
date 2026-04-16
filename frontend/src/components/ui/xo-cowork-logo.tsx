import Image from "next/image";

interface XoCoworkLogoProps {
  size?: number;
  className?: string;
}

export function XoCoworkLogo({ size = 20, className }: XoCoworkLogoProps) {
  return (
    <Image
      src="/favicon.svg"
      width={size}
      height={size}
      alt="XO-Cowork"
      className={className}
      // SVGs are not optimized by next/image loader; serve as-is.
      unoptimized
      priority
    />
  );
}
