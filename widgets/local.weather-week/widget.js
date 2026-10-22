import BlueWeatherWidget from "../_blue-weather/weather.js";

export default class WeatherWidget extends BlueWeatherWidget {
    constructor(api) {
        super(api, "week", import.meta.url);
    }
}
