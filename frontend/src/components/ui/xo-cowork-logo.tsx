interface XoCoworkLogoProps {
  size?: number;
  className?: string;
}

export function XoCoworkLogo({ size = 20, className }: XoCoworkLogoProps) {
  return (
    <img
      src="/favicon.svg"
      width={size}
      height={size}
      alt="XO Cowork"
      className={className}
    />
  );
}
