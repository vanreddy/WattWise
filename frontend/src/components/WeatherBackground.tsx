"use client";

import type { WeatherCondition, TimeOfDay } from "@/hooks/useWeather";

interface Props {
  condition: WeatherCondition;
  timeOfDay: TimeOfDay;
  temperature: number;
}

// Gradient palettes inspired by Apple Weather
function getGradient(condition: WeatherCondition, tod: TimeOfDay): string {
  const gradients: Record<string, string> = {
    // Clear
    "clear_day": "linear-gradient(180deg, #1a8fe3 0%, #47b4f5 30%, #89cff7 60%, #f5d78e 100%)",
    "clear_dawn": "linear-gradient(180deg, #2c3e6b 0%, #c06c84 35%, #f8b195 65%, #ffecd2 100%)",
    "clear_dusk": "linear-gradient(180deg, #1a1a4e 0%, #6b2fa0 25%, #d94f76 55%, #f5a623 85%, #ffd97d 100%)",
    "clear_night": "linear-gradient(180deg, #0a0e27 0%, #131842 40%, #1a2456 70%, #1e3060 100%)",
    // Partly cloudy
    "partly_cloudy_day": "linear-gradient(180deg, #4a90c4 0%, #7ab5d6 35%, #a8cee0 65%, #d4e5ed 100%)",
    "partly_cloudy_dawn": "linear-gradient(180deg, #3d3b5e 0%, #9e7bb5 35%, #d4a5a5 65%, #ede0d0 100%)",
    "partly_cloudy_dusk": "linear-gradient(180deg, #2a2250 0%, #7b4d8e 35%, #c47a6c 65%, #e8c47a 100%)",
    "partly_cloudy_night": "linear-gradient(180deg, #101628 0%, #1c2340 40%, #273252 70%, #2e3d5e 100%)",
    // Cloudy
    "cloudy_day": "linear-gradient(180deg, #6b7d8e 0%, #8a9bab 35%, #a8b5c0 60%, #c4cdd4 100%)",
    "cloudy_dawn": "linear-gradient(180deg, #4a4558 0%, #7e7387 40%, #a89da8 70%, #c8bfc4 100%)",
    "cloudy_dusk": "linear-gradient(180deg, #3a3450 0%, #6b5e78 40%, #8e7f90 70%, #b0a5ab 100%)",
    "cloudy_night": "linear-gradient(180deg, #15192a 0%, #1e2438 40%, #2a3148 70%, #353e54 100%)",
    // Fog
    "fog_day": "linear-gradient(180deg, #8a9bab 0%, #a8b8c6 35%, #c4cfd8 65%, #dde4e9 100%)",
    "fog_dawn": "linear-gradient(180deg, #5a5566 0%, #8a8090 40%, #b0a8b0 70%, #cec7cb 100%)",
    "fog_dusk": "linear-gradient(180deg, #4a4460 0%, #706680 40%, #968e9e 70%, #b8b0b8 100%)",
    "fog_night": "linear-gradient(180deg, #161820 0%, #1f2230 40%, #2a2e3e 70%, #383c4c 100%)",
    // Rain
    "rain_day": "linear-gradient(180deg, #3a5068 0%, #4a6578 35%, #5a7888 65%, #6e8e9e 100%)",
    "rain_dawn": "linear-gradient(180deg, #2a2a40 0%, #4a4460 40%, #6a6080 70%, #8a7ea0 100%)",
    "rain_dusk": "linear-gradient(180deg, #1e1e38 0%, #3a3558 40%, #564e72 65%, #706888 100%)",
    "rain_night": "linear-gradient(180deg, #0a0e1a 0%, #141828 40%, #1e2438 70%, #283048 100%)",
    // Snow
    "snow_day": "linear-gradient(180deg, #8ca8c0 0%, #a8c0d4 35%, #c4d8e8 65%, #e0ecf4 100%)",
    "snow_night": "linear-gradient(180deg, #141828 0%, #1e2840 40%, #2a3858 70%, #384868 100%)",
    // Thunderstorm
    "thunderstorm_day": "linear-gradient(180deg, #1a2030 0%, #2a3548 35%, #3a4a60 65%, #4a5e74 100%)",
    "thunderstorm_night": "linear-gradient(180deg, #080a14 0%, #101420 40%, #1a2030 70%, #222c3e 100%)",
  };

  const key = `${condition}_${tod}`;
  return gradients[key] || gradients[`${condition}_day`] || gradients["clear_day"];
}

// Sun rays for clear/partly cloudy day
function SunElement({ tod }: { tod: TimeOfDay }) {
  if (tod === "night") return null;

  const isDawn = tod === "dawn";
  const isDusk = tod === "dusk";
  const top = isDawn || isDusk ? "65%" : "8%";
  const right = isDusk ? "15%" : isDawn ? "auto" : "18%";
  const left = isDawn ? "15%" : "auto";
  const size = isDawn || isDusk ? 80 : 100;
  const color = isDawn || isDusk ? "#f5a623" : "#fff5c0";
  const glowColor = isDawn || isDusk ? "rgba(245,166,35,0.3)" : "rgba(255,245,192,0.2)";

  return (
    <div
      className="absolute rounded-full"
      style={{
        top,
        right,
        left,
        width: size,
        height: size,
        background: `radial-gradient(circle, ${color} 0%, ${glowColor} 50%, transparent 70%)`,
        filter: "blur(2px)",
        animation: "sunPulse 4s ease-in-out infinite",
      }}
    />
  );
}

