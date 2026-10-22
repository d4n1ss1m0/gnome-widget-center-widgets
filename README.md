# Виджеты для GNOME Widget Center

Семь собственных виджетов для расширения GNOME Widget Center, вынесенных из локальной установки в отдельный проект. В `widgets/` лежат исходники и настройки по умолчанию, в `settings/` — текущие настройки оформления и погоды.

| Виджет | ID | Размер |
| --- | --- | --- |
| Погода сейчас | `local.weather-current` | 1×1 |
| Погода по часам | `local.weather-hourly` | 2×1 |
| Прогноз на неделю | `local.weather-week` | 2×2 |
| Вероятность осадков | `local.weather-rain` | 1×1 |
| Погодная фраза | `local.weather-quote` | 1×1 |
| Четыре показателя системы | `local.system-four-rings` | 1×1 |
| Тёмный календарь | `local.calendar-dark-grid` | 1×1 |

Пять погодных виджетов используют общий модуль `widgets/_blue-weather`. Их файлы `widget-v*.js` и `weather-v*.js` сохранены вместе с текущей версией: GNOME Shell кеширует модули, поэтому имена версий нужны при обновлении.

## Установка

Установите GNOME Widget Center, затем из корня проекта выполните:

```bash
mkdir -p ~/.local/share/gnome-widget-center/widgets ~/.config/gnome-widget-center/widgets
cp -a widgets/_blue-weather widgets/local.* ~/.local/share/gnome-widget-center/widgets/
cp -an settings/local.*.json ~/.config/gnome-widget-center/widgets/
```

Настройки копируются только при отсутствии файла. Чтобы применить сохранённое оформление поверх текущего, сначала сохраните копию `~/.config/gnome-widget-center/widgets/`, затем скопируйте файлы из `settings/` с `cp -a`. Перезапустите GNOME Shell или выйдите из сеанса и войдите снова. Положение на рабочем столе при первой установке берётся из `default-position` в `metadata.json`; текущая раскладка всего Widget Center хранится отдельно в `~/.config/gnome-widget-center/layout.json`.

## Обновление проекта из локальной установки

Если правки внесены через Widget Center или непосредственно в установленный виджет, перенесите их сюда перед коммитом:

```bash
cp -a ~/.local/share/gnome-widget-center/widgets/_blue-weather ~/.local/share/gnome-widget-center/widgets/local.* widgets/
cp -a ~/.config/gnome-widget-center/widgets/local.*.json settings/
git diff --check && git diff
```

В погодных настройках сохранены город и координаты. Проверьте содержимое `settings/` перед публикацией репозитория.
