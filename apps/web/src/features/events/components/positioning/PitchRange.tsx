import { sliderPercent } from '../../lib/positioning-display';

interface PitchRangeProps {
  id?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  ariaLabel: string;
  ariaValueText?: string;
}

const THUMB =
  '[&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:bg-stadium-ball [&::-webkit-slider-thumb]:bg-contain [&::-webkit-slider-thumb]:bg-center [&::-webkit-slider-thumb]:bg-no-repeat [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:bg-stadium-ball [&::-moz-range-thumb]:bg-contain [&::-moz-range-thumb]:bg-center [&::-moz-range-thumb]:bg-no-repeat [&::-moz-range-thumb]:shadow-md';

/**
 * The minutes slider of the mockup: a thick track, green up to the value, the ball as the thumb.
 * The native range input stays on top (keyboard, screen readers); its own track is transparent
 * and the fill underneath is an SVG bar sized by the value, so no inline style is needed.
 */
export default function PitchRange({
  id,
  min,
  max,
  step,
  value,
  onChange,
  disabled = false,
  ariaLabel,
  ariaValueText,
}: PitchRangeProps) {
  return (
    <div className={`relative flex h-7 items-center ${disabled ? 'opacity-40' : ''}`}>
      <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full">
        <svg
          aria-hidden="true"
          viewBox="0 0 100 1"
          preserveAspectRatio="none"
          className="block h-full w-full"
        >
          <rect width="100" height="1" className="fill-pitch-track" />
          <rect width={sliderPercent(value, min, max)} height="1" className="fill-pitch-leaf" />
        </svg>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-valuetext={ariaValueText}
        className={`relative h-7 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed ${THUMB}`}
      />
    </div>
  );
}
