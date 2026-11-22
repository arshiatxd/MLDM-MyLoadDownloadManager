interface MyLoadLogoProps {
  className?: string;
  size?: number;
}

export function MyLoadLogo({ className = 'h-6 w-6 shrink-0', size }: MyLoadLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect x="4" y="4" width="56" height="56" rx="14" fill="#d91b36" />
      <path
        d="M 14.5 17 V 35 M 14.5 22.75 A 5.75 5.75 0 0 1 26 22.75 V 35 M 26 22.75 A 5.75 5.75 0 0 1 37.5 22.75 V 44.5 H 47.5"
        stroke="#FFFFFF"
        strokeWidth="5.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 45.5 39.2 L 53.8 44.5 L 45.5 49.8 Z"
        fill="#FFFFFF"
        stroke="#FFFFFF"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

