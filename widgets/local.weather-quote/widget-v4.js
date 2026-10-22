import BlueWeatherWidget from "../_blue-weather/weather-v4.js";

export default class WeatherWidget extends BlueWeatherWidget {
    constructor(api) {
        super(api, "quote", import.meta.url);
    }
}
