import BlueWeatherWidget from "../_blue-weather/weather-v3.js";

export default class WeatherWidget extends BlueWeatherWidget {
    constructor(api) {
        super(api, "quote", import.meta.url);
    }
}
