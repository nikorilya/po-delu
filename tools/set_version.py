"""Проставляет номер версии во все места, где он нужен.

Зачем: Telegram и браузеры кэшируют файлы кода. Если адрес файла не меняется,
после обновления на GitHub Pages пользователь может получить старый код.
Скрипт дописывает ?v=<версия> ко всем подключаемым файлам, поэтому каждая
новая версия загружается заново.

Запуск из папки проекта:
    python3 tools/set_version.py 0.4.3
"""
import json, re, sys, pathlib, collections

if len(sys.argv) != 2 or not re.fullmatch(r"\d+\.\d+\.\d+", sys.argv[1]):
    sys.exit("Укажите версию в виде 1.2.3: python3 tools/set_version.py 0.4.3")
V = sys.argv[1]
root = pathlib.Path(__file__).resolve().parent.parent

# 1. index.html: стили и точка входа
index = root / "index.html"
html = index.read_text(encoding="utf-8")
html = re.sub(r'href="css/styles\.css(\?v=[\w.]+)?"', f'href="css/styles.css?v={V}"', html)
html = re.sub(r'src="js/app\.js(\?v=[\w.]+)?"', f'src="js/app.js?v={V}"', html)
index.write_text(html, encoding="utf-8")

# 2. Все импорты между модулями: './x.js' и '../x.js'
pattern = re.compile(r"""((?:from|import)\s+['"]\.{1,2}/[\w/.-]+?\.js)(\?v=[\w.]+)?(['"])""")
changed = 0
for f in sorted((root / "js").rglob("*.js")):
    src = f.read_text(encoding="utf-8")
    new = pattern.sub(lambda m: f"{m.group(1)}?v={V}{m.group(3)}", src)
    if f.name == "app.js":
        new = re.sub(r"export const APP_VERSION = '[\w.]+';", f"export const APP_VERSION = '{V}';", new)
    if new != src:
        f.write_text(new, encoding="utf-8")
        changed += 1

# 3. Версия контента
cpath = root / "content.json"
c = json.loads(cpath.read_text(encoding="utf-8"), object_pairs_hook=collections.OrderedDict)
c["_meta"]["version"] = V
cpath.write_text(json.dumps(c, ensure_ascii=False, indent=2), encoding="utf-8")

print(f"Версия {V}: index.html, {changed} файлов кода, content.json")
