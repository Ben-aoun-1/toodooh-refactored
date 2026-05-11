import React from 'react';
import {
  motion,
  useAnimation,
  useCycle,
  useMotionValue,
  useTransform,
  animate,
  easeInOut,
} from 'framer-motion';

// Logo SVG inspiré du logo en haut à gauche de l'image fournie
// Les crochets sont animés (ouverture/fermeture)

export default function AnimatedLogo({
  size = 80,
  loop = true,
}: {
  size?: number;
  loop?: boolean;
}) {
  // Animation des crochets (gauche/haut et droite/bas)
  const bracketVariants = {
    closed: {
      pathLength: 0.7,
      opacity: 1,
    },
    open: {
      pathLength: 1,
      opacity: 1,
      transition: { duration: 0.6, ease: easeInOut },
    },
  };

  return (
    <motion.svg
      width={size}
      height={size / 3}
      viewBox="0 0 280 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      initial="closed"
      animate={loop ? 'open' : 'closed'}
      whileHover="open"
      transition={{ repeat: loop ? Infinity : 0, repeatType: 'reverse', duration: 1.2 }}
      style={{ display: 'block' }}
    >
      {/* Crochet gauche - plus large pour englober le texte */}
      <motion.path
        d="M20 25 V8 H120"
        stroke="#00B3A6"
        strokeWidth={6}
        strokeLinecap="round"
        variants={bracketVariants}
      />
      {/* Texte toodooh en minuscules, police Poppins, centré dans les crochets */}
      <text
        x="140"
        y="55"
        fontFamily="'Poppins', Arial, sans-serif"
        fontWeight="600"
        fontSize="32"
        fill="#333333"
        letterSpacing="4"
        textAnchor="middle"
        style={{ textTransform: 'lowercase' }}
      >
        toodooh
      </text>
      {/* Crochet droit - plus large pour englober le texte */}
      <motion.path
        d="M260 55 V72 H160"
        stroke="#00B3A6"
        strokeWidth={6}
        strokeLinecap="round"
        variants={bracketVariants}
      />
    </motion.svg>
  );
}
