"use client";

import { useEffect, useState } from "react";

// WMO Weather interpretation codes
// https://open-meteo.com/en/docs
export type WeatherCondition = "clear" | "partly_cloudy" | "cloudy" | "fog" | "rain" | "snow" | "thunderstorm";
export type TimeOfDay = "day" | "night" | "dawn" | "dusk";

export interface WeatherData {
  temperature: number; // °F
  condition: WeatherCondition;
  timeOfDay: TimeOfDay;
  windSpeed: number; // mph
  humidity: number; // %
  description: string;
}

function wmoToCondition(code: number): WeatherCondition {
  if (code === 0) return "clear";
  if (code <= 3) return "partly_cloudy";
  if (code <= 49) return "fog";
  if (code <= 69) return "rain";
  if (code <= 79) return "snow";
  if (code <= 82) return "rain";
  if (code <= 86) return "snow";
  if (code >= 95) return "thunderstorm";
  return "cloudy";
}

function wmoDescription(code: number): string {
  const map: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Foggy", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    80: "Slight showers", 81: "Moderate showers", 82: "Violent showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail",
  };
  return map[code] || "Partly cloudy";
}

function getTimeOfDay(isDay: boolean): TimeOfDay {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 7) return "dawn";
  if (hour >= 18 && hour < 20) return "dusk";
  return isDay ? "day" : "night";
}

// Default coordinates (Alamo, CA) — overridden by user profile lat/lon
const DEFAULT_LAT = 37.85;
const DEFAULT_LON = -122.03;

export function useWeather(lat?: number | null, lon?: number | null): WeatherData | null {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const useLat = lat ?? DEFAULT_LAT;
  const useLon = lon ?? DEFAULT_LON;

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${useLat}&longitude=${useLon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FLos_Angeles`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const c = data.current;

        setWeather({
          temperature: Math.round(c.temperature_2m),
          condition: wmoToCondition(c.weather_code),
          timeOfDay: getTimeOfDay(c.is_day === 1),
          windSpeed: Math.round(c.wind_speed_10m),
          humidity: Math.round(c.relative_humidity_2m),
          description: wmoDescription(c.weather_code),
        });
      } catch {
        // Fallback to a reasonable default
        const hour = new Date().getHours();
        setWeather({
          temperature: 72,
          condition: "clear",
          timeOfDay: hour >= 6 && hour < 18 ? "day" : "night",
          windSpeed: 5,
          humidity: 45,
          description: "Clear sky",
        });
      }
    };

    fetchWeather();
    // Refresh every 15 minutes
    const id = setInterval(fetchWeather, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [useLat, useLon]);

  return weather;
}
