import BlueWeatherWidget from "../_blue-weather/weather-v2.js";

export default class WeatherWidget extends BlueWeatherWidget {
    constructor(api) {
        super(api, "rain", import.meta.url);
    }
}
