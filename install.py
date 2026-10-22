#!/usr/bin/env python3
"""Install this collection into the current user's GNOME Widget Center."""

import argparse
import filecmp
import json
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def widget_sources():
    base = ROOT / "widgets"
    shared = base / "_blue-weather"
    if not shared.is_dir():
        raise ValueError("Не найден общий модуль widgets/_blue-weather")
    widgets = sorted(path for path in base.glob("local.*") if path.is_dir())
    if not widgets:
        raise ValueError("Не найдены локальные виджеты")
    for path in widgets:
        metadata = json.loads((path / "metadata.json").read_text())
        if metadata.get("id") != path.name or not (path / metadata.get("entry", "")).is_file():
            raise ValueError(f"Некорректный metadata.json: {path}")
        json.loads((path / "config.json").read_text())
    return [shared, *widgets]


def same_tree(source, target):
    if not target.is_dir() or target.is_symlink():
        return False
    source_files = {path.relative_to(source) for path in source.rglob("*") if path.is_file()}
    target_files = {path.relative_to(target) for path in target.rglob("*") if path.is_file()}
    return source_files == target_files and all(
        filecmp.cmp(source / relative, target / relative, shallow=False)
        for relative in source_files
    )


def replace_widget(source, target, backup):
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".widget-install-", dir=target.parent) as temporary:
        staged = Path(temporary) / source.name
        shutil.copytree(source, staged)
        if target.exists():
            backup.parent.mkdir(parents=True, exist_ok=True)
            target.rename(backup)
        try:
            staged.rename(target)
        except OSError:
            if backup.exists() and not target.exists():
                backup.rename(target)
            raise


def replace_setting(source, target, backup):
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".widget-setting-", dir=target.parent) as temporary:
        staged = Path(temporary) / source.name
        shutil.copy2(source, staged)
        if target.exists():
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, backup)
        staged.replace(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="показать изменения без установки")
    parser.add_argument("--force-settings", action="store_true", help="заменить существующие настройки виджетов")
    args = parser.parse_args()

    try:
        sources = widget_sources()
        home = Path.home()
        widget_dir = home / ".local/share/gnome-widget-center/widgets"
        settings_dir = home / ".config/gnome-widget-center/widgets"
        backup = home / ".local/state/gnome-widget-center-widgets/backups" / datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        changed = 0

        for source in sources:
            target = widget_dir / source.name
            if target.is_symlink():
                raise ValueError(f"Целевой каталог является символической ссылкой: {target}")
            if same_tree(source, target):
                continue
            print(f"{'Будет установлен' if args.dry_run else 'Установлен'} виджет: {source.name}")
            if not args.dry_run:
                replace_widget(source, target, backup / "widgets" / source.name)
            changed += 1

        for source in sorted((ROOT / "settings").glob("local.*.json")):
            json.loads(source.read_text())
            target = settings_dir / source.name
            if target.is_symlink():
                raise ValueError(f"Файл настроек является символической ссылкой: {target}")
            if target.is_file():
                if filecmp.cmp(source, target, shallow=False):
                    continue
                if not args.force_settings:
                    print(f"Сохранены текущие настройки: {source.name}")
                    continue
            print(f"{'Будут записаны' if args.dry_run else 'Записаны'} настройки: {source.name}")
            if not args.dry_run:
                replace_setting(source, target, backup / "settings" / source.name)
            changed += 1

        if not changed:
            print("Изменений нет.")
        elif not args.dry_run:
            if backup.exists():
                print(f"Резервная копия заменённых файлов: {backup}")
            print("Для загрузки виджетов выйдите из сеанса GNOME и войдите снова.")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.exit(1, f"Ошибка установки: {error}\n")


if __name__ == "__main__":
    main()
