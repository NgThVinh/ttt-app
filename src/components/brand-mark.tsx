import Image from "next/image";

export default function BrandMark({ size = 48 }: { size?: number }) {
  return (
    <Image
      className="brand-mark"
      src="/icon.svg"
      alt="3T"
      width={size}
      height={size}
      unoptimized
    />
  );
}
