'use strict';

const { WeatherService } = require('../../../backend/weather');

let service = null;

module.exports = {
  namespace: 'weather',
  handlers: {
    /** True when WEATHER_API is configured; otherwise the renderer falls back to `launcher.getWeather` (Open-Meteo). */
    available: () => service.available,
    get: (_ctx, location) => service.get(location)
  },
  start(ctx) { service = new WeatherService({ userData: ctx.userData, apiKey: ctx.secrets.weatherApiKey }); }
};
