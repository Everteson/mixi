"""Gera os ícones do Mixi (mascote de fone) sem dependências externas.

Saída em src-tauri/icons/: icon.ico (multi-tamanho), icon.png (256) e tray.png (32, traço mais grosso).
Uso: python tools/make_icons.py
"""
import os
import struct
import zlib

ACC = (0xE8, 0x67, 0x9F)
INK = (0xA3, 0x32, 0x6B)
EYE = (0x2B, 0x1D, 0x2F)
CHEEK = (0xFF, 0xC4, 0xDC)
OFF = (0xB9, 0xB0, 0xB8)  # fones "desligados" (som mudo)


def bez3(p0, p1, p2, p3, n=90):
    pts = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
        pts.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return pts


def bez2(p0, p1, p2, n=40):
    pts = []
    for i in range(n + 1):
        t = i / n
        a, b, c = (1 - t) ** 2, 2 * (1 - t) * t, t * t
        pts.append((a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]))
    return pts


BAND = bez3((8, 27), (8, 7), (40, 7), (40, 27))
SMILE = bez2((21.5, 31), (24, 33.6), (26.5, 31))
# olhos fechados (dormindo): arquinhos virados pra baixo
SLEEP_L = bez2((16.8, 25.2), (19.5, 28.4), (22.2, 25.2))
SLEEP_R = bez2((25.8, 25.2), (28.5, 28.4), (31.2, 25.2))
# boca reta (microfone mudo) e o risco do selo
FLAT = [(21.5 + i * 0.25, 32.0) for i in range(21)]
SLASH = [(33.6 + i * 0.4, 41.4 - i * 0.4) for i in range(20)]


def near(pts, x, y, r):
    r2 = r * r
    return any((x - px) ** 2 + (y - py) ** 2 <= r2 for px, py in pts)


def rrect(x, y, rx, ry, w, h, r):
    if not (rx <= x <= rx + w and ry <= y <= ry + h):
        return False
    cx = min(max(x, rx + r), rx + w - r)
    cy = min(max(y, ry + r), ry + h - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def shade(x, y, bold, face="awake", off=False):
    phones = OFF if off else INK
    c = None
    if 4 <= x <= 44 and 9 <= y <= 30 and near(BAND, x, y, 2.4 if bold else 1.75):
        c = phones
    if rrect(x, y, 10, 13, 28, 29, 13):
        c = ACC
    if rrect(x, y, 4, 23, 8, 13, 4) or rrect(x, y, 36, 23, 8, 13, 4):
        c = phones
    # olhos
    if face == "sleep":
        if 15 <= x <= 33 and 23 <= y <= 30 and (near(SLEEP_L, x, y, 1.6 if bold else 1.2) or near(SLEEP_R, x, y, 1.6 if bold else 1.2)):
            c = EYE
    else:
        er = 3.1 if bold else 2.4
        if (x - 19.5) ** 2 + (y - 26) ** 2 <= er * er or (x - 28.5) ** 2 + (y - 26) ** 2 <= er * er:
            c = EYE
    if not bold and ((((x - 16) / 2.8) ** 2 + ((y - 31.5) / 1.8) ** 2) <= 1 or (((x - 32) / 2.8) ** 2 + ((y - 31.5) / 1.8) ** 2) <= 1):
        c = CHEEK
    # boca
    if face == "awake":
        if 19 <= x <= 29 and 28.5 <= y <= 35 and near(SMILE, x, y, 1.4 if bold else 1.0):
            c = EYE
    elif face == "sleep":
        if (x - 24) ** 2 + (y - 32.2) ** 2 <= (1.7 if bold else 1.3) ** 2:
            c = EYE
    elif face == "muted":
        if 19 <= x <= 29 and 30 <= y <= 34 and near(FLAT, x, y, 1.4 if bold else 1.0):
            c = EYE
        # selo de "microfone mudo" no canto
        if (x - 37.5) ** 2 + (y - 37.5) ** 2 <= 8.2 ** 2:
            c = EYE
            if near(SLASH, x, y, 1.5 if bold else 1.2):
                c = (0xFF, 0xFF, 0xFF)
    return c


def render(size, bold=False, face="awake", off=False):
    ss = 4 if size <= 64 else 2
    # viewBox 48 recortado para 2..46 (44 unidades), assim o mascote ocupa o ícone todo
    scale = 44.0 / size
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    x = 2 + (px + (sx + 0.5) / ss) * scale
                    y = 2 + (py + (sy + 0.5) / ss) * scale
                    c = shade(x, y, bold, face, off)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 1
            n = ss * ss
            if a:
                row += bytes((int(r / a), int(g / a), int(b / a), int(255 * a / n)))
            else:
                row += b"\0\0\0\0"
        rows.append(bytes(row))
    return rows


def png_bytes(rows, size):
    return png_bytes_rect(rows, size, size)


def png_bytes_rect(rows, width, height):
    raw = b"".join(b"\0" + r for r in rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")
    os.makedirs(out, exist_ok=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    pngs = {s: png_bytes(render(s), s) for s in sizes}
    header = struct.pack("<HHH", 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    entries, blobs = b"", b""
    for s in sizes:
        data = pngs[s]
        entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), offset + len(blobs))
        blobs += data
    with open(os.path.join(out, "icon.ico"), "wb") as f:
        f.write(header + entries + blobs)
    with open(os.path.join(out, "icon.png"), "wb") as f:
        f.write(pngs[256])
    # bandeja: acordado, dormindo (nada tocando) e com o microfone mudo;
    # cada uma também com os fones cinza (som mudo) -> tray-off*.png
    for face, suffix in (("awake", ""), ("sleep", "-sleep"), ("muted", "-muted")):
        for off in (False, True):
            name = f"tray{'-off' if off else ''}{suffix}.png"
            with open(os.path.join(out, name), "wb") as f:
                f.write(png_bytes(render(32, bold=True, face=face, off=off), 32))
    docs = os.path.join(os.path.dirname(__file__), "..", "docs", "img")
    os.makedirs(docs, exist_ok=True)
    with open(os.path.join(docs, "caras-bandeja.png"), "wb") as f:
        # prévia grande das caras, lado a lado (pro README; não vai pro app)
        faces = (("awake", False), ("sleep", False), ("muted", False), ("awake", True))
        rows = [b"".join(parts) for parts in zip(*(render(96, bold=True, face=fc, off=o) for fc, o in faces))]
        f.write(png_bytes_rect(rows, 96 * len(faces), 96))
    print("icones gerados em", os.path.abspath(out))


if __name__ == "__main__":
    main()
