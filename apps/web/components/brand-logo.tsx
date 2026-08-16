import { FIAO_BRAND } from "@/lib/branding";

/**
 * Marca FIAO oficial: símbolo "F" orgánico + wordmark con la "A" sin
 * travesaño y su pastilla lima bajo el vértice. Trazo monolinear,
 * terminaciones redondeadas, flat 2D (sin gradientes ni sombras).
 */
export function BrandLogo({
  size = 48,
  showWordmark = true,
  className
}: {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}) {
  const primary = FIAO_BRAND.colors.primary;
  const accent = FIAO_BRAND.colors.accent;
  return (
    <svg
      viewBox="0 0 220 64"
      width={size}
      height={(size * 64) / 220}
      role="img"
      aria-label={FIAO_BRAND.name}
      className={className}
      fill="none"
    >
      {/* Símbolo F: tallo curvo a la izquierda en la base */}
      <path
        d="M20 6 C20 32 20 46 8 54"
        stroke={primary}
        strokeWidth="9"
        strokeLinecap="round"
      />
      {/* Brazo superior con caída a la derecha */}
      <path
        d="M20 14 L44 14 C52 14 55 19 55 27"
        stroke={primary}
        strokeWidth="9"
        strokeLinecap="round"
      />
      {/* Brazo medio */}
      <path
        d="M20 31 L38 31"
        stroke={primary}
        strokeWidth="9"
        strokeLinecap="round"
      />
      {/* Pastillas lima en el contador inferior del símbolo */}
      <rect x="20" y="40" width="11" height="5.5" rx="2.75" fill={accent} />
      <rect x="20" y="48.5" width="11" height="5.5" rx="2.75" fill={accent} />

      {showWordmark ? (
        <g stroke={primary} strokeWidth="8" strokeLinecap="round">
          {/* F */}
          <path d="M78 10 L78 54" />
          <path d="M78 17 L99 17" />
          <path d="M78 32 L94 32" />
          {/* I */}
          <path d="M113 10 L113 54" />
          {/* A sin travesaño */}
          <path d="M129 54 L143 10 L157 54" strokeLinejoin="round" />
          {/* O circular */}
          <circle cx="177" cy="32" r="21" />
        </g>
      ) : null}
      {showWordmark ? (
        <rect x="136" y="22" width="14" height="5.5" rx="2.75" fill={accent} />
      ) : null}
    </svg>
  );
}
