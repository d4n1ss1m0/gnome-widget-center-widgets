import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import St from "gi://St";

export default class DarkGridCalendarWidget {
    constructor(api) {
        this._settings = api.settings;
        this._layersKit = api.host.kit.layers;
        this._calendarKit = api.host.kit.calendar;
        this._visualKit = api.host.kit.visual;
        this._configKit = api.host.kit.config;
        this._timer = null;
    }

    buildActor() {
        this._layers = this._layersKit.createLayeredCard({
            contentStyleClass: "local-calendar-dark-grid"
        });
        this._actor = this._layers.root;
        this._content = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });
        this._layers.content.add_child(this._content);

        this._month = new St.Label();
        this._weekdays = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL });
        this._days = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL });
        this._content.add_child(this._month);
        this._content.add_child(this._weekdays);
        this._content.add_child(this._days);
        this._render();
        return this._actor;
    }

    enable() {
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._render();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        if (this._timer !== null) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }
    }

    getDefaultSettings() {
        return {
            ...this._configKit.configJsonDefaults(import.meta.url),
            ...this._visualKit.SHADOW_DEFAULTS,
            ...this._visualKit.BLUR_DEFAULTS,
            ...this._visualKit.BORDER_DEFAULTS,
            ...this._visualKit.OPACITY_DEFAULTS
        };
    }

    onSettingsChanged() {
        this._render();
    }

    _render() {
        if (!this._actor) return;
        const settings = this._settings;
        this._layersKit.applyLayeredCardStyle(this._layers, settings, {
            backgroundColorKey: "card-background-color",
            cornerRadiusFallback: 20
        }, false);

        const now = GLib.DateTime.new_now_local();
        const grid = this._calendarKit.buildMonthGrid(now, false);
        const monthColor = settings.monthColor ?? "#FF453A";
        const weekdayColor = settings.weekdayColor ?? "#B9B9BD";
        const dayColor = settings.dayColor ?? "#F5F5F7";
        const todayColor = settings.todayColor ?? "#FF453A";

        this._content.set_style("padding: 10px 12px 8px;");
        this._month.set_text((grid.monthLabel ?? "").toLocaleUpperCase());
        this._month.set_style(`color: ${monthColor}; font-size: 11px; font-weight: bold; height: 15px; margin-bottom: 4px;`);

        this._weekdays.destroy_all_children();
        this._weekdays.set_style("height: 15px; margin-bottom: 4px;");
        for (const label of ["S", "M", "T", "W", "T", "F", "S"]) {
            this._weekdays.add_child(new St.Label({
                text: label,
                x_align: Clutter.ActorAlign.CENTER,
                style: `color: ${weekdayColor}; font-size: 10px; font-weight: bold; text-align: center; width: 21px; height: 15px;`
            }));
        }

        this._days.destroy_all_children();
        for (const week of grid.weeks) {
            const row = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, style: "height: 19px;" });
            for (const cell of week) {
                const text = cell.inMonth ? `${cell.day}` : "";
                const cellStyle = cell.isToday
                    ? `color: #FFFFFF; background-color: ${todayColor}; border-radius: 10px; font-weight: bold;`
                    : `color: ${dayColor};`;
                row.add_child(new St.Label({
                    text,
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: `${cellStyle} font-size: 11px; text-align: center; width: 19px; height: 19px; margin-left: 1px; margin-right: 1px;`
                }));
            }
            this._days.add_child(row);
        }
    }
}
