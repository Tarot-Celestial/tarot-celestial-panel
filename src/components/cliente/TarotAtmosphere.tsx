import type { CSSProperties, ReactNode } from "react";
import styles from "./TarotAtmosphere.module.css";

function ZodiacMark({ rotation, children }: { rotation: number; children: ReactNode }) {
  return <g transform={`rotate(${rotation} 500 500)`} className={styles.zodiacMark}>
    <g transform="translate(500 90)">{children}</g>
  </g>;
}

function CompassStar({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${size})`}>
    <path d="M0-13 3-3 13 0 3 3 0 13-3 3-13 0-3-3Z" />
    <circle r="2" />
  </g>;
}

/** Decorative atmosphere only: no clocks, random values, images or event work. */
export default function TarotAtmosphere({ index }: { index: number }) {
  const destination = Number.isFinite(index) ? Math.max(0, Math.min(11, Math.trunc(index))) : 0;
  return <div className={styles.atmosphere} aria-hidden="true" style={{ "--zodiac-offset": `${destination * 30}deg` } as CSSProperties}>
    <div className={styles.wheelPosition}>
      <div className={styles.wheelDestination}>
        <svg className={styles.wheel} viewBox="0 0 1000 1000" fill="none" focusable="false">
          <g className={styles.outerRings}>
            <circle cx="500" cy="500" r="453" />
            <circle cx="500" cy="500" r="447" />
            <circle cx="500" cy="500" r="377" />
            <circle cx="500" cy="500" r="369" />
            <circle cx="500" cy="500" r="433" strokeDasharray="1 21.67" />
            <path d="M500 47V123M726.5 107.7 688.5 173.5M892.3 273.5 826.5 311.5M953 500H877M892.3 726.5 826.5 688.5M726.5 892.3 688.5 826.5M500 953V877M273.5 892.3 311.5 826.5M107.7 726.5 173.5 688.5M47 500H123M107.7 273.5 173.5 311.5M273.5 107.7 311.5 173.5" />
          </g>
          <g className={styles.zodiacSigns}>
            <ZodiacMark rotation={15}><path d="M0 14V-2C0-17-17-18-17-7C-17 1-10 4-6 1M0-2C0-17 17-18 17-7C17 1 10 4 6 1" /></ZodiacMark>
            <ZodiacMark rotation={45}><circle cy="5" r="10" /><path d="M-17-17C-17-4-8-4 0-5C8-4 17-4 17-17" /></ZodiacMark>
            <ZodiacMark rotation={75}><path d="M-15-17Q0-12 15-17M-15 17Q0 12 15 17M-9-15V15M9-15V15" /></ZodiacMark>
            <ZodiacMark rotation={105}><circle cx="-10" cy="-6" r="6" /><circle cx="10" cy="6" r="6" /><path d="M-16-7C-10-21 13-19 18-9M16 7C10 21-13 19-18 9" /></ZodiacMark>
            <ZodiacMark rotation={135}><circle cx="-11" cy="5" r="6" /><path d="M-7 0C-21-17 8-25 11-10C14 0 0 9 4 17C6 21 14 20 18 14" /></ZodiacMark>
            <ZodiacMark rotation={165}><path d="M-17 13V-13Q-9-21-8-9V13M-8-9Q0-21 2-9V13M2-9Q14-20 15-7C16 5 9 15 2 18M8 0Q20 9 20 18" /></ZodiacMark>
            <ZodiacMark rotation={195}><path d="M-19 14H19M-19 5H-7C-22-12 22-12 7 5H19" /></ZodiacMark>
            <ZodiacMark rotation={225}><path d="M-18 14V-13Q-9-21-8-9V14M-8-9Q1-21 2-9V8Q2 18 16 14L22 8M14 8H22V16" /></ZodiacMark>
            <ZodiacMark rotation={255}><path d="M-15 16 16-15M1-16H17V0M-14-2 2 14" /></ZodiacMark>
            <ZodiacMark rotation={285}><path d="M-19-11-12 11-5-11Q0-17 3-8V10C3 25 23 17 17 7C13 0 4 7 0 12" /></ZodiacMark>
            <ZodiacMark rotation={315}><path d="M-20-7-10-13 0-7 10-13 20-7M-20 8-10 2 0 8 10 2 20 8" /></ZodiacMark>
            <ZodiacMark rotation={345}><path d="M-12-18C0-8 0 8-12 18M12-18C0-8 0 8 12 18M-17 0H17" /></ZodiacMark>
          </g>
          <g className={styles.sacredGeometry}>
            <circle cx="500" cy="500" r="282" />
            <path d="M500 218 744.2 641 255.8 641ZM500 782 255.8 359 744.2 359Z" />
            <path d="M500 218 782 500 500 782 218 500Z" />
            <circle cx="500" cy="500" r="141" />
            <path d="M359 500H641M500 359V641" />
          </g>
          <g className={styles.wheelStars}>
            <CompassStar x={500} y={43} size={0.7} />
            <CompassStar x={957} y={500} size={0.7} />
            <CompassStar x={500} y={957} size={0.7} />
            <CompassStar x={43} y={500} size={0.7} />
            <CompassStar x={500} y={500} size={1.4} />
          </g>
        </svg>
      </div>
    </div>

    <svg className={`${styles.constellation} ${styles.constellationLeft}`} viewBox="0 0 220 410" fill="none" focusable="false">
      <path className={styles.constellationLine} d="M26 61 82 31 157 98 123 177 190 236 133 331 175 383M82 31 59 131 123 177M26 61 59 131" />
      <g className={styles.constellationPoints}>
        <circle cx="26" cy="61" r="2.3" /><circle cx="82" cy="31" r="3.1" /><circle cx="157" cy="98" r="2.4" />
        <circle cx="59" cy="131" r="1.8" /><circle cx="123" cy="177" r="2.8" /><circle cx="190" cy="236" r="2.1" />
        <circle cx="133" cy="331" r="2.5" /><circle cx="175" cy="383" r="1.8" />
      </g>
      <g className={styles.constellationStars}><CompassStar x={123} y={177} size={0.6} /><CompassStar x={26} y={61} size={0.35} /></g>
    </svg>
    <svg className={`${styles.constellation} ${styles.constellationRight}`} viewBox="0 0 220 330" fill="none" focusable="false">
      <path className={styles.constellationLine} d="M190 28 126 71 162 143 75 186 111 262 29 303M126 71 40 93 75 186" />
      <g className={styles.constellationPoints}>
        <circle cx="190" cy="28" r="2" /><circle cx="126" cy="71" r="3" /><circle cx="162" cy="143" r="2" />
        <circle cx="40" cy="93" r="1.9" /><circle cx="75" cy="186" r="3.2" /><circle cx="111" cy="262" r="2.1" /><circle cx="29" cy="303" r="1.8" />
      </g>
      <g className={styles.constellationStars}><CompassStar x={75} y={186} size={0.6} /></g>
    </svg>

    <div className={`${styles.orb} ${styles.orbViolet}`}><span /></div>
    <div className={`${styles.orb} ${styles.orbGold}`}><span /></div>
    <div className={`${styles.orb} ${styles.orbCelestial}`}><span /></div>

    <svg className={styles.tarotCards} viewBox="0 0 150 200" fill="none" focusable="false">
      <g transform="rotate(-13 75 100)" className={styles.cardBack}>
        <rect x="36" y="25" width="83" height="145" rx="8" /><rect x="42" y="31" width="71" height="133" rx="4" />
        <path d="M77.5 46 99 97.5 77.5 149 56 97.5Z" />
      </g>
      <g transform="rotate(8 75 100)" className={styles.cardFront}>
        <rect x="24" y="23" width="83" height="145" rx="8" /><rect x="30" y="29" width="71" height="133" rx="4" />
        <path d="M66 55C42 57 39 92 62 101C78 107 94 96 95 83C80 94 56 81 66 55Z" />
        <CompassStar x={82} y={56} size={0.38} /><CompassStar x={47} y={115} size={0.27} />
        <path d="M48 141H83M58 146H73" />
      </g>
    </svg>
  </div>;
}