// Animated cloud shapes
function Clouds({ count, speed }: { count: number; speed: "slow" | "medium" | "fast" }) {
  const dur = speed === "slow" ? 60 : speed === "medium" ? 35 : 20;
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const w = 120 + Math.random() * 160;
        const h = 30 + Math.random() * 30;
        const top = 5 + i * (70 / count) + Math.random() * 10;
        const opacity = 0.08 + Math.random() * 0.12;
        const delay = -(Math.random() * dur);
        return (
          <div
            key={`cloud-${i}`}
            className="absolute rounded-full"
            style={{
              top: `${top}%`,
              width: w,
              height: h,
              background: `radial-gradient(ellipse, rgba(255,255,255,${opacity}) 0%, transparent 70%)`,
              animation: `cloudDrift ${dur + i * 5}s linear ${delay}s infinite`,
              filter: "blur(10px)",
            }}
          />
        );
      })}
    </>
  );
}

// Rain drops
function RainDrops({ intensity }: { intensity: number }) {
  const count = intensity * 25;
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const left = Math.random() * 100;
        const delay = -(Math.random() * 1.5);
        const dur = 0.6 + Math.random() * 0.4;
        const opacity = 0.15 + Math.random() * 0.25;
        return (
          <div
            key={`rain-${i}`}
            className="absolute"
            style={{
              left: `${left}%`,
              top: "-5%",
              width: 1.5,
              height: 18 + Math.random() * 14,
              background: `linear-gradient(180deg, transparent, rgba(180,210,240,${opacity}))`,
              borderRadius: 1,
              animation: `rainFall ${dur}s linear ${delay}s infinite`,
            }}
          />
        );
      })}
    </>
  );
}

// Stars for night
function Stars() {
  return (
    <>
      {Array.from({ length: 40 }).map((_, i) => {
        const left = Math.random() * 100;
        const top = Math.random() * 60;
        const size = 1 + Math.random() * 2;
        const opacity = 0.3 + Math.random() * 0.5;
        const dur = 2 + Math.random() * 3;
        const delay = Math.random() * dur;
        return (
          <div
            key={`star-${i}`}
            className="absolute rounded-full"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: size,
              height: size,
              backgroundColor: `rgba(255,255,255,${opacity})`,
              animation: `starTwinkle ${dur}s ease-in-out ${delay}s infinite`,
            }}
          />
        );
      })}
    </>
  );
}

// Lightning flash for thunderstorms
function Lightning() {
  return (
    <div
      className="absolute inset-0"
      style={{
        animation: "lightningFlash 6s ease-in-out infinite",
        background: "transparent",
        pointerEvents: "none",
      }}
    />
  );
}

export default function WeatherBackground({ condition, timeOfDay, temperature }: Props) {
  const gradient = getGradient(condition, timeOfDay);
  const isNight = timeOfDay === "night";
  const isRain = condition === "rain" || condition === "thunderstorm";
  const isCloudy = condition === "cloudy" || condition === "partly_cloudy" || condition === "fog";
  const isClear = condition === "clear" || condition === "partly_cloudy";

  return (
    <div
      className="absolute inset-0 overflow-hidden transition-all duration-[3000ms]"
      style={{ background: gradient }}
    >
      {/* Atmospheric haze overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: isRain
            ? "radial-gradient(ellipse at 50% 0%, rgba(60,80,100,0.2) 0%, transparent 70%)"
            : "radial-gradient(ellipse at 70% 20%, rgba(255,255,255,0.06) 0%, transparent 60%)",
        }}
      />

      {/* Sun/moon */}
      {isClear && <SunElement tod={timeOfDay} />}
      {isNight && !isRain && <Stars />}

      {/* Clouds */}
      {isCloudy && (
        <Clouds
          count={condition === "cloudy" ? 6 : condition === "fog" ? 8 : 4}
          speed={condition === "fog" ? "slow" : "medium"}
        />
      )}
      {isRain && <Clouds count={5} speed="fast" />}

      {/* Rain */}
      {isRain && <RainDrops intensity={condition === "thunderstorm" ? 4 : 2} />}
      {condition === "thunderstorm" && <Lightning />}

      {/* Bottom fade to dark for card readability */}
      <div
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background: "linear-gradient(180deg, transparent 0%, rgba(10,14,30,0.7) 70%, rgba(10,14,30,0.92) 100%)",
        }}
      />

      {/* Keyframe animations */}
      <style jsx>{`
        @keyframes sunPulse {
          0%, 100% { transform: scale(1); opacity: 0.9; }
          50% { transform: scale(1.08); opacity: 1; }
        }
        @keyframes cloudDrift {
          0% { transform: translateX(-200px); }
          100% { transform: translateX(calc(100vw + 200px)); }
        }
        @keyframes rainFall {
          0% { transform: translateY(-20px); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(calc(100vh + 20px)); opacity: 0; }
        }
        @keyframes starTwinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.9; }
        }
        @keyframes lightningFlash {
          0%, 94%, 100% { background: transparent; }
          95% { background: rgba(200,220,255,0.15); }
          96% { background: transparent; }
          97% { background: rgba(200,220,255,0.08); }
        }
      `}</style>
    </div>
  );
}
